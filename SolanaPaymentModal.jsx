import React, { useState, useEffect } from 'react';
import { Send, Wallet, Check } from 'lucide-react';

const SolanaPaymentModal = ({ userId, onPaymentSuccess }) => {
  const [showModal, setShowModal] = useState(false);
  const [selectedTier, setSelectedTier] = useState('professional');
  const [walletConnected, setWalletConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState('idle');
  const [paymentMessage, setPaymentMessage] = useState('');
  const [solPrice, setSolPrice] = useState(0);
  const [pricing, setPricing] = useState(null);
  const [subscription, setSubscription] = useState(null);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
  const PAYMENT_API = process.env.REACT_APP_PAYMENT_API || 'http://localhost:3002';

  // Fetch pricing and subscription info on mount
  useEffect(() => {
    fetchPricing();
    fetchSubscription();
    fetchSolPrice();
  }, []);

  // Check for Phantom wallet
  useEffect(() => {
    if (window.phantom && window.phantom.solana) {
      window.phantom.solana.on('connect', handleWalletConnect);
    }
  }, []);

  const fetchPricing = async () => {
    try {
      const res = await fetch(`${PAYMENT_API}/api/payment/pricing`);
      const data = await res.json();
      if (data.success) {
        setPricing(data.tiers);
      }
    } catch (error) {
      console.error('Error fetching pricing:', error);
    }
  };

  const fetchSubscription = async () => {
    try {
      const res = await fetch(`${PAYMENT_API}/api/subscription/${userId}`);
      const data = await res.json();
      if (data.success) {
        setSubscription(data.subscription);
      }
    } catch (error) {
      console.log('No active subscription');
    }
  };

  const fetchSolPrice = async () => {
    try {
      const res = await fetch(`${PAYMENT_API}/api/payment/sol-price`);
      const data = await res.json();
      if (data.success) {
        setSolPrice(data.price_usd);
      }
    } catch (error) {
      console.error('Error fetching SOL price:', error);
    }
  };

  const connectWallet = async () => {
    try {
      const { solana } = window;

      if (solana && solana.isPhantom) {
        const response = await solana.connect();
        setWalletAddress(response.publicKey.toString());
        setWalletConnected(true);
      } else {
        alert('Phantom wallet not found. Install from https://phantom.app/');
      }
    } catch (error) {
      console.error('Wallet connection error:', error);
      setPaymentMessage('Failed to connect wallet');
    }
  };

  const handleWalletConnect = (publicKey) => {
    setWalletAddress(publicKey.toString());
    setWalletConnected(true);
  };

  const processPayment = async () => {
    if (!walletConnected) {
      alert('Connect wallet first');
      return;
    }

    setLoading(true);
    setPaymentStatus('processing');

    try {
      // Step 1: Create payment request
      const createRes = await fetch(`${PAYMENT_API}/api/payment/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          tier: selectedTier,
          email: 'user@example.com'
        })
      });

      const createData = await createRes.json();
      if (!createData.success) throw new Error(createData.error);

      const paymentId = createData.payment.paymentId;
      const amount = createData.payment.amount_sol;

      setPaymentMessage(`Waiting for payment of ${amount} SOL...`);

      // Step 2: Simulate payment verification
      // In production, this would verify on Solana blockchain
      const verifyRes = await fetch(`${PAYMENT_API}/api/payment/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentId,
          transactionSignature: 'simulated_txn_' + Date.now(),
          senderAddress: walletAddress
        })
      });

      const verifyData = await verifyRes.json();

      if (verifyData.success) {
        setPaymentStatus('confirmed');
        setPaymentMessage('Payment confirmed! Subscription activated 🎉');
        setSubscription(verifyData.subscription);

        // Refresh subscription after 2 seconds
        setTimeout(() => {
          fetchSubscription();
          if (onPaymentSuccess) onPaymentSuccess(verifyData.subscription);
          setShowModal(false);
        }, 2000);
      } else {
        throw new Error(verifyData.error);
      }
    } catch (error) {
      console.error('Payment error:', error);
      setPaymentStatus('error');
      setPaymentMessage(`Payment failed: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  if (!pricing) return null;

  return (
    <div>
      {/* Subscription Status Banner */}
      {subscription ? (
        <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded mb-4">
          <div className="flex items-center gap-2">
            <Check className="w-5 h-5 text-green-600" />
            <div>
              <p className="font-semibold text-green-900">{pricing[subscription.tier].name} Active</p>
              <p className="text-sm text-green-700">
                Expires: {new Date(subscription.expires_at).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 rounded mb-4">
          <p className="text-yellow-900 font-semibold">No active subscription. Upgrade to use premium features.</p>
        </div>
      )}

      {/* Payment Button */}
      <button
        onClick={() => setShowModal(true)}
        className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg font-semibold flex items-center gap-2 transition"
      >
        <Wallet className="w-5 h-5" />
        {subscription ? 'Upgrade Plan' : 'Pay with Solana'}
      </button>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-6">
              <h2 className="text-2xl font-bold">Upgrade to Premium</h2>
              <p>Pay with Solana to unlock advanced features</p>
            </div>

            <div className="p-6">
              {/* Pricing Tiers */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {Object.entries(pricing).map(([key, tier]) => (
                  <div
                    key={key}
                    onClick={() => setSelectedTier(key)}
                    className={`border-2 rounded-lg p-4 cursor-pointer transition ${
                      selectedTier === key
                        ? 'border-purple-600 bg-purple-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <h3 className="font-bold text-lg text-gray-900">{tier.name}</h3>
                    <div className="my-3">
                      <p className="text-2xl font-bold text-purple-600">{tier.price_sol} SOL</p>
                      <p className="text-sm text-gray-600">${tier.price_usd} USD</p>
                    </div>
                    <ul className="space-y-2">
                      {tier.features.map((feature, idx) => (
                        <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                          <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* Wallet Connection */}
              {!walletConnected ? (
                <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-6 text-center mb-6">
                  <Wallet className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                  <h3 className="font-semibold text-gray-900 mb-2">Connect Phantom Wallet</h3>
                  <p className="text-gray-600 mb-4">Need Phantom? Install from https://phantom.app/</p>
                  <button
                    onClick={connectWallet}
                    className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg font-semibold transition"
                  >
                    Connect Wallet
                  </button>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
                  <p className="text-sm text-gray-600">Connected Wallet</p>
                  <p className="font-mono text-sm text-green-900 break-all">
                    {walletAddress.slice(0, 10)}...{walletAddress.slice(-10)}
                  </p>
                </div>
              )}

              {/* Payment Status Message */}
              {paymentMessage && (
                <div
                  className={`rounded-lg p-4 mb-6 ${
                    paymentStatus === 'confirmed'
                      ? 'bg-green-50 text-green-900 border border-green-200'
                      : paymentStatus === 'error'
                      ? 'bg-red-50 text-red-900 border border-red-200'
                      : 'bg-blue-50 text-blue-900 border border-blue-200'
                  }`}
                >
                  {paymentMessage}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowModal(false);
                    setPaymentStatus('idle');
                    setPaymentMessage('');
                  }}
                  className="flex-1 border-2 border-gray-300 text-gray-900 px-4 py-2 rounded-lg font-semibold hover:border-gray-400 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={processPayment}
                  disabled={!walletConnected || loading}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg font-semibold flex items-center justify-center gap-2 transition"
                >
                  {loading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Processing...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4" />
                      Pay {pricing[selectedTier].price_sol} SOL
                    </>
                  )}
                </button>
              </div>

              {/* Info Text */}
              <p className="text-xs text-gray-500 text-center mt-4">
                SOL price: ${solPrice}/SOL • Payments are instant • 30-day subscription • No cancellation fees
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SolanaPaymentModal;
