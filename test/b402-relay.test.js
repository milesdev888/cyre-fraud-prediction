// test/b402-relay.test.js
'use strict';

const crypto = require('crypto');
const http = require('http');
const express = require('express');
const {
  signBody,
  loadPrivateKey,
  mount,
  isConfigured,
  b402Config
} = require('../lib/b402-relay');

function generatePair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' }
  });
}

describe('b402-relay signature', () => {
  test('signBody matches known vector (verify with public key)', () => {
    const { publicKey, privateKey } = generatePair();
    const privB64 = privateKey.toString('base64');
    const body = Buffer.from('{"x402Version":2,"hello":"world"}', 'utf8');
    const timestamp = '1710000000000';
    const sig = signBody(body, timestamp, privB64);

    const ok = crypto
      .createVerify('SHA256')
      .update(Buffer.concat([body, Buffer.from(timestamp, 'utf8')]))
      .verify(
        crypto.createPublicKey({ key: publicKey, format: 'der', type: 'spki' }),
        Buffer.from(sig, 'base64')
      );
    expect(ok).toBe(true);

    // Wrong body must fail
    const bad = crypto
      .createVerify('SHA256')
      .update(Buffer.concat([Buffer.from('{"x402Version":2}'), Buffer.from(timestamp, 'utf8')]))
      .verify(
        crypto.createPublicKey({ key: publicKey, format: 'der', type: 'spki' }),
        Buffer.from(sig, 'base64')
      );
    expect(bad).toBe(false);
  });

  test('loadPrivateKey accepts PKCS#8 DER Base64', () => {
    const { privateKey } = generatePair();
    const key = loadPrivateKey(privateKey.toString('base64'));
    expect(key.asymmetricKeyType).toBe('rsa');
  });
});

describe('b402-relay HTTP', () => {
  const prev = { ...process.env };
  let server;
  let baseUrl;
  let upstreamBodies;
  let upstreamServer;
  let privB64;

  beforeAll(async () => {
    const { privateKey } = generatePair();
    privB64 = privateKey.toString('base64');

    upstreamBodies = [];
    upstreamServer = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const buf = Buffer.concat(chunks);
        upstreamBodies.push({
          url: req.url,
          headers: req.headers,
          body: buf
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: '000000', data: { isValid: true, echo: true } }));
      });
    });
    await new Promise((r) => upstreamServer.listen(0, '127.0.0.1', r));
    const upPort = upstreamServer.address().port;

    process.env.GUARDIAN_KEY = 'test-guardian-key';
    process.env.B402_BASE_URL = 'http://127.0.0.1:' + upPort;
    process.env.B402_CLIENT_ID = 'client-test';
    process.env.B402_ACCESS_TOKEN = 'token-test';
    process.env.B402_RSA_PRIVATE_KEY = privB64;

    const app = express();
    // Mount before json — same as production
    mount(app);
    app.use(express.json());

    server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = 'http://127.0.0.1:' + server.address().port;
  });

  afterAll(async () => {
    for (const k of Object.keys(process.env)) {
      if (!(k in prev)) delete process.env[k];
    }
    Object.assign(process.env, prev);
    await new Promise((r) => server.close(r));
    await new Promise((r) => upstreamServer.close(r));
  });

  test('rejects missing key with 401', async () => {
    const r = await fetch(baseUrl + '/internal/b402/health');
    expect(r.status).toBe(401);
  });

  test('rejects wrong key with 401', async () => {
    const r = await fetch(baseUrl + '/internal/b402/health', {
      headers: { 'x-guardian-key': 'wrong' }
    });
    expect(r.status).toBe(401);
  });

  test('health with key never echoes secrets', async () => {
    const r = await fetch(baseUrl + '/internal/b402/health', {
      headers: { 'x-guardian-key': 'test-guardian-key' }
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.configured).toBe(true);
    expect(j.baseUrlSet).toBe(true);
    expect(j.hasKey).toBe(true);
    expect(JSON.stringify(j)).not.toMatch(/token-test|client-test|BEGIN|MII/);
  });

  test('forwards body bytes unchanged and signs Tesla headers', async () => {
    upstreamBodies.length = 0;
    // Deliberately ugly JSON (spaces) — must not be re-serialized
    const raw = Buffer.from('{"x402Version":2,"paymentPayload":{"a":1},"  odd  ":true}', 'utf8');
    const r = await fetch(baseUrl + '/internal/b402/verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-guardian-key': 'test-guardian-key'
      },
      body: raw
    });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.code).toBe('000000');
    expect(j.data.isValid).toBe(true);

    expect(upstreamBodies.length).toBe(1);
    const hit = upstreamBodies[0];
    expect(hit.url).toBe('/papi/v2/b402/verify');
    expect(Buffer.compare(hit.body, raw)).toBe(0);

    const ts = hit.headers['x-tesla-timestamp'];
    const sig = hit.headers['x-tesla-signature'];
    expect(hit.headers['x-tesla-clientid']).toBe('client-test');
    expect(hit.headers['x-tesla-signaccesstoken']).toBe('token-test');
    expect(ts).toBeTruthy();
    expect(sig).toBeTruthy();

    // Signature must be over exact bytes + timestamp
    const expected = signBody(raw, ts, privB64);
    expect(sig).toBe(expected);
  });

  test('503 when not configured', async () => {
    const saved = process.env.B402_BASE_URL;
    delete process.env.B402_BASE_URL;
    expect(isConfigured(b402Config())).toBe(false);

    const app = express();
    mount(app);
    const s = http.createServer(app);
    await new Promise((r) => s.listen(0, '127.0.0.1', r));
    const url = 'http://127.0.0.1:' + s.address().port;
    const r = await fetch(url + '/internal/b402/settle', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-guardian-key': 'test-guardian-key'
      },
      body: '{}'
    });
    expect(r.status).toBe(503);
    const j = await r.json();
    expect(j.error).toBe('b402_not_configured');
    process.env.B402_BASE_URL = saved;
    await new Promise((r) => s.close(r));
  });
});
