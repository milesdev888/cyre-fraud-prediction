#!/usr/bin/env node
// scripts/check-bazaar.js — is Guardian indexed yet?
// Queries CDP x402 discovery (by payTo) and agentic.market (by keyword).
// No secrets needed. Node 18+ (global fetch).
//
//   node scripts/check-bazaar.js
//   PAYTO=0x... KEYWORD=cyre node scripts/check-bazaar.js

const PAYTO = process.env.PAYTO || '0x9Ff25C4acf1DcDDf15fD2702C127A285f1dFa712';
const KEYWORD = process.env.KEYWORD || 'cyre';
const RESOURCE = 'https://cyre.dev/api/address';

const CDP = `https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources?payTo=${PAYTO}`;
const AM = `https://api.agentic.market/search?q=${encodeURIComponent(KEYWORD)}`;

const norm = (s) => String(s || '').toLowerCase();
const hit = (r) =>
  norm(r.resource || r.url || r.resourceUrl).includes('cyre.dev') ||
  norm(r.payTo || (r.accepts || [])[0]?.payTo) === norm(PAYTO) ||
  norm(JSON.stringify(r)).includes(norm(KEYWORD));

// Try several shapes: {items:[]}, {resources:[]}, {results:[]}, [] …
function extract(json) {
  if (Array.isArray(json)) return json;
  for (const k of ['items', 'resources', 'results', 'data', 'services']) {
    if (Array.isArray(json?.[k])) return json[k];
    if (Array.isArray(json?.[k]?.items)) return json[k].items;
  }
  return [];
}

async function probe(name, url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const list = json ? extract(json) : [];
    const matches = list.filter(hit);
    console.log(`\n[${name}] HTTP ${res.status} in ${Date.now() - t0}ms — ${list.length} total, ${matches.length} matching`);
    for (const m of matches) {
      console.log('  •', m.resource || m.url || m.resourceUrl || m.name || JSON.stringify(m).slice(0, 120));
    }
    if (!json) console.log('  (non-JSON body)', text.slice(0, 200).replace(/\s+/g, ' '));
    else if (!list.length) console.log('  keys:', Object.keys(json).join(', ') || '(empty)');
    return matches.length;
  } catch (e) {
    console.log(`\n[${name}] ERROR ${e.message}`);
    return 0;
  }
}

(async () => {
  console.log(`Guardian indexing check — ${new Date().toISOString()}`);
  console.log(`resource ${RESOURCE}\npayTo    ${PAYTO}`);
  const a = await probe('CDP discovery', CDP);
  const b = await probe('agentic.market', AM);
  console.log(`\n${a || b ? '✅ INDEXED' : '⏳ not indexed yet'} (cdp=${a}, agentic=${b})`);
  process.exit(0);
})();
