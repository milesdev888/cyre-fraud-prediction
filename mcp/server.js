// mcp/server.js — Streamable HTTP MCP server (stateless) for CYRE Guardian tools
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { VERSION, gradeAddress, scanToken, batchGrade } = require('./tools');

function createGuardianMcpServer() {
  const server = new McpServer({
    name: 'cyre-guardian',
    version: VERSION
  });

  server.tool(
    'grade_address',
    'Grade a Solana wallet/program address with CYRE Guardian risk signals (patterns, not verdicts).',
    { address: z.string().describe('Solana address (base58)') },
    async ({ address }) => {
      const data = await gradeAddress(address);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'scan_token',
    'Scan a Solana token mint: mint/freeze authority, holder concentration, supply facts.',
    { mint: z.string().describe('Solana token mint address (base58)') },
    async ({ mint }) => {
      const data = await scanToken(mint);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.tool(
    'batch_grade',
    'Grade up to 25 Solana addresses; returns an array of per-address results.',
    {
      addresses: z.array(z.string()).min(1).max(25).describe('Solana addresses (base58), max 25')
    },
    async ({ addresses }) => {
      const data = await batchGrade(addresses);
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    }
  );

  return server;
}

/** Express middleware: handle Streamable HTTP MCP on this request (stateless). */
async function handleMcpRequest(req, res) {
  const server = createGuardianMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined // stateless — any instance can serve any request
  });
  res.on('close', () => {
    try { transport.close(); } catch (_) { /* ignore */ }
    try { server.close(); } catch (_) { /* ignore */ }
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

module.exports = {
  createGuardianMcpServer,
  handleMcpRequest
};
