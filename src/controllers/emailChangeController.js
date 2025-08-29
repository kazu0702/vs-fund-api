// src/controllers/emailChangeController.js
const db = require("../db");
const memberstack = require("@memberstack/admin");

// Admin SDK を初期化（このプロジェクトは secret だけでOK）
memberstack.init({ secret: process.env.MS_SECRET });

/**
 * GET /api/emailChange/confirm?token=xxxxx
 * 1) token を受け取り、有効なら email_change から削除しつつ member_id/new_email を取得
 * 2) Memberstack のメールアドレスを更新
 * 3) { ok:true } を返す（無効・期限切れなら { ok:false }）
 */
exports.confirmEmailChange = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.json({ ok: false });

    // ★DBスキーマに合わせて member_id を返させる
    const { rows } = await db.query(
      `DELETE FROM email_change
         WHERE token = $1 AND expires_at > NOW()
         RETURNING member_id, new_email`,
      [token]
    );
    if (!rows.length) return res.json({ ok: false }); // 無効 or 期限切れ

    const rec = rows[0];

    // Memberstack 側のメール更新（id は Memberstack の会員ID）
    await memberstack.members.update({
      id: rec.member_id,
      email: rec.new_email,
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[confirmEmailChange] error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
