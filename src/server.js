/*************************************************
 * VS-FUND API – server.js (robust env & debug)
 *************************************************/
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", (err && err.stack) || err);
});

console.log("[DEBUG] server.js STARTED");

/*─ .env 読み込み（env/.env 優先 → なければ直下 .env） ─*/
const fs = require("fs");
const path = require("path");
let loadedEnvPath = null;
const candidates = [
  path.resolve(__dirname, "..", "env", ".env"), // 以前の構成
  path.resolve(process.cwd(), ".env"),          // プロジェクト直下
];
for (const p of candidates) {
  if (fs.existsSync(p)) {
    require("dotenv").config({ path: p });
    loadedEnvPath = p;
    break;
  }
}
if (!loadedEnvPath) {
  // CI / Render 等で環境変数を直接注入しているパターン
  require("dotenv").config(); // 最後に一応デフォルトも試す
}
console.log("[ENV] loaded from:", loadedEnvPath || "process env");

/*─ 主要キーの有無＋長さだけログ（値は出さない） ─*/
const has = (k) => (process.env[k] && process.env[k].length ? "set" : "missing");
const _sec = process.env.MS_SECRET || "";
const _app = process.env.MS_APP_ID || "";
console.log("[ENV] SENDGRID_API_KEY :", has("SENDGRID_API_KEY"));
console.log("[ENV] MS_APP_ID       :", _app ? `set(len=${_app.length})` : "missing");
console.log("[ENV] MS_SECRET       :", _sec ? `set(len=${_sec.length})` : "missing");
if (_sec) {
  console.log("[ENV] MS_SECRET head/tail:", _sec.slice(0, 6) + "..." + _sec.slice(-4));
}
console.log("[ENV] STRIPE_SECRET_KEY:", has("STRIPE_SECRET_KEY"));
console.log("[ENV] DATABASE_URL    :", has("DATABASE_URL"));

/*─ DB 接続 ─*/
require("./db"); // Postgres 接続（失敗時はプロセス終了）

/*─ 定期クリーンアップ ─*/
const clean = require("./cleanup");
clean(); // 起動直後
setInterval(clean, 60 * 60 * 1000); // 1h ごと

/*─ ミドルウェア ─*/
const express = require("express");
const cors = require("cors");
const app = express();
app.use(express.json());

/*─ CORS: Webflow だけ許可（ENV優先 / 既定は新ドメイン） ─*/
const ORIGIN = process.env.ORIGIN || "https://hau2tdnn1x.webflow.io";
console.log("[ENV] CORS ORIGIN:", ORIGIN);
app.use(
  cors({
    origin: ORIGIN,
    credentials: true,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
    maxAge: 86400,
  })
);

/*─ ルーティング ─*/
app.use("/api", require("./routes")); // emailChange など

/*─ 健康チェック ─*/
app.get("/healthz", (_req, res) => {
  res.status(200).type("text/plain").send("ok");
});

/*───────────────────────────────────────────────
  ★ SendGrid 単体スモークテスト（暫定）
  curl 例:
  curl -X POST http://localhost:3000/api/_debug/sendgrid \
    -H "Content-Type: application/json" \
    -d '{"to":"you@example.com"}'
───────────────────────────────────────────────*/
app.post("/api/_debug/sendgrid", async (req, res) => {
  try {
    const { to } = req.body || {};
    if (!to) return res.status(400).json({ ok: false, error: "'to' is required" });

    if (!process.env.SENDGRID_API_KEY) {
      return res.status(500).json({ ok: false, error: "SENDGRID_API_KEY is missing" });
    }
    const sgMail = require("@sendgrid/mail");
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);

    await sgMail.send({
      to,
      from: { email: "k-hirai@hirai-syoji.com", name: "Victim Support Fund（VSファンド）" },
      replyTo: { email: "k-hirai@hirai-syoji.com", name: "Victim Support Fund（VSファンド）" },
      subject: "VSファンド デバッグ送信",
      text: "このメールが届けば SendGrid とAPIキーは有効です。",
      // 追跡リンク無効化（任意）
      mailSettings: { clickTracking: { enable: false, enableText: false } },
    });

    console.log("[_debug/sendgrid] sent to:", to);
    res.json({ ok: true });
  } catch (err) {
    console.error("[_debug/sendgrid] error:", err.response?.body || err);
    res.status(500).json({ ok: false, error: err.response?.body || err.message });
  }
});

/*───────────────────────────────────────────────
  ★ Memberstack キー整合チェック（取得のみ / 安全）
  curl 例:
  curl -X POST http://localhost:3000/api/_debug/memberstack \
    -H "Content-Type: application/json" \
    -d '{"memberId":"mem_sb_xxx"}'
───────────────────────────────────────────────*/
app.post("/api/_debug/memberstack", async (req, res) => {
  try {
    const { memberId } = req.body || {};
    if (!memberId) return res.status(400).json({ ok: false, error: "'memberId' is required" });

    const MemberstackAdmin = require("@memberstack/admin");
    // 公式推奨：init は secret 文字列だけ渡す
    const ms = MemberstackAdmin.init(process.env.MS_SECRET);

    // retrieve で存在確認（鍵・サイト・モードの整合検査）
    const m = await ms.members.retrieve({ id: memberId });
    return res.json({ ok: true, id: m.id });
  } catch (err) {
    const code = err?.code || err?.name || "unknown";
    const msg = err?.message || String(err);
    console.error("[_debug/memberstack] error:", code, msg);
    return res.status(500).json({ ok: false, code, error: msg });
  }
});

/*-----------------------------------------------
  Stripe プラン変更ハンドラ
-----------------------------------------------*/
const stripe = process.env.STRIPE_SECRET_KEY
  ? require("stripe")(process.env.STRIPE_SECRET_KEY)
  : null;

app.post("/api/change-plan", changePlan);

async function changePlan(req, res) {
  try {
    if (!stripe) {
      return res.status(500).json({ error: "STRIPE_SECRET_KEY is missing" });
    }
    const { customerId, newPriceId } = req.body || {};
    if (!customerId || !newPriceId) {
      return res.status(400).json({ error: "customerId and newPriceId are required" });
    }

    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "active",
      limit: 1,
    });
    const sub = subs.data[0];
    if (!sub) return res.status(404).json({ error: "No active subscription" });

    const updated = await stripe.subscriptions.update(sub.id, {
      items: [{ id: sub.items.data[0].id, price: newPriceId }],
      proration_behavior: "none",
    });
    res.json({ success: true, subscription: updated });
  } catch (err) {
    console.error("[change-plan] error:", err);
    res.status(500).json({ error: err.message });
  }
}

/*──────────── ここを追加：ルート（/）応答 ────────────*/
app.get("/", (_req, res) => {
  res.type("text/plain").send("VS-FUND API running");
});

/*─ サーバー起動 ─*/
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, "0.0.0.0", () => console.log(`Ready on ${PORT}`));
