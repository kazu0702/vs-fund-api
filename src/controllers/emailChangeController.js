// src/controllers/emailChangeController.js
const db = require("../db");
const MemberstackAdmin = require("@memberstack/admin");

// peek と同じ：文字列で初期化
const ms = MemberstackAdmin.init(process.env.MS_SECRET);

/**
 * GET /api/emailChange/confirm?token=...&r=1&d=1
 * 1) token 検証
 * 2) Memberstack の email を data.email で更新
 * 3) 成功したら新メール宛に verification email を自動送信
 * 4) 反映を確認できたら token を削除
 * 5) r=1 なら成功/失敗ページへ 302 リダイレクト
 * 6) d=1 or DEBUG 時は詳細 JSON を返す
 */
exports.confirmEmailChange = async (req, res) => {
  const { token, r, d } = req.query || {};
  const wantRedirect = String(r) === "1";
  const debug        = String(d) === "1" || process.env.DEBUG_EMAIL_CHANGE === "true";

  const WEBFLOW_BASE = "https://hau2tdnn1x.webflow.io";
  const SUCCESS_URL  = process.env.EMAIL_CHANGE_SUCCESS_URL || `${WEBFLOW_BASE}/email-change-success`;
  const FAILED_URL   = process.env.EMAIL_CHANGE_FAILED_URL  || `${WEBFLOW_BASE}/email-change-failed`;

  const redirect = (url, params = {}) => {
    const u = new URL(url);
    Object.entries(params).forEach(([k, v]) => v != null && u.searchParams.set(k, String(v)));
    return res.redirect(302, u.toString());
  };

  const sendFail = (reason, extra) => {
    if (wantRedirect && !debug) return redirect(FAILED_URL, { reason });
    const body = { ok:false, reason };
    if (debug && extra) body.extra = extra;
    return res.status(400).json(body);
  };

  try {
    if (!token) return sendFail("missing_token");

    // 1) token 検証
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

    // 現在値の取得
    const getEmail = async () => {
      try {
        const r = await ms.members.retrieve({ id: userId });
        return r?.data?.auth?.email ?? r?.data?.email ?? null;
      } catch { return null; }
    };
    const beforeEmail = await getEmail();

    // 2) email を更新（正しい形：data.email）
    let updErr = null, updPayload = null;
    try {
      updPayload = await ms.members.update({
        id: userId,
        data: { email: setTo }
      });
    } catch (e) {
      updErr = e?.message || String(e);
      return sendFail("memberstack_update_failed", debug ? { updErr } : undefined);
    }

    // 反映確認（伝播待ち）
    await new Promise(s => setTimeout(s, 700));
    const afterEmail = await getEmail();
    if (afterEmail !== setTo) {
      return sendFail("memberstack_not_applied",
        debug ? { beforeEmail, afterEmail, setTo, updErr, updPayload } : undefined
      );
    }

    // 3) 認証メールを自動送信（使えない環境でも API 全体は成功にする）
    let sentVerification = false;
    let sendErr = null;
    try {
      if (typeof ms.members.sendVerificationEmail === "function") {
        await ms.members.sendVerificationEmail({ memberId: userId });
        sentVerification = true;
      } else {
        sendErr = "sendVerificationEmail not available";
      }
    } catch (e) {
      sendErr = e?.message || String(e);
    }

    // 4) token を消費
    await db.query(`DELETE FROM email_change WHERE token = $1`, [token]);

    // 5) レスポンス
    if (wantRedirect && !debug) {
      return redirect(SUCCESS_URL, { sent: sentVerification ? 1 : 0 });
    }

    // JSON（デバッグ）
    return res.json({
      ok: true,
      userId,
      beforeEmail,
      afterEmail,
      setTo,
      sentVerification,
      ...(debug ? { updPayload, sendErr } : {})
    });

  } catch (err) {
    const msg = err?.message || String(err);
    if (wantRedirect && !debug) return redirect(FAILED_URL, { reason: "server_error" });
    return res.status(500).json({ ok:false, reason:"server_error", message: (debug ? msg : undefined) });
  }
};
