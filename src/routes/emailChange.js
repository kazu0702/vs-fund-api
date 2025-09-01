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

// 1) リクエスト発行
router.post("/request", async (req, res) => {
  try {
    const { userId, newEmail } = req.body || {};
    if (!userId || !newEmail) {
      return res.status(400).json({ ok:false, error:"missing_params" });
    }

    const token   = crypto.randomUUID();
    const expires = new Date(Date.now() + 1000*60*60);

    await db.query(
      `INSERT INTO email_change(token, user_id, new_email, expires_at)
       VALUES ($1,$2,$3,$4)`,
      [token, userId, newEmail, expires]
    );

    // SendGridで送信
    if (process.env.SENDGRID_API_KEY) {
      const confirmUrl = `${CONFIRM_BASE}?token=${encodeURIComponent(token)}`;
      const html = `
        <p>メールアドレス変更の確認のため、下のボタンをクリックしてください。</p>
        <p><a href="${confirmUrl}" style="background:#FF0000;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;">変更を確定する</a></p>
        <p>ボタンが使えない場合は下記URLを開いてください：<br>${confirmUrl}</p>
      `;
      await sgMail.send({
        to: newEmail,
        from: { email: FROM_EMAIL, name: FROM_NAME },
        replyTo: { email: FROM_EMAIL, name: FROM_NAME },
        subject: "【VSファンド】メールアドレス変更の確認",
        html,
        mailSettings:{ clickTracking:{ enable:false, enableText:false } }
      });
    }

    const debug = process.env.DEBUG_EMAIL_CHANGE === "true";
    res.json(debug ? { ok:true, token } : { ok:true });
  } catch (err) {
    console.error("[emailChange/request] error:", err);
    res.status(500).json({ ok:false, error:"server_error" });
  }
});

// 2) 確認
router.get("/confirm", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ ok:false, reason:"missing_token" });

    const { rows } = await db.query(
      `DELETE FROM email_change
         WHERE token=$1 AND expires_at>NOW()
       RETURNING user_id,new_email`,
      [token]
    );
    if (rows.length === 0) {
      return res.status(400).json({ ok:false, reason:"invalid_or_expired" });
    }

    const rec = rows[0];
    await ms.members.update({ id: rec.user_id, email: rec.new_email });

    res.json({ ok:true });
  } catch (err) {
    console.error("[emailChange/confirm] error:", err);
    res.status(500).json({ ok:false, reason:"server_error" });
  }
});

module.exports = router;
