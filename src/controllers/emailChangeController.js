// src/controllers/emailChangeController.js

/**
 * メールアドレス変更確認エンドポイント
 *
 * 1. クエリ文字列 token でトークンを受け取る
 * 2. email_change テーブルから有効なトークンを削除しつつ user_id / new_email を取得
 * 3. Memberstack Admin SDK で対象メンバーのメールアドレスを更新
 * 4. 正常終了したら { ok:true }、エラー時は { ok:false, message } を返す
 */

const db           = require("../db");
const memberstack  = require("@memberstack/admin");

// Admin SDK を初期化（必ず secret と appId の両方を渡すこと！）
memberstack.init({
  secretKey: process.env.MS_SECRET,
  appId : process.env.MS_APP_ID,
});

console.log(
  "[DEBUG] Memberstack.members keys:",
  Object.keys(memberstack.members || {})
);

/**
 * GET /api/emailChange/confirm?token=xxxxx
 */
exports.confirmEmailChange = async (req, res) => {
  const { token } = req.query;
  if (!token) return res.json({ ok: false });

  // 1️⃣ トークンが有効か検証しつつ削除（ワンタイムにする）
  const { rows } = await db.query(
    `DELETE FROM email_change
     WHERE token = $1 AND expires_at > NOW()
     RETURNING user_id, new_email;`,
    [token]
  );

  if (!rows.length) return res.json({ ok: false }); // 無効 or 期限切れ

  const rec = rows[0];

  try {
    // ここで memberstack.members が存在するか念のため確認
    if (!memberstack.members) throw new Error("Memberstack not initialized");

    await memberstack.members.update({
      id:   rec.user_id,
      data: { email: rec.new_email }
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[emailChange] MS update failed:", err);
    return res.status(400).json({ ok: false, message: err.message });
  }
};