# CYRE Guardian MCP

Streamable HTTP MCP endpoint on this service: **`/mcp`**.

Tools call `https://cyre.dev` with header `x-guardian-key: $GUARDIAN_KEY` so the MCP host never pays Guardian itself. The site checker on cyre.dev stays free via Origin/Referer.

## Tools

| Tool | Args | Upstream |
|------|------|----------|
| `grade_address` | `address: string` | `GET /api/address?address=` |
| `scan_token` | `mint: string` | `GET /api/token?mint=` |
| `batch_grade` | `addresses: string[]` (max 25) | loops `grade_address` |

## Payment (x402 HTTP layer)

`/mcp` is gated with **x402 v2 at the HTTP layer** (same CDP Base mainnet lane as Guardian).

| Item | Value |
|------|--------|
| Network | `eip155:8453` |
| Asset | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| payTo | `0x9Ff25C4acf1DcDDf15fD2702C127A285f1dFa712` |
| Price | `X402_PRICE_MCP` (default `5000` = $0.005) |
| Facilitator | CDP when `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET` are set |

**Tradeoff:** We do **not** implement MCP payment via `_meta` (x402 MCP transport). Clients must satisfy the HTTP `402` / `PAYMENT-SIGNATURE` exchange on `/mcp` before Streamable HTTP MCP traffic. That keeps the gate identical to Guardian’s HTTP APIs and avoids an unstable `_meta` payment path. Bazaar discovery is attached to the HTTP 402 for resource `/mcp` (tools listed in the extension schema).

`GET /mcp/health` is **free** (no x402).

## VerifyMCP owners.json (free)

Public ownership claim for [VerifyMCP](https://verifymcp.io/docs/build/owners-json). Served **before** the x402 gate (no payment, no `GUARDIAN_KEY`):

| Path | Claims |
|------|--------|
| `GET /mcp/.well-known/owners.json` | This MCP endpoint only |
| `GET /.well-known/owners.json` | Every MCP on this host |

Body is `owners.json` at repo root (`owners` = VerifyMCP account emails). `Cache-Control: public, max-age=3600`.

## Env

| Var | Required | Notes |
|-----|----------|--------|
| `GUARDIAN_KEY` | yes (for tools) | Must match Guardian `X402_INTERNAL_KEY` |
| `GUARDIAN_BASE` | no | Default `https://cyre.dev` |
| `X402_ENABLED` | for paid MCP | `true` to arm |
| `X402_PRICE_MCP` | no | Default `5000` |
| `X402_PAY_TO_BASE` | no | Default CDP treasury `0x9Ff2…dFa712` |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | for CDP settle | Same as payer/Guardian |
| `X402_NETWORK_BASE` | no | Default `mainnet` |

Gate source: **`lib/x402-gate.js`** — copy of `-Cyre-Guardian` `api/_x402.js` (not an npm package). Keep in sync when the Guardian gate changes.

## Health

```bash
curl -sS https://YOUR-RENDER-HOST/mcp/health
```

## Verify live 402 (after deploy)

```bash
curl -sS -i -X POST "https://YOUR-RENDER-HOST/mcp" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

Expect **HTTP 402** with JSON body `x402Version: 2`, Base accept `eip155:8453`, `payTo` ending `dFa712`, and `extensions.bazaar`.

## Claude Desktop / Cursor config

```json
{
  "mcpServers": {
    "cyre-guardian": {
      "url": "https://YOUR-RENDER-HOST/mcp",
      "transport": "http"
    }
  }
}
```

Clients that speak x402 must attach `PAYMENT-SIGNATURE` after the 402 challenge (or use an x402-aware MCP proxy). Until then, point internal agents at `/mcp` only after paying, or call Guardian HTTP APIs directly with `x-guardian-key`.

## Local test

```bash
npm test
```
