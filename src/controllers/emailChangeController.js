// const { emailChange } = require("../models");  // ← DB 実装までは無効化

exports.confirmEmailChange = async (req, res) => {
  // token が無い、または DB がまだ無い場合は false を返す
  const { token } = req.query;
  if (!token) return res.json({ ok: false });

  // まだ DB 未接続なので常に失敗
  return res.json({ ok: false });
};
