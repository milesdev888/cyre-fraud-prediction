// lib/root-page.js — GET/HEAD / for browsers & unfurlers + JSON index for agents
// Free, no x402. Does not alter /mcp routing.

const UNFURL_UA =
  /Twitterbot|facebookexternalhit|Slackbot|Discordbot|LinkedInBot|TelegramBot|WhatsApp/i;

const JSON_INDEX = {
  name: 'CYRE Guardian MCP host',
  mcp: '/mcp',
  health: '/mcp/health',
  openapi: '/openapi.json',
  x402: '/.well-known/x402',
  agentCard: '/.well-known/agent-card.json',
  skill: 'https://cyre.dev/SKILL.md',
  site: 'https://cyre.dev'
};

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CYRE Guardian — MCP host</title>
<meta property="og:title" content="CYRE Guardian">
<meta property="og:description" content="Explainable on-chain risk signals for AI agents. Pay-per-request via x402. Patterns, not verdicts.">
<meta property="og:url" content="https://cyre-fraud-prediction.onrender.com/">
<meta property="og:image" content="https://cyre.dev/cyre-token-512.png">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="CYRE Guardian">
<meta name="twitter:description" content="Explainable on-chain risk signals for AI agents. Pay-per-request via x402. Patterns, not verdicts.">
<style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
font-family:ui-sans-serif,system-ui,sans-serif;background:#0a0b0d;color:#e8eaed}
main{max-width:36rem;padding:2rem;line-height:1.5}
h1{font-size:1.5rem;margin:0 0 .75rem;color:#fff}
p{margin:0 0 1.25rem;color:#a0a6b0}
a{color:#0052ff;margin-right:.75rem}
</style>
</head>
<body>
<main>
<h1>CYRE Guardian</h1>
<p>MCP host for explainable on-chain risk signals. Pay-per-request via x402. Patterns, not verdicts.</p>
<p>
<a href="https://cyre.dev">cyre.dev</a>
<a href="https://cyre.dev/SKILL.md">SKILL.md</a>
<a href="/openapi.json">openapi.json</a>
<a href="/.well-known/x402">x402</a>
<a href="/.well-known/agent-card.json">agent-card</a>
<a href="/mcp/health">health</a>
</p>
</main>
</body>
</html>`;

const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#0052ff"/><text x="8" y="12" text-anchor="middle" font-size="9" font-family="system-ui,sans-serif" fill="#fff" font-weight="700">G</text></svg>';

function wantsHtml(req) {
  const accept = String(req.headers.accept || '');
  if (accept.includes('text/html')) return true;
  const ua = String(req.headers['user-agent'] || '');
  return UNFURL_UA.test(ua);
}

function handleRoot(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (wantsHtml(req)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.method === 'HEAD') return res.status(200).end();
    return res.status(200).send(HTML_PAGE);
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'HEAD') return res.status(200).end();
  return res.status(200).json(JSON_INDEX);
}

function handleFavicon(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'image/svg+xml');
  if (req.method === 'HEAD') return res.status(200).end();
  return res.status(200).send(FAVICON_SVG);
}

function mountRootPage(app) {
  app.get('/', handleRoot);
  app.head('/', handleRoot);
  app.get('/favicon.ico', handleFavicon);
  app.head('/favicon.ico', handleFavicon);
}

module.exports = {
  mountRootPage,
  wantsHtml,
  handleRoot,
  handleFavicon,
  JSON_INDEX,
  HTML_PAGE,
  UNFURL_UA
};
