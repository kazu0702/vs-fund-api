// src/controllers/emailChangeController.js
const db = require("../db");
const memberstack = require("@memberstack/admin");      // npm i @memberstack/admin
memberstack.init({ secret: process.env.MS_SECRET });

exports.confirmEmailChange = async (req, res) => {
  const { token } = req.query;
  if (!token) return res.json({ ok:false });

  // 有効トークンを取り出して同時に削除
  const { rows } = await db.query(
    `DELETE FROM email_change
     WHERE token = $1 AND expires_at > NOW()
     RETURNING user_id, new_email`,
    [token]
  );
  if (!rows.length) return res.json({ ok:false });

  const rec = rows[0];

  // Memberstack のメール更新
  await memberstack.members.update({ id: rec.user_id, email: rec.new_email });

  res.json({ ok:true });
};
