// src/routes/emailChange.js
const router = require("express").Router();
const db     = require("../db");
const crypto = require("crypto");
const MemberstackAdmin = require("@memberstack/admin");
const sgMail = require("@sendgrid/mail");

const ms = MemberstackAdmin.init(process.env.MS_SECRET);

// Webflow 側の確認ページ
const CONFIRM_BASE =
  process.env.EMAIL_CHANGE_CONFIRM_BASE ||
  "https://hau2tdnn1x.webflow.io/email-change-confirm";

// From
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || "k-hirai@hirai-syoji.com";
const FROM_NAME  = process.env.SENDGRID_FROM_NAME  || "Victim Support Fund（VSファンド）";

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

/*───────────────────────────────────────────────
  1) リクエスト発行
───────────────────────────────────────────────*/
router.post("/request", async (req, res) => {
  try {
    const { userId, newEmail } = req.body || {};
    if (!userId || !newEmail) {
      return res.status(400).json({ ok:false, error:"missing_params" });
    }

    const token   = crypto.randomUUID();
    const expires = new Date(Date.now() + 1000*60*60); // 1h

    await db.query(
      `INSERT INTO email_change(token, user_id, new_email, expires_at)
       VALUES ($1,$2,$3,$4)`,
      [token, userId, newEmail, expires]
    );

    // SendGridで送信
    if (process.env.SENDGRID_API_KEY) {
      const confirmUrl = `${CONFIRM_BASE}?token=${encodeURIComponent(token)}`;
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#212121">
          <p>メールアドレス変更の確認のため、下のボタンをクリックしてください。</p>
          <p style="margin:24px 0">
            <a href="${confirmUrl}" style="display:inline-block;background:#FF0000;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;">変更を確定する</a>
          </p>
          <p>ボタンが機能しない場合は、次のURLをブラウザに貼り付けてください：</p>
          <p><a href="${confirmUrl}">${confirmUrl}</a></p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
          <p>このリンクの有効期限は1時間です。心当たりがない場合は、このメールは無視してください。</p>
        </div>
      `;
      await sgMail.send({
        to: newEmail,
        from: { email: FROM_EMAIL, name: FROM_NAME },
        replyTo: { email: FROM_EMAIL, name: FROM_NAME },
        subject: "【VSファンド】メールアドレス変更の確認",
        html,
        mailSettings:{ clickTracking:{ enable:false, enableText:false } }
      });
      console.log("[emailChange/request] mail sent to:", newEmail);
    } else {
      console.warn("[emailChange/request] SENDGRID_API_KEY is missing — mail not sent");
    }

    const debug = process.env.DEBUG_EMAIL_CHANGE === "true";
    res.json(debug ? { ok:true, token } : { ok:true });
  } catch (err) {
    console.error("[emailChange/request] error:", err);
    res.status(500).json({ ok:false, error:"server_error" });
  }
});

/*───────────────────────────────────────────────
  2) 確認（安全順序：SELECT→Memberstack更新→DELETE）
   - 失敗時はトークンを残すのでリトライ可
───────────────────────────────────────────────*/
router.get("/confirm", async (req, res) => {
  const { token } = req.query || {};
  const debug = process.env.DEBUG_EMAIL_CHANGE === "true";
  try {
    if (!token) return res.status(400).json({ ok:false, reason:"missing_token" });

    // まず取得（削除しない）
    const sel = await db.query(
      `SELECT user_id, new_email
         FROM email_change
        WHERE token = $1
          AND expires_at > NOW()
        LIMIT 1`,
      [token]
    );
    if (sel.rowCount === 0) {
      return res.status(400).json({ ok:false, reason:"invalid_or_expired" });
    }
    const rec = sel.rows[0];

    // Memberstack 更新
    try {
      await ms.members.update({ id: rec.user_id, email: rec.new_email });
    } catch (e) {
      const code = e?.code || e?.name || "memberstack_error";
      const msg  = e?.message || String(e);
      console.error("[emailChange/confirm] memberstack update error:", code, msg);
      // 失敗時はトークンを残す → ユーザーは後で再クリック可能
      return res
        .status(500)
        .json(debug ? { ok:false, reason:"memberstack_error", message: msg } : { ok:false, reason:"memberstack_error" });
    }

    // 成功したのでトークンを消費
    await db.query(`DELETE FROM email_change WHERE token = $1`, [token]);

    return res.json({ ok:true });
  } catch (err) {
    console.error("[emailChange/confirm] error:", err);
    return res.status(500).json({ ok:false, reason:"server_error" });
  }
});

module.exports = router;
