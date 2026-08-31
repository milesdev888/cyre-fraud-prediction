// mcp/mount.js — wire /mcp + x402 HTTP gate onto an Express app
const fs = require('fs');
const path = require('path');
const { createX402Gate, applyX402Result } = require('../lib/x402-gate');
const { handleMcpRequest } = require('./server');
const { VERSION, TOOL_NAMES } = require('./tools');

const MCP_DESCRIPTION =
  'CYRE Guardian MCP — grade Solana addresses and scan token mints via tools grade_address, scan_token, batch_grade. Patterns, not verdicts.';

const ROOT = path.join(__dirname, '..');
const OWNERS_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'owners.json'), 'utf8'));
const AGENT_CARD_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent-card.json'), 'utf8'));
const X402_MANIFEST_JSON = JSON.parse(fs.readFileSync(path.join(ROOT, 'x402.json'), 'utf8'));

/** Free public JSON — never behind x402 / GUARDIAN_KEY. Supports GET + HEAD. */
function sendPublicJson(body) {
  return function publicJsonHandler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'HEAD') {
      res.status(200).end();
      return;
    }
    res.status(200).json(body);
  };
}

const sendOwnersJson = sendPublicJson(OWNERS_JSON);
const sendAgentCardJson = sendPublicJson(AGENT_CARD_JSON);
const sendX402ManifestJson = sendPublicJson(X402_MANIFEST_JSON);

function mountFreeWellKnown(app, route, handler) {
  app.get(route, handler);
  app.head(route, handler);
}

const MCP_DISCOVERY = {
  bazaar: {
    info: {
      input: {
        type: 'http',
        method: 'POST',
        description: 'Streamable HTTP MCP endpoint. Tools: grade_address, scan_token, batch_grade.'
      },
      output: {
        type: 'json',
        example: {
          tools: TOOL_NAMES,
          version: VERSION
        }
      }
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        tools: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', enum: TOOL_NAMES },
              resource_url: { type: 'string', description: 'Upstream Guardian HTTP resource used by the tool' }
            }
          }
        }
      }
    }
  }
};

function mountGuardianMcp(app) {
  require('../lib/discovery').mountDiscoveryRoutes(app);

  const mcpGate = createX402Gate({
    price: String(process.env.X402_PRICE_MCP || '5000'),
    resourcePath: '/mcp',
    description: MCP_DESCRIPTION,
    serviceName: 'CYRE Guardian',
    tags: ['risk', 'fraud', 'solana', 'mcp', 'agent'],
    discovery: MCP_DISCOVERY,
    baseOnly: true,
    isFree: () => false // /mcp always paid when X402_ENABLED (health is separate)
  });

  // Free discovery docs — BEFORE x402 gate; no auth.
  // owners.json — VerifyMCP (https://verifymcp.io/docs/build/owners-json)
  mountFreeWellKnown(app, '/mcp/.well-known/owners.json', sendOwnersJson);
  mountFreeWellKnown(app, '/.well-known/owners.json', sendOwnersJson);

  // A2A Agent Card — canonical agent-card.json; also agent.json for older crawlers
  // Spec: https://a2a-protocol.org/latest/specification/ (AgentCard + /.well-known/agent-card.json)
  mountFreeWellKnown(app, '/.well-known/agent-card.json', sendAgentCardJson);
  mountFreeWellKnown(app, '/.well-known/agent.json', sendAgentCardJson);
  mountFreeWellKnown(app, '/mcp/.well-known/agent-card.json', sendAgentCardJson);

  // x402 capability manifest — resource-server (not a same-domain facilitator)
  // Spec: draft-hawkins-x402-dns-discovery (/.well-known/x402)
  mountFreeWellKnown(app, '/.well-known/x402', sendX402ManifestJson);
  mountFreeWellKnown(app, '/mcp/.well-known/x402', sendX402ManifestJson);

  app.get('/mcp/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'cyre-guardian-mcp',
      version: VERSION,
      tools: TOOL_NAMES,
      transport: 'streamable-http',
      x402: process.env.X402_ENABLED === 'true',
      guardianKey: Boolean(process.env.GUARDIAN_KEY || process.env.X402_INTERNAL_KEY),
      note: 'Payment is enforced at the HTTP layer on /mcp (not MCP _meta). See docs/mcp.md.'
    });
  });

  // HTTP-layer x402: clients pay before Streamable HTTP MCP traffic.
  // MCP payment-via-_meta is not used — see docs/mcp.md tradeoff.
  app.all('/mcp', async (req, res, next) => {
    try {
      const gate = await mcpGate(req);
      if (applyX402Result(res, gate)) return;
      await handleMcpRequest(req, res);
    } catch (e) {
      console.error('[mcp]', e && e.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP handler failed', detail: String((e && e.message) || e).slice(0, 200) });
      }
    }
  });
}

module.exports = {
  mountGuardianMcp,
  MCP_DISCOVERY,
  VERSION,
  TOOL_NAMES,
  OWNERS_JSON,
  AGENT_CARD_JSON,
  X402_MANIFEST_JSON,
  sendOwnersJson,
  sendAgentCardJson,
  sendX402ManifestJson
};
