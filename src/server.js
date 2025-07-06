console.log("[DEBUG] server.js STARTED");

const path   = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "..", "env", ".env") });

const express = require("express");
const cors    = require("cors");
const stripe  = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(express.json());

// Webflow からのアクセスのみ許可（GET も追加）
app.use(cors({
  origin: ["https://izokukikin.webflow.io"],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

// ここでルートをバインド
app.use("/api", require("./routes"));   // ← これで /api/emailChange/... が有効

// ---------- 既存の change-plan を /api 配下へ整理 ----------
app.post("/api/change-plan", async (req, res) => {
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
});

// 動作確認用
app.get("/", (_, res) => res.send("VS-FUND API running"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
