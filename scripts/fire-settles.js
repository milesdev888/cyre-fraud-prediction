// scripts/fire-settles.js — one-shot mainnet settles for Guardian bazaar + Agent Trinity routes.
// Called from x402-payer when X402_FIRE_SETTLES=1. Reuses CdpX402Client + @x402/core/http.
// Remove the env flag after a successful run so restarts do not re-pay.
// Optional: X402_FIRE_ROUTES=/api/bazaar,/api/caution,... — fire only those paths (listed order).

const TAG = '[fire-settles]';