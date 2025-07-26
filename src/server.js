/*──────────────────────────────────────────
  VS-FUND API – server.js
──────────────────────────────────────────*/
console.log("[DEBUG] server.js STARTED");

const path   = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "env", ".env") });

/* ─── インフラ接続 ─── */
require("./db");                            // Postgres
const clean = require("./cleanup");         // 期限切れトークン削除
clean();                                    // 起動直後に 1 回
setInterval(clean, 60 * 60 * 1000);         // 1h ごと

/* ─── ミドルウェア ─── */
const express = require("express");
const cors    = require("cors");
const stripe  = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(express.json());

/* ─── CORS：Webflow だけ許可（cookie 対応）─── */
const WEBFLOW_ORIGIN = "https://vsfund.webflow.io";
app.use(cors({
  origin: WEBFLOW_ORIGIN,          // * は不可。完全一致で指定
  credentials: true,               // ← これで Access-Control-Allow-Credentials:true
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400
}));
app.options("*", cors());           // preflight 404 対策

/* ─── API ルーティング ─── */
app.use("/api", require("./routes"));             // /api/emailChange/*
app.post("/api/change-plan", changePlanHandler);  // 既存 Stripe ハンドラ

/* ─── 動作確認 ─── */
app.get("/", (_, res) => res.send("VS-FUND API running"));

/* ─── 起動 ─── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));

/*──────────────────────────────────────────
  既存: プラン変更ハンドラ
──────────────────────────────────────────*/
async function changePlanHandler(req, res) {
  const { customerId, newPriceId } = req.body;
  try {
    const subs = await stripe.subscriptions.list({
      customer: customerId, status: "active", limit: 1
    });
    const subscription = subs.data[0];
    if (!subscription) return res.status(404).json({ error: "No active subscription found" });

    const updated = await stripe.subscriptions.update(subscription.id, {
      items: [{ id: subscription.items.data[0].id, price: newPriceId }],
      proration_behavior: "none"
    });
    res.json({ success: true, subscription: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
