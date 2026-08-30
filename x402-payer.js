require('dns').setDefaultResultOrder('ipv4first');
// CYRE Guardian — x402 buyer ("guardian-payer" CDP wallet)
// Runs once at server startup, right after create-wallet.js. Two jobs:
//   1. Always: ensure the payer wallet exists and log its Base address (fund it with a little USDC).
//   2. Only when X402_PAY_ONCE is set to a URL: pay that endpoint's 402 ONE time and log the result.
//      Remove X402_PAY_ONCE afterwards so restarts don't pay again.
// NEW (Aug 30): optional X402_PAY_METHOD (GET|POST, default GET) and X402_PAY_BODY
//   (raw JSON string) so we can pay POST endpoints like x402station's
//   /api/v1/preflight and /api/v1/verified. Both the unpaid probe and the paid
//   retry use the same method/body/content-type. Clear all three vars after use.
// NEW: X402_FIRE_SETTLES=1 runs scripts/fire-settles.js once (13 bazaar routes).
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
  if (target) {
    // Optional relay: when X402_PAY_VIA is set (e.g. https://cyre.dev/api/relay),
    // route the HTTP through it — for hosts that refuse Render egress IPs.
    const via = (process.env.X402_PAY_VIA || '').trim();
    const wire = via ? via + '?to=' + encodeURIComponent(target) : target;
    if (via) console.log(TAG, 'relaying via', via);

    // Optional method/body for POST endpoints (e.g. x402station).
    const method = (process.env.X402_PAY_METHOD || 'GET').trim().toUpperCase() === 'POST' ? 'POST' : 'GET';
    const rawBody = (process.env.X402_PAY_BODY || '').trim();
    let body;
    if (method === 'POST' && rawBody) {
      try { JSON.parse(rawBody); body = rawBody; }
      catch (e) { console.error(TAG, 'X402_PAY_BODY is not valid JSON — aborting so we do not pay with a bad body.'); body = undefined; }
    }
    if (!(method === 'POST' && rawBody && !body)) {
      const baseHeaders = { accept: 'application/json' };
      if (body) baseHeaders['content-type'] = 'application/json';
      const reqInit = (extra) => ({ method, headers: { ...baseHeaders, ...(extra || {}) }, ...(body ? { body } : {}) });
      console.log(TAG, 'pay-once target:', method, target, body ? `body ${body.length}B` : '(no body)');

      try {
        const { encodePaymentSignatureHeader, decodePaymentRequiredHeader, decodePaymentResponseHeader } = require('@x402/core/http');

        // Step 1: unpaid request → expect 402 with PAYMENT-REQUIRED header (v2) or JSON body.
        let r1;
        for (let attempt = 1; ; attempt++) {
          try { r1 = await fetch(wire, reqInit()); break; }
          catch (e) {
            const cause = (e.cause && (e.cause.code || e.cause.message)) || e.message;
            console.error(TAG, `step 1 attempt ${attempt} failed:`, cause);
            if (attempt >= 4) throw e;
            await new Promise((res) => setTimeout(res, attempt * 3000));
          }
        }
        console.log(TAG, 'step 1 status', r1.status);
        if (r1.status !== 402) {
          console.log(TAG, 'not a 402 — nothing to pay. body:', (await r1.text()).slice(0, 200));
        } else {
          const prHeader = r1.headers.get('payment-required');
          const paymentRequired = prHeader ? decodePaymentRequiredHeader(prHeader) : await r1.json();
          console.log(TAG, 'offer networks:', (paymentRequired.accepts || []).map((a) => a.network + ' ' + a.amount).join(' | '));

          // Step 2: build + sign the payment (picks the Base lane; echoes server extensions incl. bazaar).
          const payload = await client.createPaymentPayload(paymentRequired);
          console.log(TAG, 'paying on', payload.accepted && payload.accepted.network, 'from', evmAddress,
            'extensions:', Object.keys(payload.extensions || {}).join(',') || 'none');

          // Step 3: paid request (some servers read X-PAYMENT, v2 reads PAYMENT-SIGNATURE — send both).
          const sig = encodePaymentSignatureHeader(payload);
          const r2 = await fetch(wire, reqInit({ 'PAYMENT-SIGNATURE': sig, 'X-PAYMENT': sig }));
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
          console.log(TAG, 'body:', text.slice(0, 1200));
          if (r2.status === 200) console.log(TAG, '✅ PAID — remove X402_PAY_ONCE (+ METHOD/BODY) from env now.');
        }
      } catch (err) {
        console.error(TAG, 'payment failed:', err.message, '| cause:', (err.cause && (err.cause.code || err.cause.errors && JSON.stringify(err.cause.errors.map(x => x.code || x.message)) || err.cause.message)) || 'none');
      }
    }
  }

  if (String(process.env.X402_FIRE_SETTLES || '').trim() === '1') {
    try {
      await require('./scripts/fire-settles')(client);
    } catch (err) {
      console.error(TAG, 'fire-settles failed:', err && err.message);
    }
  }

  return evmAddress;
};
