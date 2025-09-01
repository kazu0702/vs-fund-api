// src/routes/emailChange.js
const router = require("express").Router();
const db     = require("../db");
const crypto = require("crypto");
const MemberstackAdmin = require("@memberstack/admin");

// Memberstack Admin 初期化（環境変数 MS_SECRET 必須）
const ms = MemberstackAdmin.init(process.env.MS_SECRET);

/**
 * 1) 変更リクエスト発行
 * POST /api/emailChange/request
 * body: { userId, newEmail }
 * - ランダムなトークンを発行して email_change テーブルに保存
 * - （任意）SendGrid 等で確認メール送信
 * - DEBUG_EMAIL_CHANGE=true のときのみ token を返す（開発用）
 */
router.post("/request", async (req, res) => {
  try {
    const { userId, newEmail } = req.body;
    if (!userId || !newEmail) return res.status(400).json({ ok:false, error:"missing_params" });

    const token   = crypto.randomUUID();
    const expires = new Date(Date.now() + 1000 * 60 * 60); // 1時間

    await db.query(
      `INSERT INTO email_change(token, user_id, new_email, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [token, userId, newEmail, expires]
    );

    // ====== ここで確認メール送信（例: SendGrid）======
    // const sgMail = require("@sendgrid/mail");
    // sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    // const confirmUrl = `https://vsfund.webflow.io/email-change-confirm?token=${token}`;
    // await sgMail.send({
    //   to: newEmail,
    //   from: "no-reply@vs-fund.or.jp",
    //   subject: "メールアドレス変更の確認",
    //   html: `<p>下記リンクをクリックして変更を完了してください。</p>
    //          <a href="${confirmUrl}">${confirmUrl}</a>`
    // });
    // ================================================

    const debug = process.env.DEBUG_EMAIL_CHANGE === "true";
    return res.json(debug ? { ok:true, token } : { ok:true });
  } catch (err) {
    console.error("[emailChange/request] error:", err);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
});

/**
 * 2) 確認（トークン消費）
 * GET /api/emailChange/confirm?token=...
 * - 有効トークンを1回で削除しつつ取得
 * - Memberstack のメールを new_email に更新
 * - JSON を返す（フロント側で成功/失敗ページへリダイレクト）
 */
router.get("/confirm", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ ok:false, reason:"missing_token" });

    const { rows } = await db.query(
      `DELETE FROM email_change
         WHERE token = $1
           AND expires_at > NOW()
       RETURNING user_id, new_email`,
      [token]
    );

    if (rows.length === 0) {
      return res.status(400).json({ ok:false, reason:"invalid_or_expired" });
    }

    const rec = rows[0];
    await ms.members.update({ id: rec.user_id, email: rec.new_email });

    return res.json({ ok:true });
  } catch (err) {
    console.error("[emailChange/confirm] error:", err);
    return res.status(500).json({ ok:false, reason:"server_error" });
  }
});

module.exports = router;
