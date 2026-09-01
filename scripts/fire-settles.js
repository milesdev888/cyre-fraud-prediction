// scripts/fire-settles.js — one-shot mainnet settles for Guardian bazaar + Agent Trinity routes.
// Called from x402-payer when X402_FIRE_SETTLES=1. Reuses CdpX402Client + @x402/core/http.
// Remove the env flag after a successful run so restarts do not re-pay.
// Optional: X402_FIRE_ROUTES=/api/bazaar,/api/caution,... — fire only those paths (listed order).

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

/** Agentic Market index gaps + Trinity — use X402_FIRE_CATALOG=missing on Render once. */
const MISSING_CATALOG =
  '/api/address,/api/token,/api/handshake,/api/lookalike,/api/mintalike,/api/policy,/api/intent,/api/pack,/api/stream/subscribe,/api/stream/events,/api/exchange/post,/api/exchange/match,/api/circuit/seal,/api/circuit/heartbeat,/api/circuit/check';

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
    passportToken: null,
    receiptToken: null,
    lockboxToken: null,
    streamToken: null,
    exchangeIntentToken: null,
    circuitToken: null
  };

  // Full catalog — tokens chain into later routes. Filter via X402_FIRE_ROUTES when set.
  const routes = [
    // Core SKUs — close Agentic Market index gaps (address/token/handshake were missing)
    {
      route: '/api/gate',
      url: () =>
        BASE +
        '/api/gate?' +
        qs({
          payTo: TREASURY,
          amount: '10000',
          resourceUrl: 'https://cyre.dev/api/address',
          chain: 'base'
        })
    },
    {
      route: '/api/address',
      url: () => BASE + '/api/address?' + qs({ address: SOL })
    },
    {
      route: '/api/token',
      url: () => BASE + '/api/token?' + qs({ mint: USDC_MINT })
    },
    {
      route: '/api/passport',
      url: () => BASE + '/api/passport?' + qs({ address: SOL }),
      keep: (j) => {
        if (j && j.token) ctx.passportToken = j.token;
      }
    },
    {
      route: '/api/handshake',
      url: () => BASE + '/api/handshake?' + qs({ addressA: SOL, addressB: SOL2 })
    },
    {
      route: '/api/delta',
      url: () => BASE + '/api/delta?' + qs({ token: ctx.passportToken || 'missing' })
    },
    {
      route: '/api/receipt',
      url: () =>
        BASE +
        '/api/receipt?' +
        qs({
          actor: SOL,
          intentHash: INTENT_HASH,
          action: 'transfer',
          score: '24',
          riskLevel: 'LOW'
        }),
      keep: (j) => {
        if (j && j.token) ctx.receiptToken = j.token;
      }
    },
    {
      route: '/api/batch',
      url: () => BASE + '/api/batch?' + qs({ from: SOL, list: SOL2 })
    },
    {
      route: '/api/program',
      url: () =>
        BASE +
        '/api/program?' +
        qs({
          programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
          address: SOL
        })
    },
    {
      route: '/api/preflight',
      url: () =>
        BASE +
        '/api/preflight?' +
        qs({
          from: SOL,
          to: SOL2,
          mint: USDC_MINT
        })
    },
    {
      route: '/api/alerts',
      url: () => BASE + '/api/alerts?' + qs({ list: SOL, minRisk: 'HIGH' })
    },
    {
      route: '/api/oracle',
      url: () => BASE + '/api/oracle'
    },
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
    },
    // Magnet suite (PR #116)
    {
      route: '/api/bazaar',
      url: () =>
        BASE +
        '/api/bazaar?' +
        qs({
          resourceUrl: 'https://cyre.dev/api/address',
          payTo: TREASURY,
          amount: '10000',
          facilitator: FACILITATOR,
          network: 'eip155:8453'
        })
    },
    {
      route: '/api/caution',
      url: () =>
        BASE +
        '/api/caution?' +
        qs({
          payTo: TREASURY,
          amount: '10000',
          resourceUrl: 'https://cyre.dev',
          chain: 'base'
        })
    },
    {
      route: '/api/lockbox',
      url: () =>
        BASE +
        '/api/lockbox?' +
        qs({
          actor: SOL,
          intentHash: INTENT_HASH,
          action: 'pay',
          payTo: TREASURY,
          amountAtomic: '10000',
          resourceUrl: 'https://cyre.dev',
          network: 'eip155:8453'
        }),
      keep: (j) => {
        if (j && j.token) ctx.lockboxToken = j.token;
      }
    },
    {
      route: '/api/lockbox/match',
      url: () =>
        BASE +
        '/api/lockbox/match?' +
        qs({
          token: ctx.lockboxToken || 'missing',
          intentHash: INTENT_HASH,
          payTo: TREASURY,
          amountAtomic: '10000',
          resourceUrl: 'https://cyre.dev',
          network: 'eip155:8453'
        })
    },
    // Agent Trinity suite (Pulse Stream + Intent Exchange + Circuit Breaker)
    {
      route: '/api/stream/subscribe',
      url: () =>
        BASE +
        '/api/stream/subscribe?' +
        qs({
          actor: SOL,
          list: SOL,
          minRisk: 'HIGH'
        }),
      keep: (j) => {
        if (j && j.token) ctx.streamToken = j.token;
      }
    },
    {
      route: '/api/stream/events',
      url: () =>
        BASE +
        '/api/stream/events?' +
        qs({
          token: ctx.streamToken || 'missing',
          waitSeconds: '0'
        }),
      keep: (j) => {
        if (j && j.token) ctx.streamToken = j.token;
      }
    },
    {
      route: '/api/exchange/post',
      url: () =>
        BASE +
        '/api/exchange/post?' +
        qs({
          actor: SOL,
          need: 'token scan + holder breakdown',
          budgetAtomic: '20000',
          network: 'eip155:8453',
          tags: 'scan,token'
        }),
      keep: (j) => {
        if (j && j.token) ctx.exchangeIntentToken = j.token;
      }
    },
    {
      route: '/api/exchange/match',
      url: () =>
        BASE +
        '/api/exchange/match?' +
        qs({
          intentToken: ctx.exchangeIntentToken || 'missing',
          resourceUrl: 'https://cyre.dev/api/token',
          payTo: TREASURY,
          amountAtomic: '10000',
          network: 'eip155:8453'
        })
    },
    {
      route: '/api/circuit/seal',
      url: () =>
        BASE +
        '/api/circuit/seal?' +
        qs({
          actor: SOL,
          heartbeatIntervalSeconds: '300',
          maxMissedBeats: '2',
          maxSpendAtomic: '100000',
          allowHosts: 'cyre.dev',
          policyToken: ctx.policyToken || undefined
        }),
      keep: (j) => {
        if (j && j.token) ctx.circuitToken = j.token;
      }
    },
    {
      route: '/api/circuit/heartbeat',
      url: () =>
        BASE +
        '/api/circuit/heartbeat?' +
        qs({
          token: ctx.circuitToken || 'missing'
        }),
      keep: (j) => {
        if (j && j.token) ctx.circuitToken = j.token;
      }
    },
    {
      route: '/api/circuit/check',
      url: () =>
        BASE +
        '/api/circuit/check?' +
        qs({
          token: ctx.circuitToken || 'missing',
          amountAtomic: '5000',
          resourceUrl: 'https://cyre.dev/api/gate',
          network: 'eip155:8453'
        })
    }
  ];

  const catalogMode = String(process.env.X402_FIRE_CATALOG || '').trim().toLowerCase();
  if (catalogMode === 'missing' && !String(process.env.X402_FIRE_ROUTES || '').trim()) {
    process.env.X402_FIRE_ROUTES = MISSING_CATALOG;
    console.log(TAG, 'X402_FIRE_CATALOG=missing →', MISSING_CATALOG);
  }

  const selectedRaw = String(process.env.X402_FIRE_ROUTES || '').trim();
  let toRun = routes;
  if (selectedRaw) {
    const want = selectedRaw.split(',').map((s) => s.trim()).filter(Boolean);
    toRun = [];
    for (const path of want) {
      const step = routes.find((r) => r.route === path);
      if (!step) {
        console.log(TAG, 'SKIPPED', path, 'err', 'unknown_route');
        // counted in loop below via synthetic skip — push a stub
        toRun.push({ route: path, unknown: true });
      } else {
        toRun.push(step);
      }
    }
    console.log(TAG, 'X402_FIRE_ROUTES filter:', want.join(', '));
  }

  let settled = 0;
  let skipped = 0;

  for (let i = 0; i < toRun.length; i++) {
    const step = toRun[i];
    try {
      if (step.unknown) {
        skipped++;
      } else {
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
      }
    } catch (err) {
      const cause = (err.cause && (err.cause.code || err.cause.message)) || err.message;
      console.log(TAG, 'SKIPPED', step.route, 'err', String(cause).slice(0, 150));
      skipped++;
    }

    if (i < toRun.length - 1) await sleep(1500);
  }

  console.log(
    TAG,
    `done: ${settled} settled, ${skipped} skipped — remove X402_FIRE_SETTLES from env now.`
  );
};
