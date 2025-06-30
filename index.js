// index.js

const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, 'env', '.env')
});

const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();

// JSON ボディのパース
app.use(express.json());

// CORS 設定（Webflow の公開 URL を指定）
app.use(cors({
  origin: ['https://izokukikin.webflow.io'], // ← 実際の Webflow URL に置き換える
  methods: ['POST'],
  allowedHeaders: ['Content-Type']
}));

// プラン変更エンドポイント
app.post('/change-plan', async (req, res) => {
  const { customerId, newPriceId } = req.body;

  try {
    // アクティブなサブスクリプションを取得
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
    });

    const subscription = subscriptions.data[0];
    if (!subscription) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    // プランを切り替え（proration なし）
    const updated = await stripe.subscriptions.update(subscription.id, {
      items: [{
        id: subscription.items.data[0].id,
        price: newPriceId,
      }],
      proration_behavior: 'none',
    });

    res.json({ success: true, subscription: updated });
  } catch (error) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 動作確認用ルート
app.get('/', (req, res) => {
  res.send('Stripe Plan Change API 起動中');
});

// サーバ起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});
