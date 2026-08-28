// CYRE Guardian — x402 buyer ("guardian-payer" CDP wallet)
// Runs once at server startup, right after create-wallet.js. Two jobs:
//   1. Always: ensure the payer wallet exists and log its Base address (fund it with a little USDC).
//   2. Only when X402_PAY_ONCE is set to a URL: pay that endpoint's 402 ONE time and log the result.
//      Remove X402_PAY_ONCE afterwards so restarts don't pay again.
// Uses Coinbase's official x402 client (no hand-rolled signatures). Safe no-op without CDP env.

const REQUIRED = ['CDP_API_KEY_ID', 'CDP_API_KEY_SECRET', 'CDP_WALLET_SECRET'];
const TAG = '[x402-payer]';

function decodeB64Json(v) {
  try { return JSON.parse(Buffer.from(String(v), 'base64').toString('utf8')); } catch (e) { return null; }
}

module.exports = async function runGuardianPayer() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    console.log(TAG, 'skipped — missing env:', missing.join(', '));
    return null;
  }

  let client, evmAddress;
  try {
    const { CdpX402Client } = require('@coinbase/cdp-sdk/x402');
    client = new CdpX402Client({ walletConfig: { type: 'eoa', accountName: 'guardian-payer' } });
    const addrs = await client.getAddresses();
    evmAddress = addrs.evmAddress;
    console.log('========================================');
    console.log(TAG, 'GUARDIAN PAYER (Base) address:', evmAddress);
    console.log('========================================');
  } catch (err) {
    console.error(TAG, 'wallet init failed:', err.message);
    return null;
  }

  const target = (process.env.X402_PAY_ONCE || '').trim();
  if (!target) return evmAddress;

  try {
    const { encodePaymentSignatureHeader, decodePaymentRequiredHeader, decodePaymentResponseHeader } = require('@x402/core/http');

    // Step 1: unpaid request → expect 402 with PAYMENT-REQUIRED header (v2) or JSON body.
    const r1 = await fetch(target, { headers: { accept: 'application/json' } });
    console.log(TAG, 'step 1 status', r1.status);
    if (r1.status !== 402) {
      console.log(TAG, 'not a 402 — nothing to pay. body:', (await r1.text()).slice(0, 200));
      return evmAddress;
    }
    const prHeader = r1.headers.get('payment-required');
    const paymentRequired = prHeader ? decodePaymentRequiredHeader(prHeader) : await r1.json();
    console.log(TAG, 'offer networks:', (paymentRequired.accepts || []).map((a) => a.network + ' ' + a.amount).join(' | '));

    // Step 2: build + sign the payment (picks the Base lane; echoes server extensions incl. bazaar).
    const payload = await client.createPaymentPayload(paymentRequired);
    console.log(TAG, 'paying on', payload.accepted && payload.accepted.network, 'from', evmAddress,
      'extensions:', Object.keys(payload.extensions || {}).join(',') || 'none');

    // Step 3: paid request.
    const r2 = await fetch(target, {
      headers: { accept: 'application/json', 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(payload) }
    });
    const text = await r2.text();
    console.log(TAG, 'step 3 status', r2.status);
    const pr = r2.headers.get('payment-response') || r2.headers.get('x-payment-response');
    if (pr) {
      let settled = null;
      try { settled = decodePaymentResponseHeader(pr); } catch (e) { settled = decodeB64Json(pr); }
      console.log(TAG, 'SETTLED:', JSON.stringify(settled));
    }
    const ext = r2.headers.get('extension-responses');
    if (ext) console.log(TAG, 'EXTENSION-RESPONSES:', JSON.stringify(decodeB64Json(ext)));
    console.log(TAG, 'body:', text.slice(0, 400));
    if (r2.status === 200) console.log(TAG, '✅ PAID — remove X402_PAY_ONCE from env now.');
  } catch (err) {
    console.error(TAG, 'payment failed:', err.message);
  }
  return evmAddress;
};
