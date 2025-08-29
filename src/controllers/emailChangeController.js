// src/controllers/emailChangeController.js
const db = require("../db");
const memberstack = require("@memberstack/admin");

// Admin SDK 初期化（このプロジェクトは secret でOK）
memberstack.init({ secret: process.env.MS_SECRET });

/**
 * GET /api/emailChange/confirm?token=xxxxx
 * 1) tokenで有効レコードをSELECT（未削除）
 * 2) Memberstackのメール更新が成功したら DELETE
 * 3) 失敗時はDELETEしない（再試行可）
 */
exports.confirmEmailChange = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.json({ ok: false, reason: "no_token" });

    // 1) トークンを検証（有効期限内）
    const sel = await db.query(
      `SELECT member_id, new_email
         FROM email_change
        WHERE token = $1 AND expires_at > NOW()
        LIMIT 1`,
      [token]
    );
    if (!sel.rows.length) {
      return res.json({ ok: false, reason: "invalid_or_expired" });
    }

    const { member_id, new_email } = sel.rows[0];

    // 2) Memberstack を更新（書式差異に備え二段構え）
    let updated = false;
    try {
      await memberstack.members.update({ id: member_id, email: new_email });
      updated = true;
    } catch (e1) {
      console.warn("[confirmEmailChange] update format A failed, retrying with data:{email}", e1?.message || e1);
      await memberstack.members.update({ id: member_id, data: { email: new_email } });
      updated = true;
    }

    // 3) 成功したらトークンを削除（ワンタイム化）
    if (updated) {
      await db.query(`DELETE FROM email_change WHERE token = $1`, [token]);
      return res.json({ ok: true });
    }

    // ここには来ない想定
    return res.json({ ok: false, reason: "ms_update_unknown" });

  } catch (err) {
    console.error("[confirmEmailChange] error:", err?.response?.body || err);
    return res.status(500).json({ ok: false, error: err.message || "internal_error" });
  }
};
