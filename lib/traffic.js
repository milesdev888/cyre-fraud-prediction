// lib/traffic.js — Guardian in-process daily traffic tally (UTC buckets)
const fs = require('fs');
const path = require('path');

const RETAIN_DAYS = 35;
const DIGEST_DAYS = 14;
const UA_CAP = 300;
const LRU_402_MAX = 500;
const SIGNAL_SAMPLE_CAP = 20;
const SIGNAL_LOG_CAP = 50;
const REDIS_TTL_SEC = 40 * 24 * 3600;
const PERSIST_DEBOUNCE_MS = 60_000;
const RETRY_WINDOW_MS = 60_000;

function utcDay(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function normalizeUa(raw) {
  let s = String(raw || '').trim();
  if (!s) return '(empty)';
  const cut = s.search(/[(;]/);
  if (cut > 0) s = s.slice(0, cut);
  s = s.trim().toLowerCase();
  if (s.length > 60) s = s.slice(0, 60);
  return s || '(empty)';
}

function emptyBucket(day) {
  return {
    day,
    requests: 0,
    by_status: {},
    by_method: {},
    by_path: {},
    ua: {},
    unique_ips: 0,
    signals: {
      payment_attempts: 0,
      paid_200: 0,
      retry_after_402: 0,
      bypass_200: 0
    },
    signal_samples: [],
    errors: 0
  };
}

function inc(map, key, delta = 1) {
  if (!map) return;
  map[key] = (map[key] || 0) + delta;
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function guardianKey() {
  return process.env.GUARDIAN_KEY || process.env.X402_INTERNAL_KEY || '';
}

function hasBypassKey(req) {
  const key = guardianKey();
  return Boolean(key && req.headers['x-guardian-key'] === key);
}

function hasPaymentHeader(req) {
  return Boolean(req.headers['payment-signature'] || req.headers['x-payment']);
}

function topUaEntries(uaMap, limit = 25) {
  return Object.fromEntries(
    Object.entries(uaMap || {})
      .sort((a, b) => (b[1].n || 0) - (a[1].n || 0))
      .slice(0, limit)
  );
}

function bucketForDigest(bucket) {
  if (!bucket) return null;
  const out = { ...bucket, ua: topUaEntries(bucket.ua, 25) };
  delete out.signal_samples;
  return out;
}

class TrafficTally {
  constructor() {
    this.buckets = new Map();
    this.sources = new Map();
    this.dayIpSets = new Map();
    this.uaIpSets = new Map();
    this.lru402 = new Map();
    this.lru402Order = [];
    this.signalLogsToday = 0;
    this.signalLogDay = utcDay();
    this.storeMode = 'memory';
    this.redis = null;
    this.trafficFile = null;
    this.persistTimer = null;
    this.digestTimer = null;
    this.bootDigestTimer = null;
    this.started = false;
  }

  resolveStoreMode() {
    const pref = (process.env.TRAFFIC_STORE || '').toLowerCase();
    if (pref === 'file' || process.env.TRAFFIC_FILE) return 'file';
    if (pref === 'redis' || process.env.REDIS_URL) return 'redis';
    return 'memory';
  }

  async init() {
    this.storeMode = this.resolveStoreMode();
    if (this.storeMode === 'redis' && process.env.REDIS_URL) {
      try {
        const { createClient } = require('redis');
        this.redis = createClient({ url: process.env.REDIS_URL });
        this.redis.on('error', () => {});
        await this.redis.connect();
      } catch (e) {
        console.log(`GUARDIAN_TRAFFIC redis unavailable (${e.message}), falling back to memory`);
        this.storeMode = 'memory';
        this.redis = null;
      }
    } else if (this.storeMode === 'redis') {
      this.storeMode = 'memory';
    }

    if (this.storeMode === 'file') {
      this.trafficFile = process.env.TRAFFIC_FILE || path.join(process.cwd(), 'data', 'traffic.json');
      await this.loadFromFile();
    } else if (this.storeMode === 'redis') {
      await this.loadFromRedis();
    }

    this.pruneOldBuckets();
    console.log(`GUARDIAN_TRAFFIC store=${this.storeMode}${this.storeMode === 'memory' ? ' (history resets on deploy)' : ''}`);
  }

  pruneOldBuckets() {
    const cutoff = utcDay(new Date(Date.now() - RETAIN_DAYS * 86400000));
    for (const day of [...this.buckets.keys()]) {
      if (day < cutoff) {
        this.buckets.delete(day);
        this.dayIpSets.delete(day);
        for (const k of [...this.uaIpSets.keys()]) {
          if (k.startsWith(day + ':')) this.uaIpSets.delete(k);
        }
      }
    }
    for (const [src, days] of this.sources) {
      for (const day of [...days.keys()]) {
        if (day < cutoff) days.delete(day);
      }
      if (!days.size) this.sources.delete(src);
    }
  }

  async loadFromFile() {
    try {
      const raw = await fs.promises.readFile(this.trafficFile, 'utf8');
      this.mergePersisted(JSON.parse(raw));
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('GUARDIAN_TRAFFIC file load error', e.message);
    }
  }

  async loadFromRedis() {
    if (!this.redis) return;
    const keys = await this.redis.keys('guardian:traffic:*');
    for (const key of keys) {
      const rest = key.slice('guardian:traffic:'.length);
      if (rest.includes(':')) continue;
      try {
        const raw = await this.redis.get(key);
        if (raw) this.buckets.set(rest, JSON.parse(raw));
      } catch (_) { /* skip corrupt */ }
    }
    const srcKeys = await this.redis.keys('guardian:traffic:source:*');
    for (const key of srcKeys) {
      const rest = key.slice('guardian:traffic:source:'.length);
      const idx = rest.lastIndexOf(':');
      if (idx < 0) continue;
      const src = rest.slice(0, idx);
      const day = rest.slice(idx + 1);
      try {
        const raw = await this.redis.get(key);
        if (!raw) continue;
        if (!this.sources.has(src)) this.sources.set(src, new Map());
        this.sources.get(src).set(day, JSON.parse(raw));
      } catch (_) { /* skip */ }
    }
  }

  mergePersisted(data) {
    if (!data || typeof data !== 'object') return;
    for (const [day, bucket] of Object.entries(data.buckets || {})) {
      if (bucket && bucket.day) this.buckets.set(day, bucket);
    }
    for (const [src, days] of Object.entries(data.sources || {})) {
      const m = new Map();
      for (const [day, bucket] of Object.entries(days || {})) {
        if (bucket && bucket.day) m.set(day, bucket);
      }
      if (m.size) this.sources.set(src, m);
    }
  }

  serializeForFile() {
    const buckets = {};
    for (const [day, b] of this.buckets) buckets[day] = b;
    const sources = {};
    for (const [src, days] of this.sources) {
      sources[src] = {};
      for (const [day, b] of days) sources[src][day] = b;
    }
    return { buckets, sources };
  }

  async persistNow() {
    if (this.storeMode === 'file' && this.trafficFile) {
      const dir = path.dirname(this.trafficFile);
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = this.trafficFile + '.tmp';
      await fs.promises.writeFile(tmp, JSON.stringify(this.serializeForFile()));
      await fs.promises.rename(tmp, this.trafficFile);
    } else if (this.storeMode === 'redis' && this.redis) {
      const today = utcDay();
      const bucket = this.buckets.get(today);
      if (bucket) {
        await this.redis.setEx(`guardian:traffic:${today}`, REDIS_TTL_SEC, JSON.stringify(bucket));
      }
      for (const [src, days] of this.sources) {
        const b = days.get(today);
        if (b) {
          await this.redis.setEx(`guardian:traffic:source:${src}:${today}`, REDIS_TTL_SEC, JSON.stringify(b));
        }
      }
    }
  }

  schedulePersist() {
    if (this.storeMode === 'memory') return;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow().catch((e) => console.error('GUARDIAN_TRAFFIC persist error', e.message));
    }, PERSIST_DEBOUNCE_MS);
  }

  touchIpSets(day, uaNorm, ip) {
    if (!this.dayIpSets.has(day)) this.dayIpSets.set(day, new Set());
    const daySet = this.dayIpSets.get(day);
    const wasNewDay = !daySet.has(ip);
    if (wasNewDay) daySet.add(ip);

    const uaKey = `${day}:${uaNorm}`;
    if (!this.uaIpSets.has(uaKey)) this.uaIpSets.set(uaKey, new Set());
    const uaSet = this.uaIpSets.get(uaKey);
    const wasNewUa = !uaSet.has(ip);
    if (wasNewUa) uaSet.add(ip);

    return { wasNewDay, wasNewUa, dayIpCount: daySet.size, uaIpCount: uaSet.size };
  }

  touchLru402(ip, at) {
    if (this.lru402.has(ip)) {
      const i = this.lru402Order.indexOf(ip);
      if (i >= 0) this.lru402Order.splice(i, 1);
    } else if (this.lru402Order.length >= LRU_402_MAX) {
      const old = this.lru402Order.shift();
      this.lru402.delete(old);
    }
    this.lru402.set(ip, at);
    this.lru402Order.push(ip);
  }

  getBucket(day) {
    if (!this.buckets.has(day)) this.buckets.set(day, emptyBucket(day));
    return this.buckets.get(day);
  }

  recordUa(bucket, uaNorm, uaRaw, ipInfo) {
    const ua = bucket.ua;
    let key = uaNorm;
    const keys = Object.keys(ua);
    if (!ua[key] && keys.length >= UA_CAP) key = '(other)';
    if (!ua[key]) {
      ua[key] = { n: 0, first: new Date().toISOString(), last: new Date().toISOString(), ips: 0 };
    }
    const entry = ua[key];
    entry.n += 1;
    entry.last = new Date().toISOString();
    if (ipInfo.wasNewUa) entry.ips = ipInfo.uaIpCount;
  }

  maybeSignalSample(bucket, sample) {
    if (bucket.signal_samples.length >= SIGNAL_SAMPLE_CAP) return;
    bucket.signal_samples.push(sample);
  }

  logSignal(kind, sample) {
    const day = utcDay();
    if (day !== this.signalLogDay) {
      this.signalLogDay = day;
      this.signalLogsToday = 0;
    }
    if (this.signalLogsToday >= SIGNAL_LOG_CAP) return;
    this.signalLogsToday += 1;
    console.log(`GUARDIAN_TRAFFIC_SIGNAL ${JSON.stringify({ kind, ...sample })}`);
  }

  onRequestStart(req) {
    const day = utcDay();
    const bucket = this.getBucket(day);
    const method = (req.method || 'GET').toUpperCase();
    const reqPath = (req.path || req.url || '/').split('?')[0] || '/';
    const uaRaw = req.headers['user-agent'] || '';
    const uaNorm = normalizeUa(uaRaw);
    const ip = clientIp(req);
    const ipInfo = this.touchIpSets(day, uaNorm, ip);
    const isBypass = hasBypassKey(req);

    bucket.requests += 1;
    inc(bucket.by_method, method);
    inc(bucket.by_path, reqPath);
    bucket.unique_ips = ipInfo.dayIpCount;
    this.recordUa(bucket, uaNorm, uaRaw, ipInfo);

    if (hasPaymentHeader(req)) {
      bucket.signals.payment_attempts += 1;
      this.maybeSignalSample(bucket, {
        ts: new Date().toISOString(),
        kind: 'payment_attempt',
        ua_raw: uaRaw,
        path: reqPath,
        status: null,
        has_payment_header: true
      });
      this.logSignal('payment_attempt', { path: reqPath, ua: uaNorm });
    }

    if (method === 'POST' && reqPath === '/mcp') {
      const last402 = this.lru402.get(ip);
      if (last402 && Date.now() - last402 < RETRY_WINDOW_MS) {
        bucket.signals.retry_after_402 += 1;
        this.maybeSignalSample(bucket, {
          ts: new Date().toISOString(),
          kind: 'retry_after_402',
          ua_raw: uaRaw,
          path: reqPath,
          status: null,
          has_payment_header: hasPaymentHeader(req)
        });
        this.logSignal('retry_after_402', { path: reqPath, ua: uaNorm });
      }
    }

    req._traffic = { day, reqPath, method, uaRaw, uaNorm, ip, isBypass };
    this.schedulePersist();
  }

  onResponseFinish(req, res) {
    const meta = req._traffic;
    if (!meta) return;
    const bucket = this.getBucket(meta.day);
    const status = String(res.statusCode || 0);
    inc(bucket.by_status, status);

    if (meta.method === 'POST' && meta.reqPath === '/mcp') {
      if (status === '402') {
        this.touchLru402(meta.ip, Date.now());
      } else if (status === '200') {
        if (meta.isBypass) {
          bucket.signals.bypass_200 += 1;
        } else {
          bucket.signals.paid_200 += 1;
          this.maybeSignalSample(bucket, {
            ts: new Date().toISOString(),
            kind: 'paid_200',
            ua_raw: meta.uaRaw,
            path: meta.reqPath,
            status: 200,
            has_payment_header: hasPaymentHeader(req)
          });
          this.logSignal('paid_200', { path: meta.reqPath, ua: meta.uaNorm });
        }
      }
    }

    this.schedulePersist();
  }

  middleware() {
    return (req, res, next) => {
      try {
        this.onRequestStart(req);
        res.on('finish', () => {
          try {
            this.onResponseFinish(req, res);
          } catch (_) {
            this.countError();
          }
        });
      } catch (_) {
        this.countError();
      }
      next();
    };
  }

  countError() {
    try {
      const bucket = this.getBucket(utcDay());
      bucket.errors = (bucket.errors || 0) + 1;
    } catch (_) { /* swallow */ }
  }

  sortedDays(maxDays) {
    return [...this.buckets.keys()].sort().slice(-maxDays);
  }

  buildDigest(maxDays = DIGEST_DAYS) {
    const days = this.sortedDays(maxDays).map((d) => bucketForDigest(this.buckets.get(d))).filter(Boolean);
    return { generated: new Date().toISOString(), store: this.storeMode, days };
  }

  printDigest() {
    console.log(`GUARDIAN_TRAFFIC_DIGEST ${JSON.stringify(this.buildDigest(DIGEST_DAYS))}`);
  }

  msUntilNextUtc(hour, minute) {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0));
    if (now >= next) next.setUTCDate(next.getUTCDate() + 1);
    return next.getTime() - now.getTime();
  }

  scheduleDigest() {
    if (this.bootDigestTimer) clearTimeout(this.bootDigestTimer);
    if (this.digestTimer) clearTimeout(this.digestTimer);

    this.bootDigestTimer = setTimeout(() => {
      this.printDigest();
      const scheduleNext = () => {
        this.digestTimer = setTimeout(() => {
          this.printDigest();
          scheduleNext();
        }, this.msUntilNextUtc(0, 5));
      };
      scheduleNext();
    }, 30_000);
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.scheduleDigest();
    const onTerm = () => {
      this.shutdown().finally(() => process.exit(0));
    };
    process.once('SIGTERM', onTerm);
  }

  async shutdown() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    if (this.bootDigestTimer) clearTimeout(this.bootDigestTimer);
    if (this.digestTimer) clearTimeout(this.digestTimer);
    try {
      await this.persistNow();
    } catch (_) { /* swallow */ }
    if (this.redis) {
      try { await this.redis.quit(); } catch (_) { /* swallow */ }
    }
  }

  getTrafficResponse(days, format) {
    const n = Math.min(Math.max(1, days || DIGEST_DAYS), RETAIN_DAYS);
    const dayList = this.sortedDays(n);
    const payload = {
      generated: new Date().toISOString(),
      store: this.storeMode,
      days: dayList.map((d) => this.buckets.get(d)).filter(Boolean),
      sources: {}
    };
    for (const [src, map] of this.sources) {
      payload.sources[src] = {};
      for (const d of dayList) {
        if (map.has(d)) payload.sources[src][d] = map.get(d);
      }
    }

    if (format === 'text') {
      const lines = dayList.map((d) => {
        const b = this.buckets.get(d);
        if (!b) return `${d} (no data)`;
        const uas = Object.keys(b.ua || {}).length;
        const s402 = b.by_status?.['402'] || 0;
        return `${d} requests=${b.requests} unique_uas=${uas} unique_ips=${b.unique_ips} 402s=${s402} paid_200=${b.signals.paid_200} payment_attempts=${b.signals.payment_attempts}`;
      });
      return { contentType: 'text/plain; charset=utf-8', body: lines.join('\n') + (lines.length ? '\n' : '') };
    }

    return { contentType: 'application/json; charset=utf-8', body: JSON.stringify(payload) };
  }

  mergeIngest(source, day, bucket) {
    if (!source || !day || !bucket || typeof bucket !== 'object') return false;
    if (!this.sources.has(source)) this.sources.set(source, new Map());
    const map = this.sources.get(source);
    const existing = map.get(day);
    if (!existing) {
      map.set(day, { ...emptyBucket(day), ...bucket, day });
    } else {
      existing.requests = (existing.requests || 0) + (bucket.requests || 0);
      for (const [k, v] of Object.entries(bucket.by_status || {})) inc(existing.by_status, k, v);
      for (const [k, v] of Object.entries(bucket.by_method || {})) inc(existing.by_method, k, v);
      for (const [k, v] of Object.entries(bucket.by_path || {})) inc(existing.by_path, k, v);
      for (const sig of ['payment_attempts', 'paid_200', 'retry_after_402', 'bypass_200']) {
        existing.signals[sig] = (existing.signals[sig] || 0) + (bucket.signals?.[sig] || 0);
      }
    }
    this.schedulePersist();
    return true;
  }

  mountRoutes(app) {
    app.get('/mcp/traffic', (req, res) => {
      if (!hasBypassKey(req)) return res.status(401).json({ error: 'Unauthorized' });
      const days = parseInt(req.query.days, 10) || DIGEST_DAYS;
      const format = req.query.format === 'text' ? 'text' : 'json';
      const out = this.getTrafficResponse(days, format);
      res.setHeader('Content-Type', out.contentType);
      res.status(200).send(out.body);
    });

    app.post('/mcp/traffic/ingest', (req, res) => {
      if (!hasBypassKey(req)) return res.status(401).json({ error: 'Unauthorized' });
      const raw = JSON.stringify(req.body || {});
      if (raw.length > 64 * 1024) return res.status(413).json({ error: 'Payload too large' });
      const { source, day, bucket } = req.body || {};
      if (!this.mergeIngest(source, day, bucket)) return res.status(400).json({ error: 'Invalid ingest payload' });
      res.json({ ok: true, source, day });
    });
  }
}

let singleton = null;

async function createTrafficTally() {
  if (!singleton) {
    singleton = new TrafficTally();
    await singleton.init();
  }
  return singleton;
}

function getTrafficTallySync() {
  return singleton;
}

module.exports = {
  createTrafficTally,
  getTrafficTallySync,
  TrafficTally,
  normalizeUa,
  utcDay,
  emptyBucket,
  topUaEntries,
  bucketForDigest,
  hasBypassKey,
  DIGEST_DAYS,
  RETAIN_DAYS,
  UA_CAP
};
