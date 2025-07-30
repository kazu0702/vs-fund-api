// src/routes/emailChange.js
const router  = require("express").Router();
const db      = require("../db");
const crypto  = require("crypto");
const { confirmEmailChange } = require("../controllers/emailChangeController");

/* ① 変更リクエスト受付 ------------------------------------ */
router.post("/request", async (req, res) => {
  console.log("[DEBUG] /emailChange/request", req.body);
  const { userId, newEmail } = req.body;
  if (!userId || !newEmail) return res.status(400).json({ ok:false });

  const token   = crypto.randomUUID();
  const expires = new Date(Date.now() + 60*60*1000);   // 1 時間

  await db.query(
    `INSERT INTO email_change(token,user_id,new_email,expires_at)
     VALUES ($1,$2,$3,$4)`,
    [token, userId, newEmail, expires]
  );

  // ★ここで SendGrid などを使って確認メールを送信 ----------------
  // const confirmUrl = `https://vsfund.webflow.io/email-change-confirm?token=${token}`;
  // await sgMail.send({ to:newEmail, … });
  // ----------------------------------------------------------------

  res.json({ ok:true });
});

/* ② 確認リンク -------------------------------------------- */
// /api/emailChange/confirm?token=xxxx
router.get("/confirm", confirmEmailChange);

module.exports = router;
