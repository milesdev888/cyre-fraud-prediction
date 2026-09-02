const crypto = require('crypto');
const http = require('http');
const express = require('express');
const {
  mountB402Relay,
  signRequest,
  verifyRequestSignature,
  readB402Config,
  forwardToBinance
} = require('../routes/b402-relay');

function generateTestKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 1024,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' }
  });
  return {
    privateKeyDerB64: privateKey.toString('base64'),
    publicKey: crypto.createPublicKey({ key: publicKey, format: 'der', type: 'spki' }),
    privateKey: crypto.createPrivateKey({ key: privateKey, format: 'der', type: 'pkcs8' })
  };
}

function listenApp(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        base: 'http://127.0.0.1:' + port,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

function postRaw(base, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    const url = new URL(path, base);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': buf.length,
          ...headers
        }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
      }
    );
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

function getRaw(base, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'GET',
        headers: { ...headers }
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks)
          });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

describe('b402-relay', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });

  test('signature test vector — body_ts matches public verify', () => {
    const keys = generateTestKeyPair();
    const body = Buffer.from('{"x":1} ', 'utf8');
    const ts = '1700000000000';
    const sig = signRequest(body, ts, keys.privateKey, 'body_ts');
    expect(verifyRequestSignature(body, ts, sig, keys.publicKey, 'body_ts')).toBe(true);
    expect(verifyRequestSignature(body, ts, sig, keys.publicKey, 'ts_body')).toBe(false);
  });

  test('readB402Config false when any env missing', () => {
    delete process.env.B402_BASE_URL;
    delete process.env.B402_CLIENT_ID;
    delete process.env.B402_ACCESS_TOKEN;
    delete process.env.B402_RSA_PRIVATE_KEY;
    expect(readB402Config().ok).toBe(false);
  });

  test('401 without guardian key', async () => {
    process.env.GUARDIAN_KEY = 'gk-test';
    const app = express();
    mountB402Relay(app);
    const srv = await listenApp(app);
    try {
      const r = await postRaw(srv.base, '/internal/b402/supported', '{}');
      expect(r.status).toBe(401);
      expect(r.body.length).toBe(0);
    } finally {
      await srv.close();
    }
  });

  test('GET /health 401 without key; 200 with configured flags', async () => {
    process.env.GUARDIAN_KEY = 'gk-test';
    delete process.env.B402_BASE_URL;
    delete process.env.B402_CLIENT_ID;
    delete process.env.B402_ACCESS_TOKEN;
    delete process.env.B402_RSA_PRIVATE_KEY;
    const app = express();
    mountB402Relay(app);
    const srv = await listenApp(app);
    try {
      const denied = await getRaw(srv.base, '/internal/b402/health');
      expect(denied.status).toBe(401);
      const ok = await getRaw(srv.base, '/internal/b402/health', { 'x-guardian-key': 'gk-test' });
      expect(ok.status).toBe(200);
      const body = JSON.parse(ok.body.toString());
      expect(body).toEqual({ configured: false, baseUrlSet: false, hasKey: false });
      expect(ok.headers['x-b402-relay']).toBe('1');
    } finally {
      await srv.close();
    }
  });

  test('503 b402_not_configured when env unset', async () => {
    process.env.GUARDIAN_KEY = 'gk-test';
    delete process.env.B402_BASE_URL;
    delete process.env.B402_CLIENT_ID;
    delete process.env.B402_ACCESS_TOKEN;
    delete process.env.B402_RSA_PRIVATE_KEY;
    const app = express();
    mountB402Relay(app);
    const srv = await listenApp(app);
    try {
      const r = await postRaw(srv.base, '/internal/b402/supported', '{}', { 'x-guardian-key': 'gk-test' });
      expect(r.status).toBe(503);
      expect(JSON.parse(r.body.toString()).error).toBe('b402_not_configured');
      expect(r.headers['x-b402-relay']).toBe('1');
    } finally {
      await srv.close();
    }
  });

  test('raw bytes passthrough to mock upstream', async () => {
    const keys = generateTestKeyPair();
    process.env.GUARDIAN_KEY = 'gk-test';
    process.env.B402_BASE_URL = 'https://b402.example.test';
    process.env.B402_CLIENT_ID = 'cid';
    process.env.B402_ACCESS_TOKEN = 'tok';
    process.env.B402_RSA_PRIVATE_KEY = keys.privateKeyDerB64;

    const unusual = Buffer.from('{ "a" : 1 }', 'utf8');
    const realFetch = global.fetch;
    global.fetch = jest.fn(async (_url, init) => {
      expect(Buffer.isBuffer(init.body)).toBe(true);
      expect(init.body.equals(unusual)).toBe(true);
      return {
        status: 200,
        headers: { get: () => 'application/json' },
        arrayBuffer: async () => Buffer.from('{"code":"000000","data":{}}').buffer
      };
    });

    const app = express();
    mountB402Relay(app);
    const srv = await listenApp(app);
    try {
      const r = await postRaw(srv.base, '/internal/b402/verify', unusual, { 'x-guardian-key': 'gk-test' });
      expect(r.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      const calledUrl = global.fetch.mock.calls[0][0];
      expect(String(calledUrl)).toContain('/papi/v2/b402/verify');
    } finally {
      await srv.close();
      global.fetch = realFetch;
    }
  });

  test('502 upstream_unreachable on network failure', async () => {
    const keys = generateTestKeyPair();
    process.env.B402_BASE_URL = 'https://b402.example.test';
    process.env.B402_CLIENT_ID = 'cid';
    process.env.B402_ACCESS_TOKEN = 'tok';
    process.env.B402_RSA_PRIVATE_KEY = keys.privateKeyDerB64;

    const err = new Error('fail');
    err.code = 'ENOTFOUND';
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => {
      throw err;
    });

    const out = await forwardToBinance('supported', Buffer.from('{}'));
    expect(out.status).toBe(502);
    expect(JSON.parse(out.body.toString()).error).toBe('upstream_unreachable');
    expect(JSON.parse(out.body.toString()).cause).toBe('ENOTFOUND');
    global.fetch = realFetch;
  });
});
