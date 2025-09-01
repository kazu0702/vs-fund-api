// src/routes/emailChange.js
const router = require("express").Router();
const db     = require("../db");
const crypto = require("crypto");
const MemberstackAdmin = require("@memberstack/admin");
const sgMail = require("@sendgrid/mail");

const controller = require("../controllers/emailChangeController");
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
  1) リクエスト発行（トークン作成 & メール送信）
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
       VALUES ($1, $2, $3, $4)`,
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
        mailSettings: { clickTracking: { enable: false, enableText: false } }
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
  2) 確認（controllers/… に委譲）
───────────────────────────────────────────────*/
router.get("/confirm", controller.confirmEmailChange);

/*───────────────────────────────────────────────
  3) 追加（読み取り用の簡易デバッグAPI）
     GET /api/emailChange/peek?userId=...
     → Memberstack の現在値を返すだけ
───────────────────────────────────────────────*/
router.get("/peek", async (req, res) => {
  try {
    const { userId } = req.query || {};
    if (!userId) return res.status(400).json({ ok:false, error:"missing_userId" });

    const m = await ms.members.retrieve({ id: userId });
    const authEmail = m?.data?.auth?.email ?? null;
    const legacy    = m?.data?.email ?? null;

    return res.json({ ok:true, userId, authEmail, legacy });
  } catch (e) {
    return res.status(500).json({ ok:false, error:"peek_error", message: e?.message });
  }
});

module.exports = router;
