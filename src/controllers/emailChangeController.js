// src/controllers/emailChangeController.js
const db = require("../db");
const MemberstackAdmin = require("@memberstack/admin");

// Admin SDK 初期化（公式推奨のオブジェクト引数）
const ms = MemberstackAdmin.init({ secret: process.env.MS_SECRET });

/**
 * GET /api/emailChange/confirm?token=...&r=1&d=1
 * - token が有効なら Memberstack の email を更新
 * - まず { email } 単体で更新 → 反映を確認
 * - 反映されなければ { auth: { email } } も試す（2系プロパティ）
 * - デバッグ時(d=1)は Memberstack からの戻り値(payload)も返す
 * - 反映未確認のときはトークンを消さずに残す（再実行できるように）
 */
exports.confirmEmailChange = async (req, res) => {
  const { token, r, d } = req.query || {};
  const wantRedirect = String(r) === "1";
  const debug        = String(d) === "1" || process.env.DEBUG_EMAIL_CHANGE === "true";

  const WEBFLOW_BASE = "https://hau2tdnn1x.webflow.io";
  const SUCCESS_URL  = process.env.EMAIL_CHANGE_SUCCESS_URL || `${WEBFLOW_BASE}/email-change-success`;
  const FAILED_URL   = process.env.EMAIL_CHANGE_FAILED_URL  || `${WEBFLOW_BASE}/email-change-failed`;

  const sendFail = (reason, extra) => {
    if (wantRedirect && !debug) {
      const u = new URL(FAILED_URL);
      if (reason) u.searchParams.set("reason", reason);
      return res.redirect(302, u.toString());
    }
    const body = { ok:false, reason };
    if (debug && extra) body.extra = extra;
    return res.status(400).json(body);
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

    const userId = sel.rows[0].user_id;
    const setTo  = sel.rows[0].new_email;

    // 更新前メール
    const getEmail = async () => {
      try {
        const r = await ms.members.retrieve({ id: userId });
        return r?.data?.auth?.email ?? r?.data?.email ?? null;
      } catch { return null; }
    };

    const beforeEmail = await getEmail();

    // 方式A：{ email } 単体（1系互換）
    let aErr = null, aPayload = null;
    try {
      aPayload = await ms.members.update({ id: userId, email: setTo });
    } catch (e) {
      aErr = e?.message || String(e);
    }

    await new Promise(s => setTimeout(s, 600)); // 伝播待ち
    let afterEmail = await getEmail();

    // A で反映されていれば終了
    if (afterEmail === setTo) {
      await db.query(`DELETE FROM email_change WHERE token = $1`, [token]);
      if (wantRedirect && !debug) return res.redirect(302, SUCCESS_URL);
      return res.json(
        debug
          ? { ok:true, userId, beforeEmail, afterEmail, setTo, tried:"A(email)", aErr, aPayload }
          : { ok:true }
      );
    }

    // 方式B：{ auth: { email } }（2系プロパティ）
    let bErr = null, bPayload = null;
    try {
      bPayload = await ms.members.update({ id: userId, auth: { email: setTo } });
    } catch (e) {
      bErr = e?.message || String(e);
    }

    await new Promise(s => setTimeout(s, 600));
    afterEmail = await getEmail();

    if (afterEmail === setTo) {
      await db.query(`DELETE FROM email_change WHERE token = $1`, [token]);
      if (wantRedirect && !debug) return res.redirect(302, SUCCESS_URL);
      return res.json(
        debug
          ? { ok:true, userId, beforeEmail, afterEmail, setTo, tried:"A→B", aErr, bErr, aPayload, bPayload }
          : { ok:true }
      );
    }

    // どちらの方式でも変わらない → トークンは温存（再実行できるように）
    return sendFail("memberstack_not_applied", debug ? { tried:"A→B", aErr, bErr, aPayload, bPayload, beforeEmail, afterEmail, setTo } : undefined);

  } catch (err) {
    const msg = err?.message || String(err);
    if (wantRedirect && !debug) return res.redirect(302, FAILED_URL);
    return res.status(500).json({ ok:false, reason:"server_error", message: (debug ? msg : undefined) });
  }
};
