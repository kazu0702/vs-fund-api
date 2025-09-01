// src/routes/emailChange.js
const router = require("express").Router();
const db     = require("../db");
const crypto = require("crypto");
const MemberstackAdmin = require("@memberstack/admin");
const sgMail = require("@sendgrid/mail");

// ====== 設定 ======
const ms = MemberstackAdmin.init(process.env.MS_SECRET);

// Webflow 側の確認ページ（?token=... を付ける）
const CONFIRM_BASE =
  process.env.EMAIL_CHANGE_CONFIRM_BASE ||
  "https://hau2tdnn1x.webflow.io/email-change-confirm";

// 送信元（SendGridで認証済みのFromに必ず変更）
const FROM_EMAIL =
  process.env.SENDGRID_FROM_EMAIL || "k-hirai@hirai-syoji.com";
const FROM_NAME =
  process.env.SENDGRID_FROM_NAME || "Victim Support Fund（VSファンド）";

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

// ========== 1) リクエスト発行 ==========
router.post("/request", async (req, res) => {
  try {
    const { userId, newEmail } = req.body || {};
    if (!userId || !newEmail) {
      return res.status(400).json({ ok: false, error: "missing_params" });
    }

    const token   = crypto.randomUUID();
    const expires = new Date(Date.now() + 1000 * 60 * 60); // 1時間
    await db.query(
      `INSERT INTO email_change(token, user_id, new_email, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [token, userId, newEmail, expires]
    );

    // ---- SendGrid で確認メール送信 ----
    if (!process.env.SENDGRID_API_KEY) {
      console.warn("[emailChange/request] SENDGRID_API_KEY is missing — skip sending");
    } else {
      const confirmUrl = `${CONFIRM_BASE}?token=${encodeURIComponent(token)}`;
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
      const msg = {
        to: newEmail,
        from: { email: FROM_EMAIL, name: FROM_NAME },
        replyTo: { email: FROM_EMAIL, name: FROM_NAME },
        subject: "【VSファンド】メールアドレス変更の確認",
        html,
        // 追跡リンクを無効化（URL書き換え防止）
        mailSettings: { clickTracking: { enable: false, enableText: false } },
      };

      try {
        await sgMail.send(msg);
        console.log("[emailChange/request] confirmation email sent to:", newEmail);
      } catch (e) {
        // 送信失敗でもトークンは発行済み。原因調査用にログだけ残し、APIは200で返す。
        console.error("[emailChange/request] SendGrid error:", e.response?.body || e.message);
      }
    }

    const debug = process.env.DEBUG_EMAIL_CHANGE === "true";
    return res.json(debug ? { ok: true, token } : { ok: true });
  } catch (err) {
    console.error("[emailChange/request] error:", err);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
});

// ========== 2) 確認（トークン消費） ==========
router.get("/confirm", async (req, res) => {
  try {
    const { token } = req.query || {};
    if (!token) return res.status(400).json({ ok: false, reason: "missing_token" });

    const { rows } = await db.query(
      `DELETE FROM email_change
         WHERE token = $1 AND expires_at > NOW()
       RETURNING user_id, new_email`,
      [token]
    );
    if (rows.length === 0) {
      return res.status(400).json({ ok: false, reason: "invalid_or_expired" });
    }

    const rec = rows[0];
    await ms.members.update({ id: rec.user_id, email: rec.new_email });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[emailChange/confirm] error:", err);
    return res.status(500).json({ ok: false, reason: "server_error" });
  }
});

module.exports = router;
