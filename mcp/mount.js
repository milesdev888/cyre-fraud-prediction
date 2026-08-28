// mcp/mount.js — wire /mcp + x402 HTTP gate onto an Express app
const { createX402Gate, applyX402Result } = require('../lib/x402-gate');
const { handleMcpRequest } = require('./server');
const { VERSION, TOOL_NAMES } = require('./tools');

const MCP_DESCRIPTION =
  'CYRE Guardian MCP — grade Solana addresses and scan token mints via tools grade_address, scan_token, batch_grade. Patterns, not verdicts.';

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

function mcpResourcePath(req) {
  // Prefer public URL if set (Render custom domain); else path /mcp
  return '/mcp';
}

function mountGuardianMcp(app) {
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
      // Adapt Express req to the gate's header shape (already compatible)
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

module.exports = { mountGuardianMcp, MCP_DISCOVERY, VERSION, TOOL_NAMES };
