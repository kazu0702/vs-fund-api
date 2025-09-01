// src/routes/emailChange.js
const router = require("express").Router();
const db     = require("../db");
const crypto = require("crypto");
const MemberstackAdmin = require("@memberstack/admin");
const sgMail = require("@sendgrid/mail");

const ms = MemberstackAdmin.init(process.env.MS_SECRET);

// ===== Webflow のページURL（リダイレクト先） =====
const WEBFLOW_BASE = "https://hau2tdnn1x.webflow.io";
const SUCCESS_URL  = process.env.EMAIL_CHANGE_SUCCESS_URL || `${WEBFLOW_BASE}/email-change-success`;
const FAILED_URL   = process.env.EMAIL_CHANGE_FAILED_URL  || `${WEBFLOW_BASE}/email-change-failed`;

// ===== メール内リンクは API 直叩き（?r=1 でリダイレクト） =====
const API_CONFIRM_BASE =
  process.env.EMAIL_CHANGE_API_CONFIRM_BASE ||
  "https://vs-fund-api.onrender.com/api/emailChange/confirm";

// ===== SendGrid From =====
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || "k-hirai@hirai-syoji.com";
const FROM_NAME  = process.env.SENDGRID_FROM_NAME  || "Victim Support Fund（VSファンド）";

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

/*───────────────────────────────────────────────
  1) リクエスト発行
───────────────────────────────────────────────*/
router.post("/request", async (req, res) => {
  try {
    const { userId, newEmail } = req.body || {};
    if (!userId || !newEmail) {
      return res.status(400).json({ ok:false, error:"missing_params" });
    }

    const token   = crypto.randomUUID();
    const expires = new Date(Date.now() + 1000*60*60); // 1h

    await db.query(
      `INSERT INTO email_change(token, user_id, new_email, expires_at)
       VALUES ($1,$2,$3,$4)`,
      [token, userId, newEmail, expires]
    );

    const confirmUrl = `${API_CONFIRM_BASE}?token=${encodeURIComponent(token)}&r=1`;

    if (process.env.SENDGRID_API_KEY) {
      const html = `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#212121">
          <p>メールアドレス変更の確認のため、下のボタンをクリックしてください。</p>
          <p style="margin:24px 0">
            <a href="${confirmUrl}"
               style="display:inline-block;background:#FF0000;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px">
               変更を確定する
            </a>
          </p>
          <p>ボタンが機能しない場合は、次のURLをブラウザに貼り付けてください：</p>
          <p><a href="${confirmUrl}">${confirmUrl}</a></p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
          <p>このリンクの有効期限は1時間です。心当たりがない場合は、このメールは無視してください。</p>
        </div>
      `;
      await sgMail.send({
        to: newEmail,
        from: { email: FROM_EMAIL, name: FROM_NAME },
        replyTo: { email: FROM_EMAIL, name: FROM_NAME },
        subject: "【VSファンド】メールアドレス変更の確認",
        html,
        mailSettings:{ clickTracking:{ enable:false, enableText:false } }
      });
      console.log("[emailChange/request] mail sent to:", newEmail);
    } else {
      console.warn("[emailChange/request] SENDGRID_API_KEY missing — mail not sent");
    }

    const debug = process.env.DEBUG_EMAIL_CHANGE === "true";
    return res.json(debug ? { ok:true, token, confirmUrl } : { ok:true });
  } catch (err) {
    console.error("[emailChange/request] error:", err);
    return res.status(500).json({ ok:false, error:"server_error" });
  }
});

/*───────────────────────────────────────────────
  2) 確認：SELECT →（更新前メール取得）→ Memberstack更新 → DELETE
     ?r=1 なら 302 で Webflow へ
     DEBUG_EMAIL_CHANGE=true のときは JSON に before/after を含める
───────────────────────────────────────────────*/
router.get("/confirm", async (req, res) => {
  const { token, r } = req.query || {};
  const wantRedirect = String(r) === "1";
  const debug = process.env.DEBUG_EMAIL_CHANGE === "true";

  const sendFail = (reason, message) => {
    if (wantRedirect) {
      const u = new URL(FAILED_URL);
      if (reason)  u.searchParams.set("reason", reason);
      return res.redirect(302, u.toString());
    }
    return res
      .status(400)
      .json(debug ? { ok:false, reason, message } : { ok:false, reason });
  };

  try {
    if (!token) return sendFail("missing_token");

    const sel = await db.query(
      `SELECT user_id, new_email
         FROM email_change
        WHERE token=$1 AND expires_at>NOW()
        LIMIT 1`,
      [token]
    );
    if (sel.rowCount === 0) return sendFail("invalid_or_expired");

    const rec = sel.rows[0];

    // 更新前メールを取得（デバッグ用）
    let beforeEmail = null;
    try {
      const m0 = await ms.members.retrieve({ id: rec.user_id });
      beforeEmail = m0?.email || null;
    } catch (e) {
      console.warn("[emailChange/confirm] could not read before email:", e?.message || e);
    }

    // Memberstack 更新
    try {
      await ms.members.update({ id: rec.user_id, email: rec.new_email });
    } catch (e) {
      const msg = e?.message || String(e);
      console.error("[emailChange/confirm] memberstack update error:", msg);
      return sendFail("memberstack_error", debug ? msg : undefined);
    }

    // 更新後メールを再取得（デバッグ用）
    let afterEmail = null;
    try {
      const m1 = await ms.members.retrieve({ id: rec.user_id });
      afterEmail = m1?.email || null;
    } catch (e) {
      console.warn("[emailChange/confirm] could not read after email:", e?.message || e);
    }

    // 成功したのでトークン消費
    await db.query(`DELETE FROM email_change WHERE token=$1`, [token]);

    if (wantRedirect) {
      return res.redirect(302, SUCCESS_URL);
    }
    // JSON で返す（DEBUG のときだけ詳細を含める）
    return res.json(
      debug
        ? { ok:true, userId: rec.user_id, beforeEmail, afterEmail, setTo: rec.new_email }
        : { ok:true }
    );
  } catch (err) {
    console.error("[emailChange/confirm] error:", err);
    return wantRedirect ? res.redirect(302, FAILED_URL) : res.status(500).json({ ok:false, reason:"server_error" });
  }
});

module.exports = router;
