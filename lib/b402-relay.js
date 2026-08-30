// lib/b402-relay.js — B402 facilitator proxy for Binance (fixed egress via Render).
// Vercel has no static outbound IP; this service signs Tesla headers and talks to Binance.
//
// Env (owner fills; unset → 503 b402_not_configured):
//   B402_BASE_URL, B402_CLIENT_ID, B402_ACCESS_TOKEN, B402_RSA_PRIVATE_KEY
// Auth on /internal/b402/*: x-guardian-key === GUARDIAN_KEY (or X402_INTERNAL_KEY)

'use strict';

const crypto = require('crypto');
const express = require('express');

const OPS = new Set(['supported', 'verify', 'settle']);

function guardianKey() {
  return process.env.GUARDIAN_KEY || process.env.X402_INTERNAL_KEY || '';
}

function b402Config() {
  return {
    baseUrl: String(process.env.B402_BASE_URL || '').replace(/\/$/, ''),
    clientId: process.env.B402_CLIENT_ID || '',
    accessToken: process.env.B402_ACCESS_TOKEN || '',
    rsa: process.env.B402_RSA_PRIVATE_KEY || ''
  };
}

function isConfigured(cfg) {
  return Boolean(cfg.baseUrl && cfg.clientId && cfg.accessToken && cfg.rsa);
}

/** Load PKCS#8 DER Base64 or PEM RSA private key. */
function loadPrivateKey(rsa) {
  const trimmed = String(rsa || '').trim();
  if (!trimmed) throw new Error('B402_RSA_PRIVATE_KEY missing');
  if (trimmed.includes('BEGIN')) {
    return crypto.createPrivateKey(trimmed);
  }
  return crypto.createPrivateKey({
    key: Buffer.from(trimmed, 'base64'),
    format: 'der',
    type: 'pkcs8'
  });
}

/**
 * Sign exact body bytes + timestamp string (Binance Tesla scheme).
 * @param {Buffer|string} bodyBytes
 * @param {string} timestampMs
 * @param {string} rsaEnv
 * @returns {string} Base64 RSA-SHA256 signature
 */
function signBody(bodyBytes, timestampMs, rsaEnv) {
  const key = loadPrivateKey(rsaEnv);
  const body = Buffer.isBuffer(bodyBytes) ? bodyBytes : Buffer.from(String(bodyBytes), 'utf8');
  const toSign = Buffer.concat([body, Buffer.from(String(timestampMs), 'utf8')]);
  return crypto.createSign('SHA256').update(toSign).sign(key, 'base64');
}

function teslaHeaders(bodyBytes, cfg, timestampMs) {
  const timestamp = String(timestampMs != null ? timestampMs : Date.now());
  const signature = signBody(bodyBytes, timestamp, cfg.rsa);
  return {
    'Content-Type': 'application/json',
    'X-Tesla-ClientId': cfg.clientId,
    'X-Tesla-SignAccessToken': cfg.accessToken,
    'X-Tesla-Timestamp': timestamp,
    'X-Tesla-Signature': signature
  };
}

function requireGuardianKey(req, res, next) {
  const expected = guardianKey();
  if (!expected || req.headers['x-guardian-key'] !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

function healthHandler(_req, res) {
  const cfg = b402Config();
  res.json({
    configured: isConfigured(cfg),
    baseUrlSet: Boolean(cfg.baseUrl),
    hasKey: Boolean(cfg.rsa)
  });
}

async function forwardOp(req, res) {
  const op = String(req.params.op || '').toLowerCase();
  if (!OPS.has(op)) {
    return res.status(404).json({ error: 'unknown_op', op });
  }

  const cfg = b402Config();
  if (!isConfigured(cfg)) {
    return res.status(503).json({ error: 'b402_not_configured' });
  }

  // express.raw → Buffer; never re-serialize
  const bodyBuf = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(req.body == null ? '' : String(req.body), 'utf8');

  const headers = teslaHeaders(bodyBuf, cfg);
  const url = cfg.baseUrl + '/papi/v2/b402/' + op;

  let upstream;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyBuf
    });
  } catch (e) {
    return res.status(502).json({
      error: 'b402_upstream_unreachable',
      detail: String((e && e.message) || e).slice(0, 300)
    });
  }

  const text = await upstream.text();
  const ct = upstream.headers.get('content-type') || 'application/json';
  res.status(upstream.status);
  res.setHeader('content-type', ct);
  return res.send(text);
}

/**
 * Mount routes on Express app. Call BEFORE express.json() so POST bodies stay raw.
 * @param {import('express').Express} app
 */
function mount(app) {
  const router = express.Router();

  router.get('/health', requireGuardianKey, healthHandler);

  router.post(
    '/:op',
    express.raw({ type: () => true, limit: '2mb' }),
    requireGuardianKey,
    (req, res, next) => {
      Promise.resolve(forwardOp(req, res)).catch(next);
    }
  );

  app.use('/internal/b402', router);
}

module.exports = {
  mount,
  signBody,
  teslaHeaders,
  b402Config,
  isConfigured,
  loadPrivateKey,
  OPS,
  requireGuardianKey,
  healthHandler,
  forwardOp
};
