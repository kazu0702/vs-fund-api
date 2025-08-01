// src/controllers/emailChangeController.js
const db = require("../db");
const Memberstack = require("@memberstack/admin");
const memberstack = Memberstack.init({
  secret: process.env.MS_SECRET
});

exports.confirmEmailChange = async (req, res) => {
  const { token } = req.query;
  if (!token) return res.json({ ok: false });

  const { rows } = await db.query(
    `DELETE FROM email_change
     WHERE token = $1 AND expires_at > NOW()
     RETURNING user_id, new_email`,
    [token]
  );
  if (!rows.length) return res.json({ ok: false });

  const rec = rows[0];

  try {
    await memberstack.members.update({ id: rec.user_id, data: { email: rec.new_email } });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[emailChange] MS update failed:", err);
    // 必要ならロールバックでレコードを戻す処理を入れてもOK
    return res.status(400).json({ ok: false, message: err.message });
  }
};
