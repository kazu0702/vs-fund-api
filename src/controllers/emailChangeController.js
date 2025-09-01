// src/controllers/emailChangeController.js
const db = require("../db");
const MemberstackAdmin = require("@memberstack/admin");

// peek と同じ：文字列で初期化
const ms = MemberstackAdmin.init(process.env.MS_SECRET);

/**
 * GET /api/emailChange/confirm?token=...&r=1&d=1
 * 1) token を検証
 * 2) Memberstack のメールを更新（優先: updateEmail / 次点: update({email}) / 最後: update({auth:{email}})）
 * 3) 反映確認できたら token を削除。確認できなければ token は温存
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

    // 1) トークンの検証
    const sel = await db.query(
      `SELECT user_id, new_email
         FROM email_change
        WHERE token = $1 AND expires_at > NOW()
        LIMIT 1`,
      [token]
    );
    if (sel.rowCount === 0) return sendFail("invalid_or_expired");

    const userId = sel.rows[0].user_id;
    const setTo  = String(sel.rows[0].new_email || "").trim().toLowerCase(); // 小文字で統一

    // 現在メールの取得関数
    const getEmail = async () => {
      try {
        const r = await ms.members.retrieve({ id: userId });
        return r?.data?.auth?.email ?? r?.data?.email ?? null;
      } catch { return null; }
    };
    const beforeEmail = await getEmail();

    // 2) 更新手順（A→B→C）
    // A: 専用API（推奨）
    let aErr = null, aPayload = null;
    try {
      if (typeof ms.members.updateEmail === "function") {
        aPayload = await ms.members.updateEmail({ memberId: userId, email: setTo });
      } else {
        aErr = "updateEmail method not available";
      }
    } catch (e) { aErr = e?.message || String(e); }

    await new Promise(s => setTimeout(s, 700));
    let afterEmail = await getEmail();
    if (afterEmail === setTo) {
      await db.query(`DELETE FROM email_change WHERE token = $1`, [token]);
      if (wantRedirect && !debug) return res.redirect(302, SUCCESS_URL);
      return res.json(debug ? { ok:true, userId, beforeEmail, afterEmail, setTo, tried:"A(updateEmail)", aErr, aPayload } : { ok:true });
    }

    // B: 互換ルート（email 単体）
    let bErr = null, bPayload = null;
    try {
      bPayload = await ms.members.update({ id: userId, email: setTo });
    } catch (e) { bErr = e?.message || String(e); }

    await new Promise(s => setTimeout(s, 700));
    afterEmail = await getEmail();
    if (afterEmail === setTo) {
      await db.query(`DELETE FROM email_change WHERE token = $1`, [token]);
      if (wantRedirect && !debug) return res.redirect(302, SUCCESS_URL);
      return res.json(debug ? { ok:true, userId, beforeEmail, afterEmail, setTo, tried:"A→B", aErr, bErr, aPayload, bPayload } : { ok:true });
    }

    // C: 2.0 プロパティ（auth.email）
    let cErr = null, cPayload = null;
    try {
      cPayload = await ms.members.update({ id: userId, auth: { email: setTo } });
    } catch (e) { cErr = e?.message || String(e); }

    await new Promise(s => setTimeout(s, 700));
    afterEmail = await getEmail();
    if (afterEmail === setTo) {
      await db.query(`DELETE FROM email_change WHERE token = $1`, [token]);
      if (wantRedirect && !debug) return res.redirect(302, SUCCESS_URL);
      return res.json(debug ? { ok:true, userId, beforeEmail, afterEmail, setTo, tried:"A→B→C", aErr, bErr, cErr, aPayload, bPayload, cPayload } : { ok:true });
    }

    // 反映されず → トークン温存
    return sendFail("memberstack_not_applied",
      debug ? { tried:"A→B→C", aErr, bErr, cErr, beforeEmail, afterEmail, setTo, aPayload, bPayload, cPayload } : undefined
    );

  } catch (err) {
    const msg = err?.message || String(err);
    if (wantRedirect && !debug) return res.redirect(302, FAILED_URL);
    return res.status(500).json({ ok:false, reason:"server_error", message: (debug ? msg : undefined) });
  }
};
