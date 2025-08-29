// src/controllers/emailChangeController.js
const db = require("../db");
const MemberstackAdmin = require("@memberstack/admin");

/* ========= Memberstack Admin SDK 初期化 =========
   init() の「戻り値」に members がぶら下がります。
   一部の資料では secretKey/appId 表記もあるためフォールバック付き。
================================================= */
let ms = null;
try {
  // まずはこのプロジェクトで想定の形
  ms = MemberstackAdmin.init({ secret: process.env.MS_SECRET });
} catch (e) {
  console.warn("[memberstack] init({secret}) failed:", e?.message || e);
}
if (!ms || !ms.members) {
  try {
    // うまくいかない環境向けのフォールバック
    ms = MemberstackAdmin.init({
      secretKey: process.env.MS_SECRET,
      appId: process.env.MS_APP_ID, // 無ければ undefined でOK
    });
  } catch (e) {
    console.warn("[memberstack] init({secretKey, appId}) failed:", e?.message || e);
  }
}
if (!ms || !ms.members) {
  console.error("[memberstack] Admin SDK init failed: members API not available");
}

/**
 * GET /api/emailChange/confirm?token=xxxxx
 * 1) token を SELECT（未削除）で検証
 * 2) Memberstack の更新が成功したら DELETE（ワンタイム化）
 * 3) 失敗時は DELETE しない（再試行可能）
 */
exports.confirmEmailChange = async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.json({ ok: false, reason: "no_token" });

    // 1) 有効トークンを確認（期限内）
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

    // Admin SDK が未初期化なら即エラー返却（トークンは残す）
    if (!ms || !ms.members || typeof ms.members.update !== "function") {
      return res.status(500).json({ ok: false, error: "memberstack_not_initialized" });
    }

    // 2) Memberstack を更新（SDKの型差異に備えて二段構え）
    let updated = false;
    try {
      // パターンA：email を直指定
      await ms.members.update({ id: member_id, email: new_email });
      updated = true;
    } catch (e1) {
      console.warn("[confirmEmailChange] format A failed, retry with data:{email}", e1?.message || e1);
      // パターンB：data:{ email }
      await ms.members.update({ id: member_id, data: { email: new_email } });
      updated = true;
    }

    // 3) 成功したらトークンを削除（ワンタイム）
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
