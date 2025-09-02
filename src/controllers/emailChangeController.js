// src/controllers/emailChangeController.js
const db = require("../db");
const MemberstackAdmin = require("@memberstack/admin");

// peek と同じ方式で初期化（文字列）
const ms = MemberstackAdmin.init(process.env.MS_SECRET);

/**
 * GET /api/emailChange/confirm?token=...&r=1&d=1
 * - token を検証
 * - Memberstack の email を更新（正しい形：data.email）
 * - 反映を確認できたときだけトークン削除
 * - d=1 で詳細デバッグを返す
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

    // 有効トークンの読み出し
    const sel = await db.query(
      `SELECT user_id, new_email
         FROM email_change
        WHERE token = $1 AND expires_at > NOW()
        LIMIT 1`,
      [token]
    );
    if (sel.rowCount === 0) return sendFail("invalid_or_expired");

    const userId = sel.rows[0].user_id;
    const setTo  = String(sel.rows[0].new_email || "").trim().toLowerCase();

    // 現在メール取得
    const getEmail = async () => {
      try {
        const r = await ms.members.retrieve({ id: userId });
        return r?.data?.auth?.email ?? r?.data?.email ?? null;
      } catch { return null; }
    };
    const beforeEmail = await getEmail();

    // —— 正しい更新形：data.email ——
    let updErr = null, updPayload = null;
    try {
      updPayload = await ms.members.update({
        id: userId,
        data: { email: setTo }   // ← ここが重要
      });
    } catch (e) {
      updErr = e?.message || String(e);
    }

    // 反映確認（若干の伝播待ち）
    await new Promise(s => setTimeout(s, 700));
    const afterEmail = await getEmail();

    if (afterEmail === setTo) {
      await db.query(`DELETE FROM email_change WHERE token = $1`, [token]);
      if (wantRedirect && !debug) return res.redirect(302, SUCCESS_URL);
      return res.json(debug ? { ok:true, userId, beforeEmail, afterEmail, setTo, updPayload } : { ok:true });
    }

    // 反映されない → トークンは温存して失敗レス
    return sendFail(
      "memberstack_not_applied",
      debug ? { beforeEmail, afterEmail, setTo, updErr, updPayload } : undefined
    );

  } catch (err) {
    const msg = err?.message || String(err);
    if (wantRedirect && !debug) return res.redirect(302, FAILED_URL);
    return res.status(500).json({ ok:false, reason:"server_error", message: (debug ? msg : undefined) });
  }
};
