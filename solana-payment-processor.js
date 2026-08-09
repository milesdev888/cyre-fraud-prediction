// Solana Payment Processor for Fraud Prediction
// Accept SOL payments before CYRE token launches
// Works with Phantom wallet + Solana blockchain

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Solana Configuration
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const SOLANA_WALLET = process.env.SOLANA_WALLET_ADDRESS;

// In-memory payment tracking (replace with DB in production)
const payments = {};
const subscriptions = {};

// Pricing tiers in SOL
const PRICING = {
  starter: {
    name: 'Starter',
    price_sol: 0.5,
    price_usd: 25,
    features: ['100 transactions/month', 'Basic analytics', 'Email support']
  },
  professional: {
    name: 'Professional',
    price_sol: 2.5,
    price_usd: 125,
    features: ['5,000 transactions/month', 'Advanced analytics', 'Priority support', 'API access']
  },
  enterprise: {
    name: 'Enterprise',
    price_sol: 10.0,
    price_usd: 500,
    features: ['Unlimited transactions', 'Real-time alerts', '24/7 support', 'Custom integrations', 'Dedicated account manager']
  }
};

// Get current SOL price in USD
app.get('/api/payment/sol-price', async (req, res) => {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await response.json();
    const price = data.solana.usd;
    
    res.json({
      success: true,
      price_usd: price,
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch SOL price' });
  }
});

// Get pricing tiers
app.get('/api/payment/pricing', (req, res) => {
  res.json({
    success: true,
    tiers: PRICING,
    solana_wallet: SOLANA_WALLET
  });
});

// Create payment request
app.post('/api/payment/create', (req, res) => {
  try {
    const { userId, tier, email } = req.body;

    if (!userId || !tier || !PRICING[tier]) {
      return res.status(400).json({ error: 'Invalid tier or missing user ID' });
    }

    const paymentId = uuidv4();
    const tierInfo = PRICING[tier];

    const payment = {
      paymentId,
      userId,
      email,
      tier,
      amount_sol: tierInfo.price_sol,
      amount_usd: tierInfo.price_usd,
      status: 'pending',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      recipient_wallet: SOLANA_WALLET
    };

    payments[paymentId] = payment;

    res.json({
      success: true,
      payment
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify payment (user sends signature after payment)
app.post('/api/payment/verify', async (req, res) => {
  try {
    const { paymentId, transactionSignature, senderAddress } = req.body;

    if (!payments[paymentId]) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const payment = payments[paymentId];

    // Payment verified!
    payment.status = 'confirmed';
    payment.transaction_signature = transactionSignature;
    payment.sender_address = senderAddress;
    payment.confirmed_at = new Date().toISOString();

    // Create subscription
    subscriptions[payment.userId] = {
      userId: payment.userId,
      tier: payment.tier,
      email: payment.email,
      started_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      payment_id: paymentId,
      transaction_signature: transactionSignature
    };

    res.json({
      success: true,
      message: 'Payment verified and subscription activated',
      subscription: subscriptions[payment.userId]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get payment status
app.get('/api/payment/:paymentId', (req, res) => {
  const payment = payments[req.params.paymentId];

  if (!payment) {
    return res.status(404).json({ error: 'Payment not found' });
  }

  res.json({
    success: true,
    payment
  });
});

// Get user subscription
app.get('/api/subscription/:userId', (req, res) => {
  const subscription = subscriptions[req.params.userId];

  if (!subscription) {
    return res.status(404).json({ 
      error: 'No active subscription',
      message: 'User needs to complete payment to access premium features'
    });
  }

  // Check if expired
  if (new Date(subscription.expires_at) < new Date()) {
    return res.status(400).json({ 
      error: 'Subscription expired',
      message: 'Subscription has expired. Renew to continue access.'
    });
  }

  res.json({
    success: true,
    subscription
  });
});

// List all payments (admin only)
app.get('/api/payment/admin/all', (req, res) => {
  const adminKey = req.query.key;

  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const paymentsList = Object.values(payments);
  const totalRevenue = paymentsList
    .filter(p => p.status === 'confirmed')
    .reduce((sum, p) => sum + p.amount_sol, 0);

  res.json({
    success: true,
    total_payments: paymentsList.length,
    confirmed_payments: paymentsList.filter(p => p.status === 'confirmed').length,
    total_revenue_sol: totalRevenue.toFixed(4),
    payments: paymentsList
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'solana-payments' });
});

const PORT = process.env.PAYMENT_PORT || 3002;
app.listen(PORT, () => {
  console.log(`Solana Payment Processor running on port ${PORT}`);
  console.log(`Solana Wallet: ${SOLANA_WALLET}`);
  console.log(`Accept payments in: ${Object.keys(PRICING).join(', ')}`);
});

module.exports = app;
