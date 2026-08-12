import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  AlertTriangle,
  Clock,
  BarChart3,
  ChevronRight,
  Check,
  Minus,
  Loader2
} from 'lucide-react';

const API_URL =
  process.env.REACT_APP_API_URL || 'https://cyre-fraud-prediction.onrender.com';

const T = {
  ink: '#06070a',
  panel: '#0d1017',
  panel2: '#12161f',
  line: '#1c2230',
  text: '#e8ecf3',
  muted: '#8892a4',
  gold: '#d9b36c',
  cyan: '#4fe3d0',
  low: '#3ddc84',
  medium: '#e8b04b',
  high: '#ff6b6b'
};

const RISK_COLOR = { LOW: T.low, MEDIUM: T.medium, HIGH: T.high };

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
.fp-root{background:${T.ink};color:${T.text};font-family:Inter,system-ui,sans-serif;min-height:100vh}
.fp-display{font-family:Sora,Inter,sans-serif;letter-spacing:-.02em}
.fp-mono{font-family:'IBM Plex Mono',ui-monospace,monospace}
.fp-panel{background:${T.panel};border:1px solid ${T.line};border-radius:14px}
.fp-eyebrow{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:${T.muted}}
.fp-input{background:${T.panel2};border:1px solid ${T.line};border-radius:10px;color:${T.text};
  font-size:15px;padding:12px 14px;width:100%;outline:none;transition:border-color .15s}
.fp-input:focus{border-color:${T.cyan}}
.fp-btn{background:${T.cyan};color:#04231f;font-weight:600;font-size:15px;border:none;
  border-radius:10px;padding:14px;width:100%;cursor:pointer;transition:opacity .15s}
.fp-btn:disabled{opacity:.5;cursor:default}
.fp-tab{font-size:13px;font-weight:500;color:${T.muted};padding:12px 4px;border-bottom:2px solid transparent;
  background:none;border-left:0;border-right:0;border-top:0;cursor:pointer;white-space:nowrap}
.fp-tab[data-on="true"]{color:${T.text};border-bottom-color:${T.gold}}
.fp-row{border-bottom:1px solid rgba(28,34,48,.7)}
.fp-row:last-child{border-bottom:none}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

function money(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function clock(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return '—';
  }
}

/* ------------------------------------------------------------------ */
/* Signature element: the score arc. Bands are drawn at the same       */
/* thresholds the API uses, so the visual and the logic can't drift.   */
/* ------------------------------------------------------------------ */

function ScoreArc({ score, riskLevel }) {
  const size = 176;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = Math.PI * r; // half circle
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = RISK_COLOR[riskLevel] || T.muted;

  return (
    <div style={{ position: 'relative', width: size, height: size / 2 + 28 }}>
      <svg width={size} height={size / 2 + 8} viewBox={`0 0 ${size} ${size / 2 + 8}`}>
        <path
          d={`M ${stroke / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${size / 2}`}
          fill="none"
          stroke={T.line}
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={`M ${stroke / 2} ${size / 2} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${size / 2}`}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          style={{ transition: 'stroke-dasharray .6s cubic-bezier(.4,0,.2,1)' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingBottom: 2
        }}
      >
        <div className="fp-display" style={{ fontSize: 44, fontWeight: 800, lineHeight: 1, color }}>
          {score}
        </div>
        <div className="fp-eyebrow" style={{ marginTop: 6 }}>
          risk score
        </div>
      </div>
    </div>
  );
}

function SignalRow({ signal }) {
  return (
    <div
      className="fp-row"
      style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '12px 0' }}
    >
      <div style={{ marginTop: 2, flexShrink: 0 }}>
        {signal.triggered ? (
          <AlertTriangle size={15} color={T.gold} />
        ) : (
          <Check size={15} color={T.muted} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 500,
            color: signal.triggered ? T.text : T.muted
          }}
        >
          {signal.name}
        </div>
        <div style={{ fontSize: 12.5, color: T.muted, marginTop: 3, lineHeight: 1.45 }}>
          {signal.detail}
        </div>
      </div>
      <div
        className="fp-mono"
        style={{
          fontSize: 13,
          color: signal.triggered ? T.gold : T.muted,
          flexShrink: 0,
          paddingTop: 1
        }}
      >
        {signal.points > 0 ? `+${signal.points}` : <Minus size={13} />}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label className="fp-eyebrow" style={{ display: 'block', marginBottom: 7 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: T.muted, fontSize: 13.5 }}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */

export default function FraudPredictionDashboard() {
  const [tab, setTab] = useState('analyze');

  const [form, setForm] = useState({
    amount: '250',
    merchantCategory: 'retail',
    location: 'US',
    deviceType: 'mobile',
    userId: 'demo-user'
  });

  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [alerts, setAlerts] = useState([]);
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState(null);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const analyze = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${API_URL}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: Number(form.amount) })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `Request failed (${r.status})`);
      setResult(d.data);
    } catch (e) {
      setError(
        e.message === 'Failed to fetch'
          ? 'Could not reach the API. If this is the first request in a while, the server may be waking up — try again.'
          : e.message
      );
    } finally {
      setLoading(false);
    }
  };

  const loadTab = useCallback(async () => {
    try {
      if (tab === 'alerts') {
        const d = await (await fetch(`${API_URL}/api/alerts`)).json();
        setAlerts(d.data || []);
      } else if (tab === 'stats') {
        const d = await (await fetch(`${API_URL}/api/statistics`)).json();
        setStats(d.data || null);
      } else if (tab === 'history') {
        const d = await (
          await fetch(`${API_URL}/api/user/${encodeURIComponent(form.userId)}/history`)
        ).json();
        setHistory(d || null);
      }
    } catch (e) {
      /* leave prior state; the panel shows its empty message */
    }
  }, [tab, form.userId]);

  useEffect(() => {
    loadTab();
  }, [loadTab]);

  const TABS = [
    { id: 'analyze', label: 'Analyze', icon: Activity },
    { id: 'alerts', label: 'Alerts', icon: AlertTriangle },
    { id: 'history', label: 'History', icon: Clock },
    { id: 'stats', label: 'Statistics', icon: BarChart3 }
  ];

  return (
    <div className="fp-root">
      <style>{CSS}</style>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 18px 64px' }}>
        {/* Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '22px 0 18px',
            borderBottom: `1px solid ${T.line}`
          }}
        >
          <div>
            <div className="fp-display" style={{ fontSize: 17, fontWeight: 700 }}>
              CY<span style={{ color: T.gold }}>R</span>E · Fraud Prediction
            </div>
            <div className="fp-eyebrow" style={{ marginTop: 5 }}>
              rules-based risk scoring
            </div>
          </div>
          <div
            className="fp-mono"
            style={{ fontSize: 10.5, color: T.muted, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span
              style={{ width: 5, height: 5, borderRadius: '50%', background: T.low, display: 'block' }}
            />
            8 rules active
          </div>
        </header>

        {/* Tabs */}
        <nav style={{ display: 'flex', gap: 22, borderBottom: `1px solid ${T.line}`, overflowX: 'auto' }}>
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                className="fp-tab"
                data-on={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                  <Icon size={14} />
                  {t.label}
                </span>
              </button>
            );
          })}
        </nav>

        {/* ---------------- Analyze ---------------- */}
        {tab === 'analyze' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1fr)',
              gap: 18,
              marginTop: 22
            }}
          >
            <div className="fp-panel" style={{ padding: 20 }}>
              <div className="fp-display" style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>
                Transaction
              </div>

              <Field label="Amount (USD)">
                <input
                  className="fp-input fp-mono"
                  type="number"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={set('amount')}
                />
              </Field>

              <Field label="Merchant category">
                <select className="fp-input" value={form.merchantCategory} onChange={set('merchantCategory')}>
                  <option value="retail">retail</option>
                  <option value="grocery">grocery</option>
                  <option value="travel">travel</option>
                  <option value="electronics">electronics</option>
                  <option value="jewelry">jewelry</option>
                  <option value="gambling">gambling</option>
                  <option value="crypto">crypto</option>
                  <option value="gift-cards">gift-cards</option>
                  <option value="wire-transfer">wire-transfer</option>
                </select>
              </Field>

              <Field label="Location">
                <select className="fp-input" value={form.location} onChange={set('location')}>
                  {['US', 'CA', 'GB', 'DE', 'PH', 'BR', 'NG', 'RU'].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Device">
                <select className="fp-input" value={form.deviceType} onChange={set('deviceType')}>
                  <option value="mobile">mobile</option>
                  <option value="desktop">desktop</option>
                  <option value="tablet">tablet</option>
                </select>
              </Field>

              <Field label="User ID">
                <input className="fp-input fp-mono" value={form.userId} onChange={set('userId')} />
              </Field>

              <button className="fp-btn" onClick={analyze} disabled={loading}>
                {loading ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Loader2 size={15} className="fp-spin" /> Analyzing
                  </span>
                ) : (
                  'Analyze transaction'
                )}
              </button>

              {error && (
                <div
                  style={{
                    marginTop: 14,
                    fontSize: 13,
                    color: T.high,
                    lineHeight: 1.5,
                    background: 'rgba(255,107,107,.07)',
                    border: '1px solid rgba(255,107,107,.25)',
                    borderRadius: 10,
                    padding: '11px 13px'
                  }}
                >
                  {error}
                </div>
              )}
            </div>

            {/* Result */}
            <div className="fp-panel" style={{ padding: 20 }}>
              {!result ? (
                <Empty>
                  Submit a transaction to see its score and the rules behind it.
                </Empty>
              ) : (
                <>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      paddingBottom: 18,
                      borderBottom: `1px solid ${T.line}`
                    }}
                  >
                    <ScoreArc score={result.fraudScore} riskLevel={result.riskLevel} />
                    <div
                      className="fp-mono"
                      style={{
                        marginTop: 10,
                        fontSize: 12,
                        letterSpacing: '.14em',
                        color: RISK_COLOR[result.riskLevel],
                        border: `1px solid ${RISK_COLOR[result.riskLevel]}44`,
                        borderRadius: 99,
                        padding: '5px 14px'
                      }}
                    >
                      {result.riskLevel} RISK
                    </div>
                    <div
                      style={{
                        fontSize: 13.5,
                        color: T.text,
                        marginTop: 14,
                        textAlign: 'center',
                        lineHeight: 1.5,
                        maxWidth: 340
                      }}
                    >
                      {result.recommendation}
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '14px 0',
                      borderBottom: `1px solid ${T.line}`
                    }}
                  >
                    <div className="fp-eyebrow">
                      {result.signalsTriggered} of {result.signalsEvaluated} rules fired
                    </div>
                    <div className="fp-eyebrow">
                      baseline: {result.baselineTransactions} txn
                    </div>
                  </div>

                  <div style={{ marginTop: 6 }}>
                    {(result.signals || []).map((s) => (
                      <SignalRow key={s.id} signal={s} />
                    ))}
                  </div>

                  <div
                    className="fp-mono"
                    style={{ fontSize: 10.5, color: T.muted, marginTop: 16, lineHeight: 1.6 }}
                  >
                    {result.transactionId}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ---------------- Alerts ---------------- */}
        {tab === 'alerts' && (
          <div className="fp-panel" style={{ marginTop: 22, padding: 20 }}>
            <div className="fp-display" style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
              High-risk transactions
            </div>
            <div style={{ fontSize: 12.5, color: T.muted, marginBottom: 10 }}>
              Scored at or above 70.
            </div>

            {!alerts.length ? (
              <Empty>No high-risk transactions yet.</Empty>
            ) : (
              alerts.map((a) => (
                <div
                  key={a.transactionId}
                  className="fp-row"
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0' }}
                >
                  <div
                    className="fp-mono fp-display"
                    style={{ fontSize: 20, fontWeight: 700, color: T.high, width: 44 }}
                  >
                    {a.fraudScore}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>
                      {money(a.amount)} · {a.merchant}
                    </div>
                    <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                      {a.userId} · {a.location} · {a.deviceId} · {clock(a.analyzedAt)}
                    </div>
                  </div>
                  <ChevronRight size={15} color={T.muted} />
                </div>
              ))
            )}
          </div>
        )}

        {/* ---------------- History ---------------- */}
        {tab === 'history' && (
          <div className="fp-panel" style={{ marginTop: 22, padding: 20 }}>
            <div className="fp-display" style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>
              {form.userId}
            </div>

            {!history || !history.stats || !history.stats.totalTransactions ? (
              <Empty>No transactions recorded for this user yet.</Empty>
            ) : (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 26, marginBottom: 20 }}>
                  <div>
                    <div className="fp-eyebrow">transactions</div>
                    <div className="fp-mono fp-display" style={{ fontSize: 24, fontWeight: 700, marginTop: 5 }}>
                      {history.stats.totalTransactions}
                    </div>
                  </div>
                  <div>
                    <div className="fp-eyebrow">median amount</div>
                    <div className="fp-mono fp-display" style={{ fontSize: 24, fontWeight: 700, marginTop: 5 }}>
                      {money(history.stats.medianAmount)}
                    </div>
                  </div>
                  <div>
                    <div className="fp-eyebrow">avg score</div>
                    <div className="fp-mono fp-display" style={{ fontSize: 24, fontWeight: 700, marginTop: 5 }}>
                      {history.stats.averageFraudScore ?? '—'}
                    </div>
                  </div>
                </div>

                <div style={{ fontSize: 12.5, color: T.muted, marginBottom: 16, lineHeight: 1.6 }}>
                  Known locations: {(history.stats.knownLocations || []).join(', ') || '—'}
                  <br />
                  Known devices: {(history.stats.knownDevices || []).join(', ') || '—'}
                </div>

                {(history.recentTransactions || []).map((t) => (
                  <div
                    key={t.transactionId}
                    className="fp-row"
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}
                  >
                    <div
                      className="fp-mono"
                      style={{ fontSize: 15, fontWeight: 600, color: RISK_COLOR[t.riskLevel], width: 34 }}
                    >
                      {t.fraudScore}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5 }}>
                        {money(t.amount)} · {t.merchant}
                      </div>
                      <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>
                        {t.location} · {t.deviceId} · {clock(t.analyzedAt)}
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ---------------- Statistics ---------------- */}
        {tab === 'stats' && (
          <div className="fp-panel" style={{ marginTop: 22, padding: 20 }}>
            <div className="fp-display" style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>
              Platform
            </div>

            {!stats || !stats.totalAnalyzed ? (
              <Empty>Nothing analysed yet.</Empty>
            ) : (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 26, marginBottom: 22 }}>
                  <div>
                    <div className="fp-eyebrow">analysed</div>
                    <div className="fp-mono fp-display" style={{ fontSize: 26, fontWeight: 700, marginTop: 5 }}>
                      {stats.totalAnalyzed}
                    </div>
                  </div>
                  <div>
                    <div className="fp-eyebrow">flagged high</div>
                    <div
                      className="fp-mono fp-display"
                      style={{ fontSize: 26, fontWeight: 700, marginTop: 5, color: T.high }}
                    >
                      {stats.flaggedTransactions}
                    </div>
                  </div>
                  <div>
                    <div className="fp-eyebrow">avg score</div>
                    <div className="fp-mono fp-display" style={{ fontSize: 26, fontWeight: 700, marginTop: 5 }}>
                      {stats.averageFraudScore ?? '—'}
                    </div>
                  </div>
                  <div>
                    <div className="fp-eyebrow">users</div>
                    <div className="fp-mono fp-display" style={{ fontSize: 26, fontWeight: 700, marginTop: 5 }}>
                      {stats.uniqueUsers}
                    </div>
                  </div>
                </div>

                <div className="fp-eyebrow" style={{ marginBottom: 10 }}>
                  rule trigger frequency
                </div>
                {Object.entries(stats.signalFrequency || {}).map(([name, count]) => {
                  const pct = stats.totalAnalyzed ? (count / stats.totalAnalyzed) * 100 : 0;
                  return (
                    <div key={name} style={{ marginBottom: 11 }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 13,
                          marginBottom: 5
                        }}
                      >
                        <span>{name}</span>
                        <span className="fp-mono" style={{ color: T.muted }}>
                          {count}
                        </span>
                      </div>
                      <div style={{ height: 4, background: T.panel2, borderRadius: 2 }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${pct}%`,
                            background: T.gold,
                            borderRadius: 2,
                            transition: 'width .5s'
                          }}
                        />
                      </div>
                    </div>
                  );
                })}

                {stats.note && (
                  <div
                    style={{
                      marginTop: 20,
                      fontSize: 11.5,
                      color: T.muted,
                      lineHeight: 1.6,
                      borderTop: `1px solid ${T.line}`,
                      paddingTop: 14
                    }}
                  >
                    {stats.note}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
