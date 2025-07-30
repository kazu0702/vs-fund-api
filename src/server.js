/*************************************************
 * VS-FUND API – server.js
 *************************************************/
process.on("uncaughtException", function (err) {
  console.error("UNCAUGHT EXCEPTION:", err.stack);
});

console.log("[DEBUG] server.js STARTED");

require("dotenv").config();          // ルートの .env を読む
require("./db");                     // Postgres 接続

/*─ 定期クリーンアップ ─*/
const clean = require("./cleanup");
clean();                             // 起動直後
setInterval(clean, 60 * 60 * 1000);  // 1h ごと

/*─ ミドルウェア ─*/
const express = require("express");
const cors    = require("cors");
const stripe  = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();
app.use(express.json());

/*─ CORS: Webflow だけ許可 & Cookie 対応 ─*/
const ORIGIN = "https://vsfund.webflow.io";
app.use(cors({
  origin: ORIGIN,
  credentials: true,
  methods: ["GET","POST"],
  allowedHeaders: ["Content-Type"],
  maxAge: 86400
}));

/*─ ルーティング ─*/
app.use("/api", require("./routes"));      // emailChange など
app.post("/api/change-plan", changePlan);  // Stripe プラン変更

/*─ 動作確認 ─*/
app.get("/", (_, res) => res.send("VS-FUND API running"));

/*─ サーバー起動 ─*/
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listen on ${PORT}`));

/*-----------------------------------------------
  Stripe プラン変更ハンドラ
-----------------------------------------------*/
async function changePlan(req, res){
  try{
    const { customerId, newPriceId } = req.body;
    const subs = await stripe.subscriptions.list({
      customer: customerId, status:"active", limit:1
    });
    const sub = subs.data[0];
    if(!sub) return res.status(404).json({error:"No active subscription"});

    const updated = await stripe.subscriptions.update(sub.id,{
      items:[{ id:sub.items.data[0].id, price:newPriceId }],
      proration_behavior:"none"
    });
    res.json({ success:true, subscription:updated });
  }catch(err){
    console.error(err);
    res.status(500).json({ error:err.message });
  }
}
