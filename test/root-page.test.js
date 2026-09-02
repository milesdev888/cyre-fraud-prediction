const http = require('http');
const express = require('express');
const { mountRootPage, wantsHtml, JSON_INDEX, HTML_PAGE } = require('../lib/root-page');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        base: 'http://127.0.0.1:' + port,
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

function req(base, path, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const u = new URL(path, base);
    const r = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() })
        );
      }
    );
    r.on('error', reject);
    r.end();
  });
}

describe('root page', () => {
  test('wantsHtml for Accept and unfurlers', () => {
    expect(wantsHtml({ headers: { accept: 'text/html' } })).toBe(true);
    expect(wantsHtml({ headers: { 'user-agent': 'Twitterbot/1.0' } })).toBe(true);
    expect(wantsHtml({ headers: { accept: 'application/json', 'user-agent': 'curl/8' } })).toBe(false);
  });

  test('GET / HTML vs JSON', async () => {
    const app = express();
    mountRootPage(app);
    const srv = await listen(app);
    try {
      const html = await req(srv.base, '/', { Accept: 'text/html' });
      expect(html.status).toBe(200);
      expect(html.headers['cache-control']).toBe('public, max-age=300');
      expect(html.body).toContain('<title>CYRE Guardian — MCP host</title>');
      expect(html.body).toContain('og:title');
      expect(html.body.length).toBeLessThan(4096);

      const tw = await req(srv.base, '/', { 'User-Agent': 'Twitterbot/1.0' });
      expect(tw.status).toBe(200);
      expect(tw.body).toContain('og:image');

      const json = await req(srv.base, '/', { Accept: 'application/json' });
      expect(json.status).toBe(200);
      expect(JSON.parse(json.body).mcp).toBe('/mcp');
      expect(JSON.parse(json.body).name).toBe(JSON_INDEX.name);

      const fav = await req(srv.base, '/favicon.ico');
      expect(fav.status).toBe(200);
      expect(fav.headers['cache-control']).toBe('public, max-age=86400');
      expect(fav.body).toContain('<svg');
    } finally {
      await srv.close();
    }
  });

  test('HTML page has no banned wording', () => {
    const low = HTML_PAGE.toLowerCase();
    expect(low).not.toContain('partner');
    expect(low).not.toContain('safe');
    expect(low).not.toMatch(/\d+%/);
  });
});
