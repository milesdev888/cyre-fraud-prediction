// routes/b402-relay.js — Binance B402 facilitator relay (Render static egress → Binance IP whitelist)
// Vercel BSC lane calls POST /internal/b402/{supported|verify|settle} with x-guardian-key.
// See docs/B402-ENV.md · docs/B402-RESEARCH.md (Guardian repo PR #111).

const crypto = require('crypto');
const express = require('express');

require('dns').setDefaultResultOrder('ipv4first');

const OPS = new Set(['supported', 'verify', 'settle']);
const MAX_BODY = 64 * 1024;
const TIMEOUT_MS = 15000;
const BINANCE_PATH = '/papi/v2/b402';

function guardianKeyOk(req) {
  const expected = process.env.GUARDIAN_KEY || process.env.X402_INTERNAL_KEY || '';
  if (!expected) return false;
  return req.headers['x-guardian-key'] === expected;
}

function loadPrivateKey(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (v.startsWith('-----BEGIN')) {
    return crypto.createPrivateKey(v);
  }
  return crypto.createPrivateKey({ key: Buffer.from(v, 'base64'), format: 'der', type: 'pkcs8' });
}

/** Read B402 env at request time — never log values. */
function readB402Config() {
  const baseUrl = String(process.env.B402_BASE_URL || '').replace(/\/$/, '');
  const clientId = process.env.B402_CLIENT_ID || '';
  const accessToken = process.env.B402_ACCESS_TOKEN || '';
  const keyRaw = process.env.B402_RSA_PRIVATE_KEY || '';
  if (!baseUrl || !clientId || !accessToken || !keyRaw) {
    return { ok: false };
  }
  try {
    const privateKey = loadPrivateKey(keyRaw);
    return { ok: true, baseUrl, clientId, accessToken, privateKey };
  } catch (_e) {
    return { ok: false };
  }
}

function signaturePayload(bodyBuf, timestamp, sigOrder) {
  const ts = String(timestamp);
  const bodyStr = bodyBuf.toString('utf8');
  if (sigOrder === 'ts_body') return Buffer.from(ts + bodyStr, 'utf8');
  return Buffer.from(bodyStr + ts, 'utf8');
}

function signRequest(bodyBuf, timestamp, privateKey, sigOrder) {
  const payload = signaturePayload(bodyBuf, timestamp, sigOrder);
  return crypto.createSign('SHA256').update(payload).sign(privateKey, 'base64');
}

function verifyRequestSignature(bodyBuf, timestamp, signatureB64, publicKey, sigOrder) {
  const payload = signaturePayload(bodyBuf, timestamp, sigOrder);
  return crypto.createVerify('SHA256').update(payload).verify(publicKey, signatureB64, 'base64');
}

async function forwardToBinance(op, bodyBuf) {
  const cfg = readB402Config();
  if (!cfg.ok) {
    return {
      status: 503,
      body: Buffer.from(JSON.stringify({ error: 'b402_not_configured' }), 'utf8'),
      contentType: 'application/json'
    };
  }

  const timestamp = Date.now().toString();
  const sigOrder = String(process.env.B402_SIG_ORDER || 'body_ts').toLowerCase();
  const signature = signRequest(bodyBuf, timestamp, cfg.privateKey, sigOrder);
  const url = cfg.baseUrl + BINANCE_PATH + '/' + op;
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tesla-ClientId': cfg.clientId,
        'X-Tesla-SignAccessToken': cfg.accessToken,
        'X-Tesla-Timestamp': timestamp,
        'X-Tesla-Signature': signature
      },
      body: bodyBuf,
      signal: controller.signal
    });
    const respBody = Buffer.from(await upstream.arrayBuffer());
    const latency = Date.now() - started;
    console.log('[b402-relay] op=' + op + ' status=' + upstream.status + ' latency=' + latency + 'ms');
    return {
      status: upstream.status,
      body: respBody,
      contentType: upstream.headers.get('content-type') || 'application/json'
    };
  } catch (e) {
    const cause = (e && e.cause && e.cause.code) || (e && e.code) || (e && e.name) || 'UNKNOWN';
    const latency = Date.now() - started;
    console.log('[b402-relay] op=' + op + ' status=502 latency=' + latency + 'ms');
    return {
      status: 502,
      body: Buffer.from(JSON.stringify({ error: 'upstream_unreachable', cause: String(cause) }), 'utf8'),
      contentType: 'application/json'
    };
  } finally {
    clearTimeout(timer);
  }
}

function mountB402Relay(app) {
  app.post(
    '/internal/b402/:op',
    express.raw({ type: 'application/json', limit: MAX_BODY }),
    async (req, res) => {
      if (!guardianKeyOk(req)) {
        res.status(401).end();
        return;
      }

      const op = String(req.params.op || '');
      if (!OPS.has(op)) {
        res.status(404).json({ error: 'unknown_op' });
        return;
      }

      const bodyBuf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '', 'utf8');
      const result = await forwardToBinance(op, bodyBuf);
      res.setHeader('x-b402-relay', '1');
      if (result.contentType) res.setHeader('Content-Type', result.contentType);
      res.status(result.status).send(result.body);
    }
  );
}

module.exports = {
  mountB402Relay,
  OPS,
  MAX_BODY,
  TIMEOUT_MS,
  BINANCE_PATH,
  readB402Config,
  loadPrivateKey,
  signRequest,
  verifyRequestSignature,
  signaturePayload,
  forwardToBinance,
  guardianKeyOk
};
