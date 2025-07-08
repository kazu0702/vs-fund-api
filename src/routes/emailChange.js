// src/routes/emailChange.js
const router = require("express").Router();
const db     = require("../db");
const crypto = require("crypto");

router.post("/request", async (req, res) => {
  const { userId, newEmail } = req.body;
  if (!userId || !newEmail) return res.status(400).json({ ok:false });

  const token   = crypto.randomUUID();
  const expires = new Date(Date.now() + 1000*60*60); // 1 時間

  await db.query(
    `INSERT INTO email_change(token,user_id,new_email,expires_at)
     VALUES ($1,$2,$3,$4)`,
    [token, userId, newEmail, expires]
  );

  // ============= 認証メール送信（SendGrid 例） =============
  // const sgMail = require("@sendgrid/mail");
  // sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  // const confirmUrl = `https://izokukikin.webflow.io/email-change-confirm?token=${token}`;
  // await sgMail.send({
  //   to: newEmail,
  //   from: "no-reply@vs-fund.or.jp",
  //   subject: "メールアドレス変更の確認",
  //   html: `<p>下記リンクをクリックして変更を完了してください。</p>
  //          <a href="${confirmUrl}">${confirmUrl}</a>`
  // });
  // =========================================================

  res.json({ ok:true });
});

module.exports = router;
