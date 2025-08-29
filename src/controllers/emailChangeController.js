// src/controllers/emailChangeController.js
const db = require("../db");
const MemberstackAdmin = require("@memberstack/admin");

// Admin SDK 初期化（secret 文字列だけ渡すのが正解）
const ms = MemberstackAdmin.init(process.env.MS_SECRET);

/**
 * GET /api/emailChange/confirm?token=xxxxx
 * 1) token が有効か検証（期限内）しつつ削除（ワンタイム）
 * 2) Memberstack のメールを new_email に更新
 */
exports.confirmEmailChange = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ ok:false, reason:"missing_token" });

    // DB は member_id で管理
    const { rows } = await db.query(
      `DELETE FROM email_change
         WHERE token = $1 AND expires_at > NOW()
       RETURNING member_id, new_email`,
      [token]
    );

    if (!rows.length) return res.status(200).json({ ok:false, reason:"invalid_or_expired" });

    const { member_id, new_email } = rows[0];

    // Memberstack 更新
    await ms.members.update({
      id: member_id,
      data: { email: new_email }
    });

    return res.json({ ok:true });
  } catch (err) {
    console.error("[confirmEmailChange] error:", err);
    // ここは 400 にしてクライアント側で failed ページへ誘導
    return res.status(400).json({ ok:false, error: err.message });
  }
};
