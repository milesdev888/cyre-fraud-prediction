// scripts/fire-settles.js — one-shot mainnet settles for new Guardian bazaar routes.
// Called from x402-payer when X402_FIRE_SETTLES=1. Reuses CdpX402Client + @x402/core/http.
// Remove the env flag after a successful run so restarts do not re-pay.

const TAG = '[fire-settles]';
const BASE = (process.env.X402_FIRE_BASE || 'https://cyre.dev').replace(/\/$/, '');
const TREASURY = '0x9Ff25C4acf1DcDDf15fD2702C127A285f1dFa712';
const PAYER = '0x1A4b94a7a5dFff004f3Fc456F78f9670Cb7A450D';
const SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const SOL2 = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const INTENT_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const FACILITATOR = 'https://api.cdp.coinbase.com/platform/v2/x402';

const SAMPLE_OFFER = JSON.stringify({
  x402Version: 2,
  accepts: [{ network: 'eip155:8453', amount: '2000', payTo: TREASURY }]
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    u.set(k, String(v));
  }
  return u.toString();
}

function decodeB64Json(v) {
  try {
    return JSON.parse(Buffer.from(String(v), 'base64').toString('utf8'));
  } catch (e) {
    return null;
  }
}

async function freePassport() {
  // Ticket needs Passport/Receipt — cron tokens are a different kind.
  // Site-origin free path (same as our smoke tests).
  const r = await fetch(BASE + '/api/passport?' + qs({ address: SOL }), {
    headers: { accept: 'application/json', origin: 'https://cyre.dev', referer: 'https://cyre.dev/' }
  });
  const j = await r.json().catch(() => ({}));
  const token = (j && (j.token || (j.attestation && j.attestation.token))) || null;
  if (!token) {
    console.log(TAG, 'passport free-fetch failed', r.status, JSON.stringify(j).slice(0, 150));
  }
  return token;
}

/**
 * @param {import('@coinbase/cdp-sdk/x402').CdpX402Client} client
 */
module.exports = async function fireSettles(client) {
  const {
    encodePaymentSignatureHeader,
    decodePaymentRequiredHeader,
    decodePaymentResponseHeader
  } = require('@x402/core/http');

  const ctx = {
    policyToken: null,
    intentToken: null,
    cronToken: null,
    passportToken: null
  };

  // Order matches bazaar settle brief — tokens chain into later routes.
  const routes = [
    {
      route: '/api/policy',
      url: () =>
        BASE +
        '/api/policy?' +
        qs({
          actor: SOL,
          maxSpendAtomic: '100000',
          allowHosts: 'cyre.dev,example.com',
          networks: 'eip155:8453',
          requireTicket: 'false',
          maxRisk: 'MEDIUM'
        }),
      keep: (j) => {
        if (j && j.token) ctx.policyToken = j.token;
      }
    },
    {
      route: '/api/policy/check',
      url: () =>
        BASE +
        '/api/policy/check?' +
        qs({
          token: ctx.policyToken || 'missing',
          amountAtomic: '5000',
          resourceUrl: 'https://cyre.dev/api/address',
          network: 'eip155:8453',
          hasTicket: 'false'
        })
    },
    {
      route: '/api/intent',
      url: () =>
        BASE +
        '/api/intent?' +
        qs({
          actor: SOL,
          intentHash: INTENT_HASH,
          action: 'settle',
          payTo: TREASURY,
          amountAtomic: '10000',
          resourceUrl: 'https://cyre.dev'
        }),
      keep: (j) => {
        if (j && j.token) ctx.intentToken = j.token;
      }
    },
    {
      route: '/api/lookalike',
      url: () =>
        BASE +
        '/api/lookalike?' +
        qs({
          candidate: PAYER,
          contacts: TREASURY + ',' + PAYER
        })
    },
    {
      route: '/api/mintalike',
      url: () =>
        BASE +
        '/api/mintalike?' +
        qs({
          candidate: USDC_MINT,
          contacts: USDC_MINT,
          symbol: 'USDC',
          symbols: 'USDC,USDT,SOL'
        })
    },
    {
      route: '/api/host',
      url: () => BASE + '/api/host?' + qs({ url: 'https://cyre.dev' })
    },
    {
      route: '/api/offer',
      url: () =>
        BASE +
        '/api/offer?' +
        qs({
          paymentRequired: SAMPLE_OFFER,
          amount: '2000',
          payTo: TREASURY,
          network: 'eip155:8453',
          facilitator: FACILITATOR,
          resourceUrl: 'https://cyre.dev/api/address'
        })
    },
    {
      route: '/api/route',
      url: () =>
        BASE +
        '/api/route?' +
        qs({
          payTo: TREASURY,
          amount: '10000',
          listedAmount: '10000',
          resourceUrl: 'https://cyre.dev/api/address',
          facilitator: FACILITATOR,
          network: 'eip155:8453',
          from: PAYER
        })
    },
    {
      route: '/api/pack',
      url: () =>
        BASE +
        '/api/pack?' +
        qs({
          paymentRequired: SAMPLE_OFFER,
          candidate: SOL,
          contacts: SOL + ',' + SOL2,
          policyToken: ctx.policyToken || undefined,
          intentToken: ctx.intentToken || undefined,
          intentHash: INTENT_HASH,
          amountAtomic: '2000',
          resourceUrl: 'https://cyre.dev/api/address',
          network: 'eip155:8453',
          payTo: TREASURY,
          facilitator: FACILITATOR
        })
    },
    {
      route: '/api/escrow',
      url: () =>
        BASE +
        '/api/escrow?' +
        qs({
          payToA: TREASURY,
          payToB: SOL,
          amountAtomic: '10000',
          resourceUrl: 'https://cyre.dev'
        })
    },
    {
      route: '/api/pulse',
      url: () => BASE + '/api/pulse?' + qs({ list: SOL, minRisk: 'HIGH' })
    },
    {
      route: '/api/cron-receipt',
      url: () =>
        BASE +
        '/api/cron-receipt?' +
        qs({
          job: 'bazaar-settle-fire',
          walletCount: '1',
          hitCount: '0',
          digest: 'sha256:firesettles0001'
        }),
      keep: (j) => {
        if (j && j.token) ctx.cronToken = j.token;
      }
    },
    {
      route: '/api/ticket',
      url: () =>
        BASE +
        '/api/ticket?' +
        qs({
          token: ctx.passportToken || 'missing',
          require: 'passport',
          maxAgeSeconds: '86400'
        }),
      before: async () => {
        ctx.passportToken = await freePassport();
      }
    }
  ];

  let settled = 0;
  let skipped = 0;

  for (let i = 0; i < routes.length; i++) {
    const step = routes[i];
    try {
      if (step.before) await step.before();
      const url = step.url();

      const r1 = await fetch(url, { method: 'GET', headers: { accept: 'application/json' } });
      if (r1.status !== 402) {
        const t = (await r1.text()).slice(0, 150);
        console.log(TAG, 'SKIPPED', step.route, r1.status, t);
        skipped++;
      } else {
        const prHeader = r1.headers.get('payment-required');
        const paymentRequired = prHeader ? decodePaymentRequiredHeader(prHeader) : await r1.json();
        const payload = await client.createPaymentPayload(paymentRequired);
        const sig = encodePaymentSignatureHeader(payload);
        const r2 = await fetch(url, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            'PAYMENT-SIGNATURE': sig,
            'X-PAYMENT': sig
          }
        });
        const text = await r2.text();
        let bodyJson = null;
        try {
          bodyJson = JSON.parse(text);
        } catch (e) {
          /* ignore */
        }

        if (r2.status === 200) {
          const pr = r2.headers.get('payment-response') || r2.headers.get('x-payment-response');
          let settledMeta = null;
          if (pr) {
            try {
              settledMeta = decodePaymentResponseHeader(pr);
            } catch (e) {
              settledMeta = decodeB64Json(pr);
            }
          }
          const tx =
            (settledMeta &&
              (settledMeta.transaction ||
                settledMeta.txHash ||
                settledMeta.hash ||
                (settledMeta.payer && settledMeta.payer))) ||
            JSON.stringify(settledMeta || { paymentResponse: !!pr });
          console.log(TAG, 'SETTLED', step.route, r2.status, tx);
          settled++;
          if (step.keep && bodyJson) step.keep(bodyJson);
        } else {
          console.log(TAG, 'SKIPPED', step.route, r2.status, text.slice(0, 150));
          skipped++;
        }
      }
    } catch (err) {
      const cause = (err.cause && (err.cause.code || err.cause.message)) || err.message;
      console.log(TAG, 'SKIPPED', step.route, 'err', String(cause).slice(0, 150));
      skipped++;
    }

    if (i < routes.length - 1) await sleep(1500);
  }

  console.log(
    TAG,
    `done: ${settled} settled, ${skipped} skipped — remove X402_FIRE_SETTLES from env now.`
  );
};
