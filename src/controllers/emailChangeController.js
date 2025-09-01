// src/controllers/emailChangeController.js
const db = require("../db");
const MemberstackAdmin = require("@memberstack/admin");

const ms = MemberstackAdmin.init(process.env.MS_SECRET);

/**
 * GET /api/emailChange/confirm?token=...&r=1&d=1
 * - token が有効なら Memberstack の email を更新
 * - ?r=1 なら Webflow の成功/失敗ページに 302 リダイレクト
 * - ?d=1 ならデバッグ JSON（before/after など）を返す
 */
exports.confirmEmailChange = async (req, res) => {
  const { token, r, d } = req.query || {};
  const wantRedirect = String(r) === "1";
  const debug        = String(d) === "1" || process.env.DEBUG_EMAIL_CHANGE === "true";

  const WEBFLOW_BASE = "https://hau2tdnn1x.webflow.io";
  const SUCCESS_URL  = process.env.EMAIL_CHANGE_SUCCESS_URL || `${WEBFLOW_BASE}/email-change-success`;
  const FAILED_URL   = process.env.EMAIL_CHANGE_FAILED_URL  || `${WEBFLOW_BASE}/email-change-failed`;

  const sendFail = (reason, message) => {
    if (wantRedirect && !debug) {
      const u = new URL(FAILED_URL);
      if (reason) u.searchParams.set("reason", reason);
      return res.redirect(302, u.toString());
    }
    return res
      .status(400)
      .json(debug ? { ok:false, reason, message } : { ok:false, reason });
  };

  try {
    if (!token) return sendFail("missing_token");

    // 有効トークンを取得
    const sel = await db.query(
      `SELECT user_id, new_email
         FROM email_change
        WHERE token = $1 AND expires_at > NOW()
        LIMIT 1`,
      [token]
    );
    if (sel.rowCount === 0) return sendFail("invalid_or_expired");
    const { user_id: userId, new_email: setTo } = sel.rows[0];

    // 更新前メールの取得
    let beforeEmail = null;
    try {
      const m0 = await ms.members.retrieve({ id: userId });
      // auth.email が表示上の実メール。旧フィールドは m0.data.email のことも
      beforeEmail = m0?.data?.auth?.email ?? m0?.data?.email ?? null;
    } catch (_) {}

    // —— ここが本丸：email 単体で更新 ——
    await ms.members.update({ id: userId, email: setTo });

    // 反映に僅かなタイムラグが出ることがあるので 500ms 待ってから再取得
    await new Promise(r => setTimeout(r, 500));

    // 更新後メールの取得
    let afterEmail = null;
    try {
      const m1 = await ms.members.retrieve({ id: userId });
      afterEmail = m1?.data?.auth?.email ?? m1?.data?.email ?? null;
    } catch (_) {}

    // トークンを消費
    await db.query(`DELETE FROM email_change WHERE token = $1`, [token]);

    if (wantRedirect && !debug) {
      return res.redirect(302, SUCCESS_URL);
    }
    return res.json(
      debug
        ? { ok:true, userId, beforeEmail, afterEmail, setTo }
        : { ok:true }
    );
  } catch (err) {
    const message = err?.message || String(err);
    return wantRedirect && !debug
      ? res.redirect(302, FAILED_URL)
      : res.status(500).json({ ok:false, reason:"server_error", message: (debug ? message : undefined) });
  }
};
