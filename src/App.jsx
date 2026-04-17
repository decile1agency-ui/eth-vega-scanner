import React, { useState, useEffect, useMemo } from 'react';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Area, AreaChart } from 'recharts';

// ============================================================================
// ETH OPTIONS VEGA SCALPING SCANNER
// Mock data layer — replace fetchBinanceOptions() with real Binance API calls
// Endpoint: GET https://eapi.binance.com/eapi/v1/mark
// ============================================================================

const SPOT = 3847.20;
const NOW = Date.now();

// ---- Mock generator: simulates what /eapi/v1/mark returns per contract ----
function generateMockChain() {
  const expiries = [
    { dte: 1, label: '1D' },
    { dte: 2, label: '2D' },
    { dte: 3, label: '3D' },
    { dte: 5, label: '5D' },
    { dte: 7, label: '7D' },
  ];
  const strikes = [3600, 3700, 3800, 3850, 3900, 4000, 4100];
  const rv7 = 52.4; // realized vol 7d annualized %
  const baseIV = 58;

  const contracts = [];
  expiries.forEach(({ dte, label }) => {
    strikes.forEach(strike => {
      ['C', 'P'].forEach(side => {
        // Term structure: front rich, smile around ATM
        const moneyness = Math.abs(strike - SPOT) / SPOT;
        const termAdj = dte <= 2 ? 8 : dte <= 5 ? 2 : -3;
        const skew = side === 'P' ? moneyness * 40 : moneyness * 25;
        const noise = (Math.random() - 0.5) * 6;
        const iv = baseIV + termAdj + skew + noise;

        // 30d IV stats (mocked)
        const iv30High = iv + 18 + Math.random() * 5;
        const iv30Low = iv - 22 + Math.random() * 4;
        const ivRank = ((iv - iv30Low) / (iv30High - iv30Low)) * 100;
        const ivPercentile = Math.min(100, Math.max(0, ivRank + (Math.random() - 0.5) * 15));

        const vrp = iv - rv7;
        const oi = Math.floor(50 + Math.random() * 800);
        const spread = 2 + Math.random() * 8; // bid-ask spread %
        const volume24h = Math.floor(Math.random() * 400);

        contracts.push({
          symbol: `ETH-${label}-${strike}-${side}`,
          strike, side, dte, expiry: label,
          iv: +iv.toFixed(2),
          rv7,
          vrp: +vrp.toFixed(2),
          ivRank: +ivRank.toFixed(1),
          ivPercentile: +ivPercentile.toFixed(1),
          iv30High: +iv30High.toFixed(2),
          iv30Low: +iv30Low.toFixed(2),
          oi, spread: +spread.toFixed(2), volume24h,
          delta: side === 'C'
            ? Math.max(0.05, Math.min(0.95, 0.5 + (SPOT - strike) / 200))
            : Math.min(-0.05, Math.max(-0.95, -0.5 + (SPOT - strike) / 200)),
          markPrice: +(Math.random() * 80 + 20).toFixed(2),
        });
      });
    });
  });

  return { contracts, rv7, spot: SPOT, ts: NOW };
}

// ---- Composite scoring ----
function scoreContract(c) {
  // SELL score: high IVR + high VRP + reasonable liquidity
  const sellScore =
    (c.ivRank / 100) * 40 +
    Math.max(0, Math.min(c.vrp / 25, 1)) * 35 +
    (c.spread < 5 ? 15 : c.spread < 8 ? 8 : 0) +
    (c.oi > 200 ? 10 : c.oi > 100 ? 5 : 0);

  // BUY score: low IVR + negative VRP + liquidity
  const buyScore =
    ((100 - c.ivRank) / 100) * 40 +
    Math.max(0, Math.min(-c.vrp / 10, 1)) * 35 +
    (c.spread < 5 ? 15 : c.spread < 8 ? 8 : 0) +
    (c.oi > 200 ? 10 : c.oi > 100 ? 5 : 0);

  return { sellScore: +sellScore.toFixed(1), buyScore: +buyScore.toFixed(1) };
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function VegaScanner() {
  const [data, setData] = useState(generateMockChain());
  const [tab, setTab] = useState('sell');
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setData(generateMockChain());
      setPulse(p => p + 1);
    }, 8000);
    return () => clearInterval(t);
  }, []);

  const scored = useMemo(() => {
    return data.contracts
      .map(c => ({ ...c, ...scoreContract(c) }))
      .filter(c => c.spread < 10 && c.oi > 50);
  }, [data]);

  const topSells = useMemo(
    () => [...scored].sort((a, b) => b.sellScore - a.sellScore).slice(0, 8),
    [scored]
  );
  const topBuys = useMemo(
    () => [...scored].sort((a, b) => b.buyScore - a.buyScore).slice(0, 8),
    [scored]
  );

  // Term structure: avg IV per DTE
  const termStructure = useMemo(() => {
    const byDte = {};
    scored.forEach(c => {
      if (Math.abs(c.delta) > 0.4 && Math.abs(c.delta) < 0.6) {
        if (!byDte[c.dte]) byDte[c.dte] = [];
        byDte[c.dte].push(c.iv);
      }
    });
    return Object.entries(byDte).map(([dte, ivs]) => ({
      dte: +dte,
      iv: +(ivs.reduce((a, b) => a + b, 0) / ivs.length).toFixed(2),
    })).sort((a, b) => a.dte - b.dte);
  }, [scored]);

  // Aggregate stats
  const stats = useMemo(() => {
    const atm = scored.filter(c => Math.abs(c.delta) > 0.45 && Math.abs(c.delta) < 0.55 && c.dte <= 3);
    const avgIV = atm.length ? atm.reduce((s, c) => s + c.iv, 0) / atm.length : 0;
    const avgVRP = atm.length ? atm.reduce((s, c) => s + c.vrp, 0) / atm.length : 0;
    const front = termStructure[0]?.iv || 0;
    const back = termStructure[termStructure.length - 1]?.iv || 0;
    const termSlope = front - back; // positive = backwardation
    return {
      avgIV: avgIV.toFixed(1),
      avgVRP: avgVRP.toFixed(1),
      termSlope: termSlope.toFixed(1),
      regime: termSlope > 4 ? 'BACKWARDATION' : termSlope < -2 ? 'CONTANGO' : 'FLAT',
      bias: avgVRP > 8 ? 'SELL VOL' : avgVRP < -2 ? 'BUY VOL' : 'NEUTRAL',
    };
  }, [scored, termStructure]);

  return (
    <div style={styles.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Major+Mono+Display&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        @keyframes blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0.3; } }
        @keyframes scan { 0% { transform: translateY(-100%); } 100% { transform: translateY(100vh); } }
        @keyframes flash { 0% { background: rgba(255,176,0,0.15); } 100% { background: transparent; } }
        .row-flash { animation: flash 1.2s ease-out; }
        .blink { animation: blink 1.5s infinite; }
        .scanline { position: fixed; left: 0; right: 0; height: 1px; background: linear-gradient(90deg, transparent, rgba(255,176,0,0.4), transparent); animation: scan 6s linear infinite; pointer-events: none; z-index: 1; }
        .row:hover { background: rgba(255,176,0,0.06) !important; }
        .grain { position: fixed; inset: 0; pointer-events: none; opacity: 0.04; mix-blend-mode: overlay; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' /%3E%3C/svg%3E"); }
      `}</style>
      <div className="grain" />
      <div className="scanline" />

      {/* HEADER */}
      <header style={styles.header}>
        <div>
          <div style={styles.brand}>VEGA·SCAN</div>
          <div style={styles.brandSub}>ETH OPTIONS / BINANCE / SHORT-DTE PREMIUM</div>
        </div>
        <div style={styles.headerStats}>
          <Stat label="ETH SPOT" value={`$${SPOT.toFixed(2)}`} />
          <Stat label="RV(7D)" value={`${data.rv7}%`} />
          <Stat label="ATM IV" value={`${stats.avgIV}%`} accent={+stats.avgIV > 60 ? 'red' : 'green'} />
          <Stat label="VRP" value={`${stats.avgVRP > 0 ? '+' : ''}${stats.avgVRP}`} accent={+stats.avgVRP > 5 ? 'red' : +stats.avgVRP < 0 ? 'green' : 'amber'} />
          <Stat label="TERM" value={stats.regime} accent={stats.regime === 'BACKWARDATION' ? 'red' : 'green'} small />
          <Stat label="BIAS" value={stats.bias} accent={stats.bias === 'SELL VOL' ? 'red' : stats.bias === 'BUY VOL' ? 'green' : 'amber'} small />
        </div>
        <div style={styles.live}>
          <span className="blink" style={styles.dot} />
          <span style={{ fontSize: 10, letterSpacing: 2 }}>LIVE · {new Date(data.ts).toLocaleTimeString()}</span>
        </div>
      </header>

      {/* MAIN GRID */}
      <main style={styles.main}>
        {/* LEFT COLUMN — RANKINGS */}
        <section style={styles.panel}>
          <div style={styles.panelHeader}>
            <div style={styles.panelTitle}>
              <span style={{ color: '#ffb000' }}>▸</span> SIGNAL RANK · 24-72H HOLDS
            </div>
            <div style={styles.tabs}>
              <button
                onClick={() => setTab('sell')}
                style={{ ...styles.tab, ...(tab === 'sell' ? styles.tabActive : {}), borderColor: tab === 'sell' ? '#ff3b3b' : 'transparent' }}
              >
                SELL VOL · {topSells.length}
              </button>
              <button
                onClick={() => setTab('buy')}
                style={{ ...styles.tab, ...(tab === 'buy' ? styles.tabActive : {}), borderColor: tab === 'buy' ? '#00ff9d' : 'transparent' }}
              >
                BUY VOL · {topBuys.length}
              </button>
            </div>
          </div>

          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr style={styles.thead}>
                  <th style={{ ...styles.th, textAlign: 'left' }}>SYMBOL</th>
                  <th style={styles.th}>DTE</th>
                  <th style={styles.th}>IV</th>
                  <th style={styles.th}>IVR</th>
                  <th style={styles.th}>VRP</th>
                  <th style={styles.th}>Δ</th>
                  <th style={styles.th}>OI</th>
                  <th style={styles.th}>SPRD</th>
                  <th style={{ ...styles.th, color: tab === 'sell' ? '#ff3b3b' : '#00ff9d' }}>SCORE</th>
                </tr>
              </thead>
              <tbody key={pulse}>
                {(tab === 'sell' ? topSells : topBuys).map((c, i) => {
                  const score = tab === 'sell' ? c.sellScore : c.buyScore;
                  const accent = tab === 'sell' ? '#ff3b3b' : '#00ff9d';
                  return (
                    <tr key={c.symbol} className="row row-flash" style={styles.tr}>
                      <td style={{ ...styles.td, color: '#fff', fontWeight: 500, textAlign: 'left' }}>
                        <span style={{ color: accent, marginRight: 6 }}>{String(i + 1).padStart(2, '0')}</span>
                        {c.symbol}
                      </td>
                      <td style={styles.td}>{c.dte}D</td>
                      <td style={styles.td}>{c.iv}%</td>
                      <td style={{ ...styles.td, color: c.ivRank > 70 ? '#ff3b3b' : c.ivRank < 25 ? '#00ff9d' : '#888' }}>
                        {c.ivRank}
                      </td>
                      <td style={{ ...styles.td, color: c.vrp > 10 ? '#ff3b3b' : c.vrp < 0 ? '#00ff9d' : '#888' }}>
                        {c.vrp > 0 ? '+' : ''}{c.vrp}
                      </td>
                      <td style={styles.td}>{c.delta.toFixed(2)}</td>
                      <td style={styles.td}>{c.oi}</td>
                      <td style={styles.td}>{c.spread}%</td>
                      <td style={{ ...styles.td, color: accent, fontWeight: 700, fontSize: 13 }}>
                        {score}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={styles.legend}>
            <span><span style={{ color: '#ff3b3b' }}>■</span> RICH</span>
            <span><span style={{ color: '#00ff9d' }}>■</span> CHEAP</span>
            <span style={{ marginLeft: 'auto', color: '#666' }}>FILTERS: SPRD&lt;10% · OI&gt;50</span>
          </div>
        </section>

        {/* RIGHT COLUMN — TERM STRUCTURE + RULES */}
        <aside style={styles.aside}>
          <div style={styles.panel}>
            <div style={styles.panelHeader}>
              <div style={styles.panelTitle}>
                <span style={{ color: '#ffb000' }}>▸</span> TERM STRUCTURE
              </div>
              <div style={{ fontSize: 10, color: stats.regime === 'BACKWARDATION' ? '#ff3b3b' : '#00ff9d', letterSpacing: 1.5 }}>
                {stats.regime}
              </div>
            </div>
            <div style={{ height: 180, padding: '12px 8px 8px' }}>
              <ResponsiveContainer>
                <AreaChart data={termStructure} margin={{ top: 8, right: 16, bottom: 0, left: -10 }}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#ffb000" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#ffb000" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="dte" tick={{ fill: '#666', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                    tickFormatter={v => `${v}D`} stroke="#222" />
                  <YAxis tick={{ fill: '#666', fontSize: 10, fontFamily: 'JetBrains Mono' }}
                    stroke="#222" tickFormatter={v => `${v}%`} domain={['dataMin - 2', 'dataMax + 2']} />
                  <Tooltip
                    contentStyle={{ background: '#0a0a0a', border: '1px solid #ffb000', fontFamily: 'JetBrains Mono', fontSize: 11 }}
                    labelStyle={{ color: '#ffb000' }}
                    itemStyle={{ color: '#fff' }}
                    formatter={v => [`${v}%`, 'IV']}
                    labelFormatter={l => `${l} DTE`}
                  />
                  <ReferenceLine y={data.rv7} stroke="#00ff9d" strokeDasharray="3 3"
                    label={{ value: `RV ${data.rv7}%`, fill: '#00ff9d', fontSize: 9, position: 'right' }} />
                  <Area type="monotone" dataKey="iv" stroke="#ffb000" strokeWidth={2} fill="url(#g1)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={styles.panel}>
            <div style={styles.panelHeader}>
              <div style={styles.panelTitle}>
                <span style={{ color: '#ffb000' }}>▸</span> EXECUTION RULES
              </div>
            </div>
            <div style={styles.rules}>
              <Rule num="01" label="ENTRY" text="SCORE ≥ 65 · CONFIRM IV > RV7" />
              <Rule num="02" label="SIZE" text="≤ 2% NAV PER LEG · NEVER 0DTE SHORT" />
              <Rule num="03" label="EXIT" text="IV ↓ 20% FROM ENTRY · OR 72H STOP" />
              <Rule num="04" label="HEDGE" text="DELTA-NEUTRALIZE IF |Δ| > 0.30" />
              <Rule num="05" label="VETO" text="NO EVENTS 24H · ETF · CPI · UNLOCKS" />
              <Rule num="06" label="FUNDING" text="SKIP IF |FUND| > 0.05% / 8H" />
            </div>
          </div>

          <div style={styles.panel}>
            <div style={styles.panelHeader}>
              <div style={styles.panelTitle}>
                <span style={{ color: '#ffb000' }}>▸</span> API HOOK
              </div>
            </div>
            <pre style={styles.code}>
{`GET eapi.binance.com
  /eapi/v1/mark
  ?symbol=ETH-*

→ markIV per contract
→ store 30D rolling
→ compute IVR, IVP
→ poll @ 60s
→ score & rank`}
            </pre>
          </div>
        </aside>
      </main>

      <footer style={styles.footer}>
        <span>VEGA·SCAN v0.1 · MOCK FEED · REPLACE generateMockChain() WITH BINANCE OPTIONS API</span>
        <span style={{ marginLeft: 'auto', color: '#444' }}>NOT FINANCIAL ADVICE</span>
      </footer>
    </div>
  );
}

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

function Stat({ label, value, accent, small }) {
  const colors = { red: '#ff3b3b', green: '#00ff9d', amber: '#ffb000' };
  const color = accent ? colors[accent] : '#fff';
  return (
    <div style={styles.stat}>
      <div style={styles.statLabel}>{label}</div>
      <div style={{ ...styles.statValue, color, fontSize: small ? 12 : 16 }}>{value}</div>
    </div>
  );
}

function Rule({ num, label, text }) {
  return (
    <div style={styles.rule}>
      <span style={styles.ruleNum}>{num}</span>
      <span style={styles.ruleLabel}>{label}</span>
      <span style={styles.ruleText}>{text}</span>
    </div>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = {
  root: {
    minHeight: '100vh',
    background: '#050505',
    color: '#d4d4d4',
    fontFamily: "'JetBrains Mono', monospace",
    backgroundImage: 'radial-gradient(circle at 20% 0%, rgba(255,176,0,0.04), transparent 50%), radial-gradient(circle at 80% 100%, rgba(255,59,59,0.03), transparent 50%)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 24px 16px',
    borderBottom: '1px solid #1a1a1a',
    gap: 24,
    flexWrap: 'wrap',
  },
  brand: {
    fontFamily: "'Major Mono Display', monospace",
    fontSize: 22,
    color: '#ffb000',
    letterSpacing: 4,
    lineHeight: 1,
  },
  brandSub: {
    fontSize: 9,
    color: '#666',
    letterSpacing: 3,
    marginTop: 6,
  },
  headerStats: {
    display: 'flex',
    gap: 28,
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  statLabel: {
    fontSize: 9,
    color: '#555',
    letterSpacing: 2,
  },
  statValue: {
    fontWeight: 700,
    letterSpacing: 0.5,
  },
  live: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: '#888',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#00ff9d',
    boxShadow: '0 0 8px #00ff9d',
  },
  main: {
    display: 'grid',
    gridTemplateColumns: '1fr 380px',
    gap: 16,
    padding: 16,
  },
  aside: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  panel: {
    background: 'linear-gradient(180deg, #0a0a0a, #060606)',
    border: '1px solid #1a1a1a',
    borderRadius: 2,
    overflow: 'hidden',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid #1a1a1a',
    background: 'rgba(255,176,0,0.02)',
  },
  panelTitle: {
    fontSize: 11,
    color: '#ddd',
    letterSpacing: 2,
    fontWeight: 500,
  },
  tabs: {
    display: 'flex',
    gap: 4,
  },
  tab: {
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 0,
    color: '#666',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    padding: '6px 12px',
    cursor: 'pointer',
    letterSpacing: 1.5,
    transition: 'all 0.2s',
  },
  tabActive: {
    color: '#fff',
    background: 'rgba(255,255,255,0.03)',
  },
  tableWrap: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 11,
  },
  thead: {
    background: '#0a0a0a',
  },
  th: {
    padding: '10px 8px',
    fontSize: 9,
    color: '#666',
    letterSpacing: 1.5,
    fontWeight: 500,
    textAlign: 'right',
    borderBottom: '1px solid #1a1a1a',
  },
  tr: {
    borderBottom: '1px solid #0d0d0d',
    transition: 'background 0.15s',
  },
  td: {
    padding: '10px 8px',
    color: '#aaa',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
  },
  legend: {
    display: 'flex',
    gap: 16,
    padding: '10px 16px',
    fontSize: 10,
    color: '#888',
    borderTop: '1px solid #1a1a1a',
    background: '#080808',
  },
  rules: {
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  rule: {
    display: 'grid',
    gridTemplateColumns: '32px 70px 1fr',
    gap: 8,
    alignItems: 'center',
    padding: '8px 10px',
    background: '#080808',
    fontSize: 10,
    borderLeft: '2px solid #ffb000',
  },
  ruleNum: {
    color: '#ffb000',
    fontWeight: 700,
  },
  ruleLabel: {
    color: '#888',
    letterSpacing: 1.5,
  },
  ruleText: {
    color: '#ddd',
    letterSpacing: 0.5,
  },
  code: {
    margin: 0,
    padding: 16,
    fontSize: 10,
    color: '#888',
    background: '#080808',
    fontFamily: "'JetBrains Mono', monospace",
    lineHeight: 1.6,
  },
  footer: {
    display: 'flex',
    padding: '12px 24px',
    borderTop: '1px solid #1a1a1a',
    fontSize: 9,
    color: '#555',
    letterSpacing: 2,
  },
};
