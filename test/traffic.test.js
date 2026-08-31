const {
  TrafficTally,
  normalizeUa,
  utcDay,
  emptyBucket,
  bucketForDigest,
  UA_CAP
} = require('../lib/traffic');

function mockReq(overrides = {}) {
  return {
    method: 'GET',
    path: '/mcp/health',
    url: '/mcp/health',
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides
  };
}

function mockRes(statusCode = 200) {
  const res = {
    statusCode,
    on(event, fn) {
      if (event === 'finish') res._finish = fn;
    }
  };
  return res;
}

function finish(res) {
  if (res._finish) res._finish();
}

describe('normalizeUa', () => {
  test('trims, cuts at (, lowercases, caps 60', () => {
    expect(normalizeUa('  Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120  ')).toBe('mozilla/5.0');
    expect(normalizeUa('')).toBe('(empty)');
    expect(normalizeUa('A'.repeat(80))).toHaveLength(60);
  });
});

describe('TrafficTally signals', () => {
  let tally;

  beforeEach(async () => {
    process.env.GUARDIAN_KEY = 'test-key';
    tally = new TrafficTally();
    await tally.init();
  });

  afterEach(() => {
    delete process.env.GUARDIAN_KEY;
  });

  test('paid_200 vs bypass_200 on POST /mcp', () => {
    const paidReq = mockReq({ method: 'POST', path: '/mcp' });
    const paidRes = mockRes(200);
    tally.onRequestStart(paidReq);
    tally.onResponseFinish(paidReq, paidRes);

    const bypassReq = mockReq({
      method: 'POST',
      path: '/mcp',
      headers: { 'x-guardian-key': 'test-key' }
    });
    const bypassRes = mockRes(200);
    tally.onRequestStart(bypassReq);
    tally.onResponseFinish(bypassReq, bypassRes);

    const bucket = tally.getBucket(utcDay());
    expect(bucket.signals.paid_200).toBe(1);
    expect(bucket.signals.bypass_200).toBe(1);
  });

  test('payment_attempts when PAYMENT-SIGNATURE present', () => {
    const req = mockReq({
      method: 'POST',
      path: '/mcp',
      headers: { 'payment-signature': 'abc' }
    });
    tally.onRequestStart(req);
    expect(tally.getBucket(utcDay()).signals.payment_attempts).toBe(1);
  });

  test('retry_after_402 within 60s window', () => {
    const ip = '10.0.0.1';
    const first = mockReq({ method: 'POST', path: '/mcp', headers: { 'x-forwarded-for': ip } });
    const res402 = mockRes(402);
    tally.onRequestStart(first);
    tally.onResponseFinish(first, res402);

    const retry = mockReq({ method: 'POST', path: '/mcp', headers: { 'x-forwarded-for': ip } });
    tally.onRequestStart(retry);
    expect(tally.getBucket(utcDay()).signals.retry_after_402).toBe(1);
  });

  test('UA map caps at 300 + (other)', () => {
    const bucket = tally.getBucket(utcDay());
    for (let i = 0; i < UA_CAP + 5; i++) {
      tally.recordUa(bucket, `ua-${i}`, `UA-${i}`, { wasNewUa: true, uaIpCount: 1 });
    }
    expect(Object.keys(bucket.ua).length).toBeLessThanOrEqual(UA_CAP + 1);
    expect(bucket.ua['(other)']).toBeTruthy();
  });

  test('digest is single-line valid JSON', () => {
    const req = mockReq({ path: '/mcp' });
    tally.onRequestStart(req);
    tally.onResponseFinish(req, mockRes(402));
    const line = `GUARDIAN_TRAFFIC_DIGEST ${JSON.stringify(tally.buildDigest(14))}`;
    expect(line.split('\n').length).toBe(1);
    const parsed = JSON.parse(line.replace('GUARDIAN_TRAFFIC_DIGEST ', ''));
    expect(parsed.days.length).toBeGreaterThanOrEqual(1);
    expect(parsed.days[0].signal_samples).toBeUndefined();
  });

  test('prunes buckets older than 35 days', () => {
    tally.buckets.set('2020-01-01', emptyBucket('2020-01-01'));
    tally.buckets.set(utcDay(), emptyBucket(utcDay()));
    tally.pruneOldBuckets();
    expect(tally.buckets.has('2020-01-01')).toBe(false);
    expect(tally.buckets.has(utcDay())).toBe(true);
  });

  test('UTC day buckets are separate', () => {
    tally.getBucket('2026-08-29').requests = 5;
    tally.getBucket('2026-08-30').requests = 7;
    expect(tally.getBucket('2026-08-29').requests).toBe(5);
    expect(tally.getBucket('2026-08-30').requests).toBe(7);
  });

  test('ingest merges external source separately', () => {
    const ok = tally.mergeIngest('cyre.dev', utcDay(), {
      ...emptyBucket(utcDay()),
      requests: 10,
      signals: { payment_attempts: 2, paid_200: 0, retry_after_402: 0, bypass_200: 0 }
    });
    expect(ok).toBe(true);
    expect(tally.sources.get('cyre.dev').get(utcDay()).requests).toBe(10);
    expect(tally.getBucket(utcDay()).requests).toBe(0);
  });
});

describe('bucketForDigest', () => {
  test('trims ua to top 25 and drops signal_samples', () => {
    const b = emptyBucket('2026-08-30');
    for (let i = 0; i < 30; i++) {
      b.ua[`ua${i}`] = { n: i, first: 'x', last: 'x', ips: 1 };
    }
    b.signal_samples.push({ ts: 'x' });
    const d = bucketForDigest(b);
    expect(Object.keys(d.ua).length).toBe(25);
    expect(d.signal_samples).toBeUndefined();
  });
});
