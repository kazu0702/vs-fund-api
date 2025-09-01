// src/controllers/emailChangeController.js
const db = require("../db");
const MemberstackAdmin = require("@memberstack/admin");

const ms = MemberstackAdmin.init(process.env.MS_SECRET);

/**
 * GET /api/emailChange/confirm?token=...&r=1
 * - token が有効なら Memberstack の auth.email を更新
 * - ?r=1 の場合は Webflow 成功/失敗ページへ 302 リダイレクト
 */
exports.confirmEmailChange = async (req, res) => {
  const { token, r } = req.query || {};
  const wantRedirect = String(r) === "1";
  const WEBFLOW_BASE = "https://hau2tdnn1x.webflow.io";
  const SUCCESS_URL  = process.env.EMAIL_CHANGE_SUCCESS_URL || `${WEBFLOW_BASE}/email-change-success`;
  const FAILED_URL   = process.env.EMAIL_CHANGE_FAILED_URL  || `${WEBFLOW_BASE}/email-change-failed`;
  const debug = process.env.DEBUG_EMAIL_CHANGE === "true";

  const sendFail = (reason, message) => {
    if (wantRedirect) {
      const u = new URL(FAILED_URL);
      if (reason) u.searchParams.set("reason", reason);
      return res.redirect(302, u.toString());
    }
    return res.status(400).json(debug ? { ok:false, reason, message } : { ok:false, reason });
  };

  try {
    if (!token) return sendFail("missing_token");

    // トークン検証（有効期限内のものを取得）
    const sel = await db.query(
      `SELECT user_id, new_email
         FROM email_change
        WHERE token = $1 AND expires_at > NOW()
        LIMIT 1`,
      [token]
    );
    if (sel.rowCount === 0) return sendFail("invalid_or_expired");

    const rec = sel.rows[0];

    // Memberstack: auth.email に更新
    try {
      await ms.members.update({ id: rec.user_id, auth: { email: rec.new_email } });
    } catch (e) {
      const msg = e?.message || String(e);
      console.error("[confirmEmailChange] memberstack update error:", msg);
      return sendFail("memberstack_error", debug ? msg : undefined);
    }

    // 使い終わったトークンは削除
    await db.query(`DELETE FROM email_change WHERE token = $1`, [token]);

    if (wantRedirect) {
      return res.redirect(302, SUCCESS_URL);
    }
    return res.json({ ok: true });
  } catch (err) {
    console.error("[confirmEmailChange] error:", err);
    return wantRedirect ? res.redirect(302, FAILED_URL) : res.status(500).json({ ok:false, reason:"server_error" });
  }
};
