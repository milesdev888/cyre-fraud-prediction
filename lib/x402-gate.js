// lib/x402-gate.js — copied from -Cyre-Guardian api/_x402.js (shared copy, not a package).
// Used by /mcp HTTP gate. Keep in sync when Guardian gate changes. Site visitors stay free.
//
// Env (optional until X402_ENABLED=true):
//   X402_ENABLED, X402_NETWORK, X402_NETWORK_BASE, X402_PRICE (per-route override via createX402Gate)
//   CDP_API_KEY_ID, CDP_API_KEY_SECRET
//   X402_PAY_TO, X402_FACILITATOR, X402_PAY_TO_BASE, X402_FACILITATOR_BASE
//   X402_INTERNAL_KEY or GUARDIAN_KEY — bypass via x-guardian-key header

const DEFAULT_FACILITATOR = 'https://x402.org/facilitator';
const CDP_FACILITATOR = 'https://api.cdp.coinbase.com/platform/v2/x402';

function cdpKeys() {
  return {
    id: process.env.CDP_API_KEY_ID || '',
    secret: process.env.CDP_API_KEY_SECRET || ''
  };
}

function netConfig() {
  return {
    net: (process.env.X402_NETWORK || 'devnet').toLowerCase(),
    netBase: (process.env.X402_NETWORK_BASE || 'mainnet').toLowerCase()
  };
}

function buildLanes() {
  const { id, secret } = cdpKeys();
  return [
    {
      name: 'solana',
      payTo: process.env.X402_PAY_TO || '',
      facilitator: (process.env.X402_FACILITATOR || DEFAULT_FACILITATOR).replace(/\/$/, ''),
      mainnet: { network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', usdc: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
      devnet: { network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', usdc: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' }
    },
    {
      name: 'base',
      payTo: process.env.X402_PAY_TO_BASE || '0x9Ff25C4acf1DcDDf15fD2702C127A285f1dFa712',
      facilitator: (process.env.X402_FACILITATOR_BASE || (id && secret ? CDP_FACILITATOR : DEFAULT_FACILITATOR)).replace(/\/$/, ''),
      mainnet: { network: 'eip155:8453', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', extra: { name: 'USD Coin', version: '2' } },
      devnet: { network: 'eip155:84532', usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', extra: { name: 'USDC', version: '2' } }
    }
  ];
}

function armedLanes() {
  return buildLanes().filter((l) => l.payTo);
}

function laneNet(lane) {
  const { net, netBase } = netConfig();
  return lane.name === 'base' ? netBase : net;
}

function normAddr(v) {
  const s = String(v || '');
  return s.startsWith('0x') ? s.toLowerCase() : s;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function cdpPrivateKey() {
  const crypto = require('crypto');
  const { secret } = cdpKeys();
  const s = secret.trim();
  if (s.includes('BEGIN')) {
    return { key: crypto.createPrivateKey(s), alg: 'ES256' };
  }
  const raw = Buffer.from(s, 'base64');
  if (raw.length !== 64) {
    throw new Error('CDP Ed25519 secret must decode to 64 bytes');
  }
  const seed = raw.subarray(0, 32);
  const publicKey = raw.subarray(32);
  return {
    key: crypto.createPrivateKey({
      key: { kty: 'OKP', crv: 'Ed25519', d: seed.toString('base64url'), x: publicKey.toString('base64url') },
      format: 'jwk'
    }),
    alg: 'EdDSA'
  };
}

function cdpJwt(method, urlPath) {
  const crypto = require('crypto');
  const { id } = cdpKeys();
  const { key, alg } = cdpPrivateKey();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg, kid: id, typ: 'JWT', nonce: crypto.randomBytes(16).toString('hex') };
  const payload = {
    iss: 'cdp',
    sub: id,
    nbf: now,
    exp: now + 120,
    uris: [method + ' ' + 'api.cdp.coinbase.com' + urlPath]
  };
  const signingInput = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  let sig;
  if (alg === 'EdDSA') {
    sig = crypto.sign(null, Buffer.from(signingInput), key);
  } else {
    sig = crypto.sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  }
  return signingInput + '.' + b64url(sig);
}

async function callFacilitator(base, path, body) {
  const headers = { 'content-type': 'application/json' };
  const { id, secret } = cdpKeys();
  if (base.includes('api.cdp.coinbase.com') && id && secret) {
    const urlPath = new URL(base + path).pathname;
    headers.authorization = 'Bearer ' + cdpJwt('POST', urlPath);
  }
  const r = await fetch(base + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    data = null;
  }
  if (data && (Object.prototype.hasOwnProperty.call(data, 'isValid') || Object.prototype.hasOwnProperty.call(data, 'success'))) {
    return data;
  }
  if (!r.ok) throw new Error('facilitator ' + path + ' ' + r.status + ' ' + text.slice(0, 300));
  return data || {};
}

/** cyre.dev (www) only — address-profile free path */
function isCyreSiteRequest(req) {
  const src = String(req.headers.origin || req.headers.referer || '');
  return /^https:\/\/(www\.)?cyre\.dev(\/|$)/.test(src);
}

/** cyre.dev + Vercel preview deploys for this project */
function isCyreOrPreviewRequest(req) {
  if (isCyreSiteRequest(req)) return true;
  const origin = String(req.headers.origin || '');
  const referer = String(req.headers.referer || '');
  const preview = /^https:\/\/cyre-guardian[\w.-]*\.vercel\.app/;
  return preview.test(origin) || preview.test(referer);
}

/**
 * @param {object} opts
 * @param {string} opts.price — atomic USDC amount string
 * @param {string} opts.resourcePath — e.g. '/api/address'
 * @param {string} opts.description
 * @param {string} [opts.serviceName]
 * @param {string[]} [opts.tags]
 * @param {string} [opts.iconUrl]
 * @param {object} opts.discovery — bazaar extension object { bazaar: { info, schema } }
 * @param {(req: any) => boolean} [opts.isFree] — return true to skip payment
 * @param {boolean} [opts.baseOnly] — only arm Base lane
 */
function createX402Gate(opts) {
  const price = String(opts.price);
  const resourcePath = opts.resourcePath;
  const description = opts.description;
  const serviceName = opts.serviceName || 'CYRE Guardian';
  const tags = opts.tags || ['risk', 'fraud', 'solana', 'security'];
  const iconUrl = opts.iconUrl || 'https://cyre.dev/favicon.png';
  const discovery = opts.discovery;
  const isFree = opts.isFree || isCyreSiteRequest;
  const baseOnly = !!opts.baseOnly;

  function laneRequirements(lane) {
    const env = laneNet(lane) === 'mainnet' ? lane.mainnet : lane.devnet;
    return {
      scheme: 'exact',
      network: env.network,
      amount: price,
      asset: env.usdc,
      payTo: lane.payTo,
      maxTimeoutSeconds: 60,
      extra: env.extra || {}
    };
  }

  function resourceInfo(resourceUrl) {
    return {
      url: resourceUrl,
      description,
      mimeType: 'application/json',
      serviceName,
      tags,
      iconUrl
    };
  }

  function paymentRequired(resourceUrl, accepts, error) {
    return { x402Version: 2, error, resource: resourceInfo(resourceUrl), accepts, extensions: discovery };
  }

  return async function x402Gate(req) {
    if (process.env.X402_ENABLED !== 'true') return null;
    if (isFree(req)) return null;

    const internalKey = process.env.X402_INTERNAL_KEY || process.env.GUARDIAN_KEY || '';
    if (internalKey && req.headers['x-guardian-key'] === internalKey) return null;

    let lanes = armedLanes();
    if (baseOnly) lanes = lanes.filter((l) => l.name === 'base');
    if (!lanes.length) {
      console.error('x402: X402_ENABLED but no treasury set — serving free');
      return null;
    }

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'cyre.dev';
    const resourceUrl = proto + '://' + host + resourcePath;
    const accepts = lanes.map((l) => laneRequirements(l));

    const header = req.headers['payment-signature'] || req.headers['x-payment'];
    if (!header) {
      return { status: 402, body: paymentRequired(resourceUrl, accepts, 'Payment required') };
    }

    let payment;
    try {
      payment = JSON.parse(Buffer.from(String(header), 'base64').toString('utf8'));
    } catch (e) {
      return { status: 402, body: paymentRequired(resourceUrl, accepts, 'Malformed PAYMENT-SIGNATURE header') };
    }

    const paidNetwork = payment && ((payment.accepted && payment.accepted.network) || payment.network);
    const idx = lanes.findIndex((l) => {
      const env = laneNet(l) === 'mainnet' ? l.mainnet : l.devnet;
      return paidNetwork === env.network;
    });
    if (idx === -1) {
      return { status: 402, body: paymentRequired(resourceUrl, accepts, 'Unsupported payment network') };
    }
    const lane = lanes[idx];
    const expected = accepts[idx];
    const accepted = payment && payment.accepted;
    if (!accepted) {
      return { status: 402, body: paymentRequired(resourceUrl, accepts, 'Malformed payment payload') };
    }
    try {
      if (BigInt(accepted.amount || '0') < BigInt(expected.amount || '0')) {
        return { status: 402, body: paymentRequired(resourceUrl, accepts, 'amount_too_low') };
      }
    } catch (e) {
      return { status: 402, body: paymentRequired(resourceUrl, accepts, 'amount_too_low') };
    }
    if (accepted.scheme !== expected.scheme ||
        accepted.network !== expected.network ||
        normAddr(accepted.asset) !== normAddr(expected.asset) ||
        normAddr(accepted.payTo) !== normAddr(expected.payTo)) {
      return { status: 402, body: paymentRequired(resourceUrl, accepts, 'offer_mismatch') };
    }
    const requirements = accepted;

    try {
      const v = await callFacilitator(lane.facilitator, '/verify', { x402Version: 2, paymentPayload: payment, paymentRequirements: requirements });
      if (!v || v.isValid !== true) {
        const reason = (v && (v.invalidMessage || v.invalidReason)) || 'Payment invalid';
        return { status: 402, body: paymentRequired(resourceUrl, accepts, reason) };
      }
      const s = await callFacilitator(lane.facilitator, '/settle', { x402Version: 2, paymentPayload: payment, paymentRequirements: requirements });
      if (!s || s.success !== true) {
        const reason = (s && (s.errorMessage || s.errorReason)) || 'Settlement failed';
        return { status: 402, body: paymentRequired(resourceUrl, accepts, reason) };
      }
      return { settled: s };
    } catch (e) {
      console.error('x402 facilitator error', e && e.message);
      return { status: 502, body: { error: 'Payment processor unreachable. Try again shortly.', detail: String((e && e.message) || e).slice(0, 300) } };
    }
  };
}

/** Apply gate result to a Vercel/Express-style res. Returns true if response was sent. */
function applyX402Result(res, gate) {
  if (!gate) return false;
  if (gate.status) {
    if (gate.status === 402) {
      try { res.setHeader('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(gate.body)).toString('base64')); } catch (e) { /* non-fatal */ }
    }
    res.status(gate.status).json(gate.body);
    return true;
  }
  if (gate.settled) {
    try {
      const b64 = Buffer.from(JSON.stringify(gate.settled)).toString('base64');
      res.setHeader('PAYMENT-RESPONSE', b64);
      res.setHeader('X-PAYMENT-RESPONSE', b64);
    } catch (e) { /* non-fatal */ }
  }
  return false;
}

module.exports = {
  createX402Gate,
  applyX402Result,
  isCyreSiteRequest,
  isCyreOrPreviewRequest
};
