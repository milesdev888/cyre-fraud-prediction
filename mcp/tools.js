// mcp/tools.js — Guardian MCP tool implementations (upstream via x-guardian-key, never pays)
const GUARDIAN_BASE = (process.env.GUARDIAN_BASE || 'https://cyre.dev').replace(/\/$/, '');
const VERSION = '1.0.0';

async function guardianGet(path) {
  const key = process.env.GUARDIAN_KEY || process.env.X402_INTERNAL_KEY || '';
  if (!key) {
    throw new Error('GUARDIAN_KEY (or X402_INTERNAL_KEY) is not set — MCP cannot call Guardian free');
  }
  const r = await fetch(GUARDIAN_BASE + path, {
    headers: {
      accept: 'application/json',
      'x-guardian-key': key,
      'user-agent': 'cyre-guardian-mcp/' + VERSION
    }
  });
  const text = await r.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (e) {
    throw new Error('Guardian returned non-JSON (' + r.status + '): ' + text.slice(0, 200));
  }
  if (!r.ok) {
    const msg = (data && (data.error || data.message)) || ('HTTP ' + r.status);
    throw new Error(String(msg));
  }
  return data;
}

async function gradeAddress(address) {
  const a = String(address || '').trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) {
    throw new Error('Invalid Solana address');
  }
  return guardianGet('/api/address?address=' + encodeURIComponent(a));
}

async function scanToken(mint) {
  const m = String(mint || '').trim();
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m)) {
    throw new Error('Invalid Solana mint address');
  }
  return guardianGet('/api/token?mint=' + encodeURIComponent(m));
}

async function batchGrade(addresses) {
  const list = Array.isArray(addresses) ? addresses : [];
  if (!list.length) throw new Error('addresses required');
  if (list.length > 25) throw new Error('max 25 addresses per batch_grade call');
  const out = [];
  for (const address of list) {
    try {
      const data = await gradeAddress(address);
      out.push({ address: String(address).trim(), ok: true, data });
    } catch (e) {
      out.push({ address: String(address).trim(), ok: false, error: e.message || String(e) });
    }
  }
  return { count: out.length, results: out };
}

const TOOL_NAMES = ['grade_address', 'scan_token', 'batch_grade'];

module.exports = {
  VERSION,
  TOOL_NAMES,
  gradeAddress,
  scanToken,
  batchGrade,
  guardianGet
};
