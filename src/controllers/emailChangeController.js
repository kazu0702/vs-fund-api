// src/controllers/emailChangeController.js
const db = require("../db");
const MemberstackAdmin = require("@memberstack/admin");

const ms = MemberstackAdmin.init(process.env.MS_SECRET);

/**
 * GET /api/emailChange/confirm?token=...&r=1&d=1
 * - token が有効なら Memberstack の auth.email を更新
 * - ?r=1 の場合は Webflow 成功/失敗ページへ 302 リダイレクト
 * - ?d=1 の場合は強制デバッグ出力（before/after など）を JSON で返す
 */
exports.confirmEmailChange = async (req, res) => {
  const { token, r, d } = req.query || {};
  const wantRedirect = String(r) === "1";
  const forceDebug   = String(d) === "1";
  const envDebug     = process.env.DEBUG_EMAIL_CHANGE === "true";
  const debug        = forceDebug || envDebug;

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

    // 更新前メールを取得
    let beforeEmail = null;
    try {
      const m0 = await ms.members.retrieve({ id: rec.user_id });
      beforeEmail = m0?.data?.auth?.email ?? m0?.data?.email ?? null;
    } catch (e) {
      beforeEmail = null;
    }

    // Memberstack 更新（auth.email → 旧SDK互換で email もフォールバック）
    try {
      // まず auth.email を試す（MS2.0）
      await ms.members.update({ id: rec.user_id, auth: { email: rec.new_email } });
    } catch (e1) {
      // 失敗したら旧フィールドでも試行
      try {
        await ms.members.update({ id: rec.user_id, email: rec.new_email });
      } catch (e2) {
        const msg = `auth.email:${e1?.message || e1} / email:${e2?.message || e2}`;
        return sendFail("memberstack_error", debug ? msg : undefined);
      }
    }

    // 更新後メールを再取得
    let afterEmail = null;
    try {
      const m1 = await ms.members.retrieve({ id: rec.user_id });
      afterEmail = m1?.data?.auth?.email ?? m1?.data?.email ?? null;
    } catch (e) {
      afterEmail = null;
    }

    // 使い終わったトークンは削除
    await db.query(`DELETE FROM email_change WHERE token = $1`, [token]);

    if (wantRedirect && !debug) {
      return res.redirect(302, SUCCESS_URL);
    }
    return res.json(
      debug
        ? { ok:true, userId: rec.user_id, beforeEmail, afterEmail, setTo: rec.new_email }
        : { ok:true }
    );
  } catch (err) {
    return wantRedirect && !debug
      ? res.redirect(302, FAILED_URL)
      : res.status(500).json({ ok:false, reason:"server_error", message: (process.env.DEBUG_EMAIL_CHANGE === "true" ? err?.message : undefined) });
  }
};
