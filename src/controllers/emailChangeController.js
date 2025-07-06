const { emailChange } = require("../models");  // MongoDB / Prisma など

exports.confirmEmailChange = async (req, res) => {
  const { token } = req.query;
  if (!token) return res.json({ ok: false });

  const rec = await emailChange.findOne({ token, expires: { $gt: Date.now() } });
  if (!rec) return res.json({ ok: false });

  // トークン無効化
  await emailChange.deleteOne({ token });

  // フロントへ新メールを返す
  res.json({ ok: true, newEmail: rec.newEmail });
};
