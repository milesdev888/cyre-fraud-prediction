// CYRE Guardian — CDP wallet provisioning (Bazaar payTo)
// Runs once at server startup. Safe no-op unless all CDP env vars are set.
// getOrCreateAccount is idempotent: restarts reuse the same wallet, never duplicate it.

const REQUIRED = ['CDP_API_KEY_ID', 'CDP_API_KEY_SECRET', 'CDP_WALLET_SECRET'];

module.exports = async function ensureGuardianWallet() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    console.log('[cdp-wallet] skipped — missing env:', missing.join(', '));
    return null;
  }
  try {
    const { CdpClient } = require('@coinbase/cdp-sdk');
    const cdp = new CdpClient();
    const account = await cdp.evm.getOrCreateAccount({ name: 'guardian-treasury' });
    console.log('========================================');
    console.log('[cdp-wallet] GUARDIAN TREASURY (Base payTo)');
    console.log('[cdp-wallet] address:', account.address);
    console.log('========================================');
    return account.address;
  } catch (err) {
    console.error('[cdp-wallet] failed:', err.message);
    return null;
  }
};
