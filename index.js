require('dotenv').config();
const express = require('express');
const app = express();
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

app.use(express.json());

app.use(cors({
  origin: ['https://izokukikin.webflow.io'], // ← 実際のWebflow公開URLに書き換える
  methods: ['POST'],
  allowedHeaders: ['Content-Type']
}));

app.post('/change-plan', async (req, res) => {
  const { customerId, newPriceId } = req.body;

  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
    });

    const subscription = subscriptions.data[0];
    if (!subscription) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

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

app.get('/', (req, res) => {
  res.send('Stripe Plan Change API 起動中');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});
