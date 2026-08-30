# B402 relay (Render) — static egress for Binance IP allowlist

Binance B402 whitelists merchant **source IPs**. Vercel serverless has no fixed egress, so Guardian (`cyre.dev`) must not call Binance directly. This service (`cyre-fraud-prediction`, Render `srv-d9shhsijnfac739gl22g`) is the only hop that talks to `{B402_BASE_URL}/papi/v2/b402/*`.

## Routes

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `GET` | `/internal/b402/health` | `x-guardian-key: $GUARDIAN_KEY` | `{ configured, baseUrlSet, hasKey }` — no secrets |
| `POST` | `/internal/b402/:op` | same | `:op` ∈ `supported` \| `verify` \| `settle`. Forwards **exact body bytes** to Binance with Tesla RSA headers. Returns Binance status + body unchanged (BAPI envelope intact). |

Unset B402 env → `503 { "error": "b402_not_configured" }`.

## Render env (owner fills)

| Env | Purpose |
|---|---|
| `B402_BASE_URL` | Authenticated Binance `{BASE_URL}` from partner onboarding (no trailing slash) |
| `B402_CLIENT_ID` | Partner `clientId` |
| `B402_ACCESS_TOKEN` | Partner `accessToken` |
| `B402_RSA_PRIVATE_KEY` | PKCS#8 DER Base64 private key (from `scripts/b402-keygen.js`) |
| `GUARDIAN_KEY` | Already set — must match Vercel `X402_INTERNAL_KEY` |

## RSA keygen (owner machine only)

```bash
node scripts/b402-keygen.js
```

- Submit **PUBLIC** (SPKI Base64 DER) on https://forms.gle/aUQvxUETfGMzyTky5  
- Set **PRIVATE** as `B402_RSA_PRIVATE_KEY` on Render  
- Never commit keys; never run keygen in CI or print private key in deploy logs

## Static outbound IPs (Binance form)

Render MCP was unavailable in this agent run — IPs must be copied from the Dashboard.

### Preferred: Dedicated outbound IPs (Pro+)

Docs: https://render.com/docs/dedicated-ips

1. Render Dashboard → workspace home → **Networking** → **Dedicated IPs**  
2. **+ Create Dedicated IPs** → pick the **region** of `cyre-fraud-prediction` → scope workspace or the service’s environment  
3. After status is **Active**, open the service → **Connect** (upper right) → **Outbound** tab  
4. Copy the **three IPv4 addresses** into Binance’s IP whitelist field  

Billing: dedicated IP sets are billed monthly (see Render pricing).

### Fallback: shared regional outbound ranges

If you are not on Dedicated IPs yet:

1. Service page for `cyre-fraud-prediction` (`srv-d9shhsijnfac739gl22g`)  
2. **Connect** → **Outbound**  
3. Copy the listed CIDR ranges  

Shared ranges can change; Dedicated IPs are the right long-term allowlist for Binance.

**IPs visible to this agent:** none (Render API/MCP unauthorized). Owner: paste the Outbound tab values into the Binance form.
