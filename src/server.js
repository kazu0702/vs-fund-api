/*************************************************
 * VS-FUND API – server.js (env, routes, debug)
 *************************************************/
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", (err && err.stack) || err);
});

console.log("[DEBUG] server.js STARTED");

/*─ .env 読み込み ─*/
const fs = require("fs");
const path = require("path");
let loadedEnvPath = null;
const candidates = [
  path.resolve(__dirname, "..", "env", ".env"),
  path.resolve(process.cwd(), ".env"),
];
for (const p of candidates) {
  if (fs.existsSync(p)) {
    require("dotenv").config({ path: p });
    loadedEnvPath = p;
    break;
  }
}
if (!loadedEnvPath) require("dotenv").config();
console.log("[ENV] loaded from:", loadedEnvPath || "process env");

/*─ 主要キーの有無ログ ─*/
const has = (k) => (process.env[k] && process.env[k].length ? "set" : "missing");
const _sec = process.env.MS_SECRET || "";
const _app = process.env.MS_APP_ID || "";
console.log("[ENV] SENDGRID_API_KEY :", has("SENDGRID_API_KEY"));
console.log("[ENV] MS_APP_ID       :", _app ? `set(len=${_app.length})` : "missing");
console.log("[ENV] MS_SECRET       :", _sec ? `set(len=${_sec.length})` : "missing");
if (_sec) console.log("[ENV] MS_SECRET head/tail:", _sec.slice(0,6) + "..." + _sec.slice(-4));
console.log("[ENV] STRIPE_SECRET_KEY:", has("STRIPE_SECRET_KEY"));
console.log("[ENV] DATABASE_URL    :", has("DATABASE_URL"));

/*─ DB 接続 ─*/
require("./db");

/*─ 定期クリーンアップ ─*/
const clean = require("./cleanup");
clean();
setInterval(clean, 60 * 60 * 1000);

/*─ サーバ基盤 ─*/
const express = require("express");
const cors = require("cors");
const app = express();
app.use(express.json());

/* アクセスログ（/healthz は抑制） */
app.use((req, _res, next) => {
  if (req.method !== "GET" || req.path !== "/healthz") {
    console.log(`[REQ] ${req.method} ${req.url}`);
  }
  next();
});

/*─ CORS ─*/
const ORIGIN = process.env.ORIGIN || "https://hau2tdnn1x.webflow.io";
console.log("[ENV] CORS ORIGIN:", ORIGIN);
app.use(cors({
  origin: ORIGIN,
  credentials: true,
  methods: ["GET","POST"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400
}));

/*─ ルーティング ─*/
app.use("/api", require("./routes"));

/*─ 健康チェック ─*/
app.get("/healthz", (_req, res) => res.status(200).type("text/plain").send("ok"));

/*==== デバッグ：SendGrid ====*/
app.post("/api/_debug/sendgrid", async (req, res) => {
  try {
    const { to } = req.body || {};
    if (!to) return res.status(400).json({ ok:false, error:"'to' is required" });
    if (!process.env.SENDGRID_API_KEY) {
      return res.status(500).json({ ok:false, error:"SENDGRID_API_KEY is missing" });
    }
    const sgMail = require("@sendgrid/mail");
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    await sgMail.send({
      to,
      from: { email: process.env.SENDGRID_FROM_EMAIL || "k-hirai@hirai-syoji.com",
              name:  process.env.SENDGRID_FROM_NAME  || "Victim Support Fund（VSファンド）" },
      replyTo: { email: process.env.SENDGRID_FROM_EMAIL || "k-hirai@hirai-syoji.com",
                 name:  process.env.SENDGRID_FROM_NAME  || "Victim Support Fund（VSファンド）" },
      subject: "VSファンド デバッグ送信",
      text: "このメールが届けば SendGrid とAPIキーは有効です。",
      mailSettings: { clickTracking: { enable:false, enableText:false } }
    });
    console.log("[_debug/sendgrid] sent to:", to);
    res.json({ ok:true });
  } catch (err) {
    console.error("[_debug/sendgrid] error:", err.response?.body || err);
    res.status(500).json({ ok:false, error: err.response?.body || err.message });
  }
});

/*==== デバッグ：Memberstack 取得/更新 ====*/
app.post("/api/_debug/memberstack", async (req, res) => {
  try {
    const { memberId, email } = req.body || {};
    if (!memberId) return res.status(400).json({ ok:false, error:"'memberId' is required" });

    const MemberstackAdmin = require("@memberstack/admin");
    const ms = MemberstackAdmin.init(process.env.MS_SECRET);

    if (email) {
      // 更新→再取得
      await ms.members.update({ id: memberId, email });
      const m2 = await ms.members.retrieve({ id: memberId });
      return res.json({ ok:true, id: m2.id, email: m2.email });
    } else {
      // 取得のみ
      const m = await ms.members.retrieve({ id: memberId });
      return res.json({ ok:true, id: m.id, email: m.email });
    }
  } catch (err) {
    const code = err?.code || err?.name || "unknown";
    const msg  = err?.message || String(err);
    console.error("[_debug/memberstack] error:", code, msg);
    return res.status(500).json({ ok:false, code, error: msg });
  }
});

/*==== Stripe（既存） ====*/
const stripe = process.env.STRIPE_SECRET_KEY ? require("stripe")(process.env.STRIPE_SECRET_KEY) : null;
app.post("/api/change-plan", changePlan);
async function changePlan(req, res){
  try{
    if (!stripe) return res.status(500).json({ error:"STRIPE_SECRET_KEY is missing" });
    const { customerId, newPriceId } = req.body || {};
    if (!customerId || !newPriceId) return res.status(400).json({ error:"customerId and newPriceId are required" });

    const subs = await stripe.subscriptions.list({ customer: customerId, status:"active", limit:1 });
    const sub = subs.data[0];
    if (!sub) return res.status(404).json({ error:"No active subscription" });

    const updated = await stripe.subscriptions.update(sub.id, {
      items:[{ id: sub.items.data[0].id, price: newPriceId }],
      proration_behavior:"none"
    });
    res.json({ success:true, subscription:updated });
  } catch(err){
    console.error("[change-plan] error:", err);
    res.status(500).json({ error:err.message });
  }
}

/*─ ルート（/） ─*/
app.get("/", (_req, res) => res.type("text/plain").send("VS-FUND API running"));

/*─ 起動 ─*/
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, "0.0.0.0", () => console.log(`Ready on ${PORT}`));
