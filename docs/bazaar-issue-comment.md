# Draft comment for x402-foundation/x402#2112 — DO NOT POST YET

> Adding another data point. Full v2 + discovery-extension setup, two mainnet settles through the CDP facilitator, still not indexed.
>
> **Resource:** `https://cyre.dev/api/address` (GET, `?address=<base58>`)
> **Protocol:** x402 v2 — `PAYMENT-REQUIRED` header + JSON body, `accepts[].amount`, CAIP-2 network ids
> **Facilitator:** `https://api.cdp.coinbase.com/platform/v2/x402` (JWT auth, verify + settle both return `success: true`)
> **Lane:** `eip155:8453`, USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, amount `5000`, `extra: {name:"USD Coin", version:"2"}`
> **payTo:** `0x9Ff25C4acf1DcDDf15fD2702C127A285f1dFa712` — provisioned inside CDP via the Server Wallet SDK (`getOrCreateAccount`), **not** an external EOA, per the theory in this thread
> **Discovery:** `extensions.bazaar` is present on every 402 (`info.input` type/method/queryParams, `info.output` type/example, JSON schema) and the client echoed it back in the payment payload (`extensions: bazaar, builder-code`). Client is `CdpX402Client` from `@coinbase/cdp-sdk/x402`.
>
> **Settled mainnet transactions:**
> - `0x01b761fa9daa661bbf1cd34cfe32d245fb5aae0287d483bb360cff30dc389bb5` (2026-08-28 ~19:56 UTC)
> - `0x6cd0a39068f9ecd0de70eacd091958b3f3e687dca166c295fc45f57a6d709fd6` (2026-08-28 ~20:25 UTC)
>
> Both returned `200` with `PAYMENT-RESPONSE`. **Neither settle returned an `EXTENSION-RESPONSES` header**, so there's no `bazaar.status` to inspect — same silence others report here.
>
> As of [TIME], `GET /platform/v2/x402/discovery/resources?payTo=0x9Ff2…dFa712` returns 0 results and agentic.market has no entry for `cyre`.
>
> The 402 is publicly curlable if it helps anyone at Coinbase repro:
> `curl -i "https://cyre.dev/api/address?address=9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"`
>
> Happy to add anything else that's useful.

---

**Before posting:** fill in `[TIME]`, re-run `scripts/check-bazaar.js`, and wait ~24h from the second settle (2026-08-29 ~20:25 UTC) in case cataloging is just slow. Payer address (if asked): `0x1A4b94a7a5dFff004f3Fc456F78f9670Cb7A450D`.
