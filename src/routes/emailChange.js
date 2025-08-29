// src/routes/emailChange.js
const router  = require("express").Router();
const db      = require("../db");
const crypto  = require("crypto");
const { confirmEmailChange } = require("../controllers/emailChangeController");

// --- SendGrid 設定 ---
const sgMail = require("@sendgrid/mail");
if (!process.env.SENDGRID_API_KEY) {
  console.warn("[WARN] SENDGRID_API_KEY is not set. Emails will fail.");
}
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

/* ① 変更リクエスト受付 ------------------------------------ */
router.post("/request", async (req, res) => {
  try {
    console.log("[DEBUG] /emailChange/request", req.body);
    const { userId, newEmail } = req.body; // フロントは userId のままでOK
    if (!userId || !newEmail) {
      return res.status(400).json({ ok:false, error: "userId and newEmail are required" });
    }

    const token   = crypto.randomUUID();
    const expires = new Date(Date.now() + 60*60*1000);   // 1 時間

    // ★DBのカラム名に合わせる：member_id
    await db.query(
      `INSERT INTO email_change(token, member_id, new_email, expires_at)
       VALUES ($1,$2,$3,$4)`,
      [token, userId, newEmail, expires]
    );

    // 確認リンク（Webflowの新ドメイン）
    const confirmUrl = `https://hau2tdnn1x.webflow.io/email-change-confirm?token=${token}`;

    // 送信（送信元・返信先ともに認証済みアドレス）
    await sgMail.send({
      to: newEmail,
      from: { email: "k-hirai@hirai-syoji.com", name: "Victim Support Fund（VSファンド）" },
      replyTo: { email: "k-hirai@hirai-syoji.com", name: "Victim Support Fund（VSファンド）" },
      subject: "メールアドレス変更の確認",
      html: `<p>下記リンクをクリックして変更を完了してください。</p>
             <p><a href="${confirmUrl}">${confirmUrl}</a></p>
             <p>※このリンクは1時間で期限切れになります。</p>`
    });

    console.log("[emailChange] Sent email:", confirmUrl);
    res.json({ ok:true });
  } catch (err) {
    if (err.response && err.response.body) {
      console.error("[emailChange] SendGrid error body:", err.response.body);
    }
    console.error("[emailChange] Error:", err);
    res.status(500).json({ ok:false, error: err.message });
  }
});

/* ② 確認リンク -------------------------------------------- */
// /api/emailChange/confirm?token=xxxx
router.get("/confirm", confirmEmailChange);

module.exports = router;
