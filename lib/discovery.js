// lib/discovery.js — crawler-facing static discovery routes (no auth, no x402)

const GLAMA_JSON = {
  $schema: 'https://glama.ai/mcp/schemas/server.json',
  maintainers: ['milesdev888']
};

const PAY_TO = '0x9Ff25C4acf1DcDDf15fD2702C127A285f1dFa712';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const MCP_PRICE = String(process.env.X402_PRICE_MCP || '5000');

function buildOpenApi() {
  const host = process.env.PUBLIC_HOST || 'cyre-fraud-prediction.onrender.com';
  const baseUrl = 'https://' + host.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return {
    openapi: '3.1.0',
    info: {
      title: 'CYRE Guardian MCP',
      version: '1.0.0',
      description:
        'x402-gated MCP server for Solana address grading and token scans. Patterns, not verdicts. Skill: https://cyre.dev/SKILL.md'
    },
    servers: [{ url: baseUrl }],
    paths: {
      '/mcp': {
        post: {
          summary: 'Guardian MCP (Streamable HTTP, JSON-RPC)',
          description:
            'Paid MCP endpoint. Tools: grade_address, scan_token, batch_grade. HTTP 402 before MCP traffic.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } }
          },
          responses: {
            '200': {
              description: 'MCP JSON-RPC response',
              content: { 'application/json': { schema: { type: 'object' } } }
            },
            '402': {
              description: 'Payment required (x402 v2)',
              headers: {
                'PAYMENT-REQUIRED': {
                  description: 'Base64url-encoded x402 v2 PaymentRequired payload',
                  schema: { type: 'string' }
                }
              }
            }
          }
        }
      },
      '/mcp/health': {
        get: {
          summary: 'MCP health',
          responses: {
            '200': {
              description: 'Service health',
              content: { 'application/json': { schema: { type: 'object' } } }
            }
          }
        }
      },
      '/.well-known/x402': {
        get: {
          summary: 'x402 capability manifest',
          responses: {
            '200': {
              description: 'x402 resource-server manifest',
              content: { 'application/json': { schema: { type: 'object' } } }
            }
          }
        }
      },
      '/.well-known/agent-card.json': {
        get: {
          summary: 'A2A agent card',
          responses: {
            '200': {
              description: 'Agent card JSON',
              content: { 'application/json': { schema: { type: 'object' } } }
            }
          }
        }
      },
      '/mcp/.well-known/owners.json': {
        get: {
          summary: 'MCP owners manifest',
          responses: {
            '200': {
              description: 'VerifyMCP owners.json',
              content: { 'application/json': { schema: { type: 'object' } } }
            }
          }
        }
      }
    },
    'x-x402': {
      network: 'eip155:8453',
      asset: 'USDC',
      assetContract: USDC_BASE,
      payTo: PAY_TO,
      tools: {
        grade_address: { amount: MCP_PRICE, currency: 'USDC', decimals: 6 },
        scan_token: { amount: MCP_PRICE, currency: 'USDC', decimals: 6 },
        batch_grade: { amount: MCP_PRICE, currency: 'USDC', decimals: 6 }
      }
    }
  };
}

const ROBOTS_TXT = 'User-agent: *\nAllow: /\n';

function sendCached(res, contentType, body) {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).send(body);
}

function mountDiscoveryRoutes(app) {
  app.get('/.well-known/glama.json', (_req, res) => {
    sendCached(res, 'application/json; charset=utf-8', JSON.stringify(GLAMA_JSON));
  });

  app.get('/openapi.json', (_req, res) => {
    sendCached(res, 'application/json; charset=utf-8', JSON.stringify(buildOpenApi()));
  });

  app.get('/robots.txt', (_req, res) => {
    sendCached(res, 'text/plain; charset=utf-8', ROBOTS_TXT);
  });
}

module.exports = {
  mountDiscoveryRoutes,
  GLAMA_JSON,
  ROBOTS_TXT,
  buildOpenApi
};
