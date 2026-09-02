# B402 relay (Render) — static egress for Binance IP allowlist

Binance B402 whitelists merchant **source IPs**. Vercel serverless has no fixed egress, so Guardian (`cyre.dev`) must not call Binance directly. This service (`cyre-fraud-prediction`) is the only hop that talks to `{B402_BASE_URL}/papi/v2/b402/*`.

The relay code is already on `main` (merged via PR #11). This doc is the paste-ready owner checklist for when Sandbox credentials arrive. **Do not set any of these env vars until Binance issues them.** Do not generate RSA keys in CI.

## Routes

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `GET` | `/internal/b402/health` | `x-guardian-key: $GUARDIAN_KEY` | `{ configured, baseUrlSet, hasKey }` — no secrets |
| `POST` | `/internal/b402/:op` | same | `:op` ∈ `supported` \| `verify` \| `settle`. Forwards **exact body bytes** to `{B402_BASE_URL}/papi/v2/b402/{op}` with Tesla RSA headers. Returns Binance status + body unchanged (BAPI envelope intact). |

Unset B402 env → `503 { "error": "b402_not_configured" }`.

## Render env (owner fills — exact names)

| Env | Purpose |
|---|---|
| `B402_BASE_URL` | Authenticated Binance `{BASE_URL}` from partner onboarding (no trailing slash). Upstream path is `{B402_BASE_URL}/papi/v2/b402/{supported\|verify\|settle}`. |
| `B402_CLIENT_ID` | Partner `clientId` (Tesla header `X-Tesla-ClientId`) |
| `B402_ACCESS_TOKEN` | Partner `accessToken` (Tesla header `X-Tesla-SignAccessToken`) |
| `B402_RSA_PRIVATE_KEY` | PKCS#8 DER Base64 private key (one line). PEM (`-----BEGIN PRIVATE KEY-----`) also accepted. Generate with `node scripts/b402-keygen.js` on your machine only. |
| `GUARDIAN_KEY` | Already set — must match Vercel `X402_INTERNAL_KEY`. Auth for `/internal/b402/*` via header `x-guardian-key`. |

### Optional

| Env | Default | Purpose |
|---|---|---|
| `B402_SIG_ORDER` | `body_ts` | RSA payload order: `body_ts` = UTF-8 body + timestamp (Binance docs). Use `ts_body` if Binance support instructs timestamp-first. |

## RSA keygen (owner machine only)

```bash
node scripts/b402-keygen.js
```

- Submit **PUBLIC** (SPKI Base64 DER) on the Binance partner form.
- Set **PRIVATE** as Render env `B402_RSA_PRIVATE_KEY`.
- Never commit keys; never run keygen in CI or print the private key in deploy logs.

## Static outbound IPs (Binance form)

Docs: https://render.com/docs/dedicated-ips

1. Render Dashboard → workspace → **Networking → Dedicated IPs** → create set in the region of `cyre-fraud-prediction`.
2. Service page → **Connect → Outbound** → copy the three IPv4s into the Binance allowlist field.

Shared regional CIDRs can change; Dedicated IPs are the long-term allowlist.

## Activation sequence (same-day when credentials arrive)

1. Paste the four `B402_*` values into Render env (per-key only — never bulk-replace the whole env set).
2. Confirm `GUARDIAN_KEY` still matches Vercel `X402_INTERNAL_KEY`.
3. Smoke: `GET /internal/b402/health` with `x-guardian-key` → `{ "configured": true, ... }`.
4. Smoke: `POST /internal/b402/supported` with `x-guardian-key` → Binance JSON (not 503).
5. On Vercel: set `X402_PAY_TO_BSC` (treasury `0x…` on BSC) to arm the dormant Guardian lane. Optional: `X402_NETWORK_BSC`, `X402_ASSET_BSC`.

See Guardian `docs/B402-ENV.md` / `docs/B402-RESEARCH.md` for the Vercel side.
