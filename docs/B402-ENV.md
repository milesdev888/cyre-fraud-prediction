# B402 relay environment (`cyre-fraud-prediction` on Render)

Binance B402 requires a **static egress IP** and **RSA-signed** facilitator calls. Vercel has no fixed IP, so the BSC x402 lane on `cyre.dev` calls Binance **through** this Render service at `POST /internal/b402/{supported|verify|settle}`.

Vercel holds **no** B402 secrets. Render holds all four variables below.

**Canonical env table + activation runbook:** [`docs/B402-RELAY.md`](./B402-RELAY.md).

## Render env vars

| Variable | Description |
|----------|-------------|
| `B402_BASE_URL` | Binance-issued API base (sandbox and production differ; no trailing slash) |
| `B402_CLIENT_ID` | Issued `clientId` from partner onboarding |
| `B402_ACCESS_TOKEN` | Issued sign access token |
| `B402_RSA_PRIVATE_KEY` | **Base64 PKCS#8 DER** (one line). PEM (`-----BEGIN PRIVATE KEY-----`) also accepted if the value starts with `-----BEGIN` |

Optional:

| Variable | Default | Description |
|----------|---------|-------------|
| `B402_SIG_ORDER` | `body_ts` | RSA payload order: `body_ts` = UTF-8 body + timestamp (per Binance docs). Use `ts_body` if Binance support instructs timestamp-first. |
| `GUARDIAN_KEY` | — | Must match Vercel `X402_INTERNAL_KEY`; required for relay auth |

Until all four required B402 vars are set, the relay returns **503** `{"error":"b402_not_configured"}` — safe to deploy before Binance issues credentials.

## Key format

Generate locally (owner machine only — **do not commit**):

```bash
node scripts/b402-keygen.js
# or:
openssl genrsa -out b402.pem 1024
openssl pkcs8 -topk8 -nocrypt -in b402.pem -outform DER | base64 -w0
```

Submit the **public** key (DER Base64) to Binance during onboarding. Whitelist this Render service’s **outbound IP**.

## Owner sequence

1. Set the four `B402_*` vars on Render (`cyre-fraud-prediction`) — per-key only, never bulk-replace.
2. On Vercel (`cyre-guardian-`):
   - `X402_FACILITATOR_BSC=https://cyre-fraud-prediction.onrender.com/internal/b402` (optional; this is the default)
   - `X402_PAY_TO_BSC=<BSC treasury 0x…>` (arms the dormant BSC lane already on Guardian `main`)
   - `X402_INTERNAL_KEY` = same value as Render `GUARDIAN_KEY`
3. Smoke: `GET …/internal/b402/health` with `x-guardian-key` → `{ "configured": true, … }`.
4. Smoke: `POST …/internal/b402/supported` with `x-guardian-key` → Binance JSON (not 503).

## Vercel reference

See `-Cyre-Guardian` `docs/B402-ENV.md` / `docs/B402-RESEARCH.md` for Tesla header signing, wire shape, and BSC asset decimals.
