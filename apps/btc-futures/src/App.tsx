import React, { useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ScatterChart, Scatter, ZAxis } from 'recharts';
import { BinanceFuturesClient, NormalizedKline } from './lib/binanceClient';
import './index.css';

const client = new BinanceFuturesClient({ useProxy: true, proxyUrl: '/.netlify/functions/binance' });

const THRESH = { prefundingDriftPct: 0.003, prefundingWindowMin: 25, basisAnnualizedPct: 12, rangeBreakFundingAbsMax: 0.0005, squeezeMinMovePct5m: 0.003 } as const;
const LOOKBACKS = { seasonalityDays: 30, fundingForwardHours: 8, oiRegimeLimit: 500 } as const;

function useCountdown(targetMs?: number) { const [now, setNow] = useState<number>(() => Date.now()); useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []); if (!targetMs) return '—'; const ms = Math.max(0, targetMs - now); const s = Math.floor(ms / 1000); const hh = Math.floor(s / 3600).toString().padStart(2, '0'); const mm = Math.floor((s % 3600) / 60).toString().padStart(2, '0'); const ss = Math.floor(s % 60).toString().padStart(2, '0'); return `${hh}:${mm}:${ss}`; }

type SeasonalityRow = { hour: string; avgAbsRet: number };
type FundingPoint = { fundingTime: number; fundingPct: number; fwd8hPct?: number };
type BasisRow = { label: string; basisPct: number };
type RegimeCount = { label: string; count: number; hint: string };

async function fetchSeasonalityHours(days = LOOKBACKS.seasonalityDays): Promise<SeasonalityRow[]> { const buckets: Record<number, { sum: number; n: number }> = {}; const dayMs = 24*60*60*1000; for (let d = 0; d < days; d++) { const end = Date.now() - d*dayMs; const start = end - dayMs; const kl = await client.getKlines('BTCUSDT', '1m', { startTime: start, endTime: end }, 'usdt'); for (const k of kl) { const ret = (k.close - k.open) / (k.open || 1); const absr = Math.abs(ret); const hour = new Date(k.openTime).getUTCHours(); if (!buckets[hour]) buckets[hour] = { sum: 0, n: 0 }; buckets[hour].sum += absr; buckets[hour].n += 1; } } const out: SeasonalityRow[] = []; for (let h = 0; h < 24; h++) { const b = buckets[h] || { sum: 0, n: 1 }; out.push({ hour: h.toString().padStart(2, '0'), avgAbsRet: (b.sum / b.n) * 100 }); } return out; }

async function fetchFundingVsForward(hoursForward = LOOKBACKS.fundingForwardHours): Promise<FundingPoint[]> { const fr = await client.getFundingHistory('BTCUSDT', { limit: 200 }, 'usdt'); const end = Date.now() + hoursForward * 60 * 60 * 1000; const start = Date.now() - 60 * 24 * 60 * 60 * 1000; const kl = await client.getKlines('BTCUSDT', '1h', { startTime: start, endTime: end }, 'usdt'); const byTime = new Map<number, NormalizedKline>(); for (const k of kl) byTime.set(k.openTime, k); const times = Array.from(byTime.keys()).sort((a,b)=>a-b); function nearestIndex(t: number) { let lo = 0, hi = times.length - 1, ans = times.length - 1; while (lo <= hi) { const mid = (lo + hi) >> 1; if (times[mid] >= t) { ans = mid; hi = mid - 1; } else { lo = mid + 1; } } return ans; } const out: FundingPoint[] = []; for (const f of fr) { const idx = nearestIndex(f.fundingTime); const t0 = times[idx]; const tN = times[idx + hoursForward]; const k0 = byTime.get(t0); const kN = byTime.get(tN); const fundingPct = Number(f.fundingRate) * 100; const fwd8hPct = (k0 && kN) ? ((kN.close - k0.close) / k0.close) * 100 : undefined; out.push({ fundingTime: f.fundingTime, fundingPct, fwd8hPct }); } return out; }

async function fetchBasisBars(): Promise<BasisRow[]> { const deliveries = await client.listDeliveryContracts('BTCUSD'); const top = deliveries.slice(0, 3); const perp = await client.getMarkPrice('BTCUSDT', 'usdt'); const S = Number(perp.markPrice); const rows: BasisRow[] = []; for (const c of top) { const md = await client.getMarkPrice(c.symbol, 'coin'); const F = Number(md.markPrice); const days = Math.max(1, Math.ceil((c.deliveryDate - Date.now()) / (1000*60*60*24))); const annualized = ((F - S) / S) * (365 / days) * 100; rows.push({ label: `${c.symbol.slice(-8)} (${days}d)`, basisPct: annualized }); } return rows; }

async function fetchRegimeCounts(limit: number): Promise<RegimeCount[]> { const period: '1h' = '1h'; const [oi, kl] = await Promise.all([ client.getOpenInterestHist('BTCUSDT', period, limit), client.getKlines('BTCUSDT', '1h', { limit: limit + 1 }, 'usdt'), ]); const map = new Map<number, number>(); for (const r of oi) map.set(r.timestamp, r.sumOpenInterest); let upUp=0, upDn=0, dnUp=0, dnDn=0; for (let i = 1; i < kl.length; i++) { const prev = kl[i-1], cur = kl[i]; const pr = (cur.close - prev.close) / prev.close; const oiNow = map.get(cur.openTime); const oiPrev = map.get(prev.openTime); if (oiNow === undefined || oiPrev === undefined) continue; const dOI = oiNow - oiPrev; if (pr >= 0 && dOI >= 0) upUp++; else if (pr >= 0 && dOI < 0) upDn++; else if (pr < 0 && dOI >= 0) dnUp++; else dnDn++; } return [ { label: '↑Price + ↑OI', count: upUp, hint: 'Trend w/ new longs' }, { label: '↑Price + ↓OI', count: upDn, hint: 'Short squeeze' }, { label: '↓Price + ↑OI', count: dnUp, hint: 'New shorts / longs trapped' }, { label: '↓Price + ↓OI', count: dnDn, hint: 'Long liquidation' }, ]; }

function Panel({ title, children }: { title: string; children: any }) { return (<div className="rounded-2xl p-4 bg-neutral-800/60 shadow"><div className="text-sm opacity-70 mb-2">{title}</div>{children}</div>); }

async function sendTelegram(text: string) { try { await fetch('/.netlify/functions/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }); } catch {} }

export default function App() {
  const STORAGE_KEY = 'btcFuturesSettings.v1';
  const loadInitial = () => {
    try {
      if (typeof localStorage === 'undefined') return { thresh: THRESH, lookbacks: LOOKBACKS };
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { thresh: THRESH, lookbacks: LOOKBACKS };
      const parsed = JSON.parse(raw) || {};
      return { thresh: { ...THRESH, ...(parsed.thresh || {}) }, lookbacks: { ...LOOKBACKS, ...(parsed.lookbacks || {}) } };
    } catch { return { thresh: THRESH, lookbacks: LOOKBACKS }; }
  };

  const [active, setActive] = useState<'live'|'patterns'|'signals'|'tools'>('live');
  const TARGET = 600; const MAX_LOSS = -600;

  const [mark, setMark] = useState<number>();
  const [fr, setFr] = useState<number>();
  const [nextFunding, setNextFunding] = useState<number>();
  const [klines, setKlines] = useState<NormalizedKline[]>([]);
  const [interval, setIntervalStr] = useState<string>('1m');
  const [deliveries, setDeliveries] = useState<Array<{ symbol: string; deliveryDate: number; mark?: number; annualizedBasis?: number }>>([]);

  const [risk, setRisk] = useState<number>(200);
  const [stopPct, setStopPct] = useState<number>(0.0015);
  const [priceInput, setPriceInput] = useState<number | ''>('');
  const px = priceInput || mark || 0;
  const sizeBTC = useMemo(() => (px>0 && stopPct>0 ? (risk / (px * stopPct)) : 0), [px, risk, stopPct]);

  const [dailyPnl, setDailyPnl] = useState<number>(0);
  const locked = dailyPnl >= TARGET || dailyPnl <= MAX_LOSS;
  const [alertsOn, setAlertsOn] = useState<boolean>(false);

  const [thresh, setThresh] = useState(loadInitial().thresh);
  const [lookbacks, setLookbacks] = useState(loadInitial().lookbacks);

  useEffect(() => { try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify({ thresh, lookbacks })); } catch {} }, [thresh, lookbacks]);

  useEffect(() => {
    if (active !== 'live' && active !== 'signals') return;
    const sub = client.subscribeMarkPrice('BTCUSDT', 'usdt', { onMessage: (d) => { setMark(d.markPrice); setFr(d.fundingRate); setNextFunding(d.nextFundingTime); }, onError: () => {}, autoReconnect: true, intervalSec: 1 });
    return () => sub.close();
  }, [active, lookbacks]);

  useEffect(() => { if (active !== 'live') return; client.getKlines('BTCUSDT', interval, { limit: 200 }, 'usdt').then(setKlines).catch(() => {}); }, [interval, active]);

  useEffect(() => { if (active !== 'live') return; (async () => { try { const all = await client.listDeliveryContracts('BTCUSD'); const top3 = all.slice(0, 3); const perp = (await client.getMarkPrice('BTCUSDT', 'usdt')).markPrice; const S = Number(perp); const enriched = await Promise.all(top3.map(async (c) => { const md = await client.getMarkPrice(c.symbol, 'coin'); const F = Number(md.markPrice); const days = Math.max(1, Math.ceil((c.deliveryDate - Date.now()) / (1000*60*60*24))); const annualized = ((F - S) / S) * (365 / days) * 100; return { symbol: c.symbol, deliveryDate: c.deliveryDate, mark: F, annualizedBasis: annualized }; })); setDeliveries(enriched); } catch {} })(); }, [active]);

  const last = klines[klines.length - 1];

  const [seasonality, setSeasonality] = useState<SeasonalityRow[] | null>(null);
  const [fundingPts, setFundingPts] = useState<FundingPoint[] | null>(null);
  const [basisBars, setBasisBars] = useState<BasisRow[] | null>(null);
  const [regimes, setRegimes] = useState<RegimeCount[] | null>(null);
  useEffect(() => { if (active !== 'patterns') return; (async () => { const [s, f, b, r] = await Promise.all([ fetchSeasonalityHours(lookbacks.seasonalityDays), fetchFundingVsForward(lookbacks.fundingForwardHours), fetchBasisBars(), fetchRegimeCounts(lookbacks.oiRegimeLimit), ]); setSeasonality(s); setFundingPts(f); setBasisBars(b); setRegimes(r); })().catch(() => {}); }, [active, lookbacks]);

  const [signals, setSignals] = useState<{ id: string; title: string; detail: string; ok: boolean }[]>([]);
  useEffect(() => { if (active !== 'signals') return; (async () => { try {
    let pf = { ok:false, detail:'—' };
    if (nextFunding) { const minsTo = Math.round((nextFunding - Date.now())/60000); const kl = await client.getKlines('BTCUSDT','1m',{ limit: 20 },'usdt'); if (kl.length>15) { const p0 = kl[kl.length-16].close; const p1 = kl[kl.length-1].close; const drift = (p1-p0)/p0; const oi5 = await client.getOpenInterestHist('BTCUSDT','5m',4); const oiDelta = oi5.length>=2 ? (oi5[oi5.length-1].sumOpenInterest - oi5[0].sumOpenInterest) : 0; pf.ok = minsTo>=0 && minsTo<=thresh.prefundingWindowMin && Math.abs(drift) >= thresh.prefundingDriftPct && (oiDelta <= 0); pf.detail = `in ${minsTo}m, drift ${(drift*100).toFixed(2)}% over 15m, ΔOI ${oiDelta.toFixed(0)}`; } }

    let eb = { ok:false, detail:'—' }; try { const bb = await fetchBasisBars(); const top = bb[0]; if (top) { eb.ok = Math.abs(top.basisPct) >= thresh.basisAnnualizedPct; eb.detail = `${top.label}: ${(top.basisPct).toFixed(2)}%`; } } catch {}

    let rb = { ok:false, detail:'—' }; try { const kl5 = await client.getKlines('BTCUSDT','5m',{ limit: 12 },'usdt'); const highs = kl5.slice(0,-1).map(k=>k.high); const lastK = kl5[kl5.length-1]; const maxPrev = Math.max(...highs); const priceBreak = lastK.high > maxPrev; const oi = await client.getOpenInterestHist('BTCUSDT','5m',13); const dOI = oi.length>=2 ? (oi[oi.length-1].sumOpenInterest - oi[oi.length-2].sumOpenInterest) : 0; const fundLim = Math.abs(fr ?? 0) <= thresh.rangeBreakFundingAbsMax; rb.ok = priceBreak && dOI>0 && fundLim; rb.detail = `${priceBreak? 'High break':''} ${dOI>0? 'with ↑OI':''} | FR ${((fr??0)*100).toFixed(4)}%`.trim() || '—'; } catch {}

    let sq = { ok:false, detail:'—' }; try { const kl5 = await client.getKlines('BTCUSDT','5m',{ limit: 2 },'usdt'); if (kl5.length===2) { const prev = kl5[0], cur = kl5[1]; const pr = (cur.close - prev.close)/prev.close; const oi = await client.getOpenInterestHist('BTCUSDT','5m',2); const dOI = oi.length===2 ? (oi[1].sumOpenInterest - oi[0].sumOpenInterest) : 0; sq.ok = pr>thresh.squeezeMinMovePct5m && dOI<0; sq.detail = `ΔP ${(pr*100).toFixed(2)}% | ΔOI ${dOI.toFixed(0)}`; } } catch {}

    const list = [ { id:'prefund', title:'Pre‑Funding Drift (fade setup)', ...pf }, { id:'basis', title:'Elevated Basis (spread)', ...eb }, { id:'break', title:'Range Break + ↑OI', ...rb }, { id:'squeeze', title:'Short Squeeze (↑P, ↓OI)', ...sq } ]; setSignals(list);
    if (alertsOn && !(dailyPnl >= TARGET || dailyPnl <= MAX_LOSS)) { for (const s of list) if (s.ok) await sendTelegram(`⚡ ${s.title}: ${s.detail}`); }
  } catch {} })(); }, [active, nextFunding, alertsOn, dailyPnl, fr, thresh]);

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 p-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-3xl" style={{ fontFamily: 'Creepster, system-ui' }}>BTC Futures</h1>
        <nav className="flex gap-2 text-sm">
          {(['live','patterns','signals','tools'] as const).map(tab => (
            <button key={tab} onClick={()=>setActive(tab)} className={`px-3 py-1.5 rounded-full border ${active===tab? 'bg-neutral-100 text-neutral-900 border-neutral-100':'border-neutral-700 bg-neutral-800 text-neutral-100'}`}>{tab.toUpperCase()}</button>
          ))}
        </nav>
      </header>

      {active === 'live' && (
        <div className="grid md:grid-cols-3 gap-4">
          <Panel title="Mark Price (BTCUSDT)">
            <div className="text-4xl font-semibold tracking-tight">{mark ? mark.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</div>
            <div className="mt-3 text-sm opacity-80">Funding: {fr !== undefined ? (fr * 100).toFixed(4) + '%' : '—'}</div>
            <div className="text-sm opacity-80">Next funding in: {useCountdown(nextFunding)}</div>
          </Panel>

          <Panel title="Latest Candle">
            {last ? (
              <div className="mt-2 text-sm">
                <div>Open: {last.open.toLocaleString()}</div>
                <div>High: {last.high.toLocaleString()}</div>
                <div>Low: {last.low.toLocaleString()}</div>
                <div>Close: {last.close.toLocaleString()}</div>
                <div className="opacity-70 mt-1">{new Date(last.closeTime).toLocaleString()}</div>
              </div>
            ) : '—'}
          </Panel>

          <Panel title="Nearest Deliveries (COIN-M)">
            <div className="space-y-3">
              {deliveries.map((d) => (
                <div key={d.symbol} className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{d.symbol}</div>
                    <div className="text-xs opacity-70">Exp: {new Date(d.deliveryDate).toLocaleString()}</div>
                  </div>
                  <div className="text-right">
                    <div>{d.mark ? d.mark.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</div>
                    <div className={`text-xs ${ (d.annualizedBasis ?? 0) >= 0 ? 'text-green-300' : 'text-red-300' }`}>{d.annualizedBasis?.toFixed(2)}% annualized</div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {active === 'patterns' && (
        <div className="grid md:grid-cols-2 gap-4">
          <Panel title="Intraday Seasonality (avg |Δreturn| by UTC hour)">
            {seasonality ? (
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={seasonality} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="hour" />
                    <YAxis tickFormatter={(v)=>v.toFixed(2)+'%'} />
                    <Tooltip formatter={(v:any)=>[v.toFixed(3)+'%', 'avg |Δret|']} labelFormatter={(l)=>`UTC ${l}:00`} />
                    <Bar dataKey="avgAbsRet" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : 'Loading…'}
          </Panel>

          <Panel title="Funding vs Forward Return (next 8h)">
            {fundingPts ? (
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis type="number" dataKey="fundingPct" name="Funding" unit="%" />
                    <YAxis type="number" dataKey="fwd8hPct" name="Fwd 8h" unit="%" />
                    <ZAxis range={[60,60]} />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} formatter={(v:any, n:any)=>[v?.toFixed ? v.toFixed(3)+'%' : v, n]} />
                    <Legend />
                    <Scatter name="BTCUSDT" data={fundingPts.filter(p=>p.fwd8hPct!==undefined)} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            ) : 'Loading…'}
          </Panel>

          <Panel title="Basis Term Structure (annualized vs nearest deliveries)">
            {basisBars ? (
              <div style={{ width: '100%', height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={basisBars} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                    <XAxis dataKey="label" />
                    <YAxis tickFormatter={(v)=>v.toFixed(1)+'%'} />
                    <Tooltip formatter={(v:any)=>[v.toFixed(2)+'%', 'annualized basis']} />
                    <Bar dataKey="basisPct" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : 'Loading…'}
          </Panel>

          <Panel title="OI / Price Regimes (1h)">
            {regimes ? (
              <div className="grid grid-cols-2 gap-3">
                {regimes.map(r => (
                  <div key={r.label} className="rounded-xl bg-neutral-900/60 p-3">
                    <div className="text-sm opacity-80">{r.label}</div>
                    <div className="text-3xl font-semibold">{r.count}</div>
                    <div className="text-xs opacity-70">{r.hint}</div>
                  </div>
                ))}
              </div>
            ) : 'Loading…'}
          </Panel>
        </div>
      )}

      {active === 'signals' && (
        <div className="grid md:grid-cols-2 gap-4">
          {signals.map(s => (
            <Panel key={s.id} title={s.title}>
              <div className={`text-sm ${s.ok? 'text-green-300':'text-neutral-400'}`}>{s.detail}</div>
              <div className="mt-2 text-xs opacity-70">{s.ok? 'Signal active' : 'No signal'}</div>
              {alertsOn && s.ok && !locked && (
                <button onClick={()=>sendTelegram(`⚡ ${s.title}: ${s.detail}`)} className="mt-3 px-3 py-1.5 rounded bg-neutral-100 text-neutral-900">Send alert</button>
              )}
            </Panel>
          ))}
          <Panel title="Status">
            <div className="text-sm">Funding in: {useCountdown(nextFunding)}</div>
            <div className="text-sm">Mark: {mark?.toLocaleString(undefined,{maximumFractionDigits:2}) ?? '—'}</div>
            <div className="text-xs opacity-70 mt-2">Signals recompute when you open this tab.</div>
          </Panel>
          <Panel title="Thresholds (current)">
            <div className="text-xs space-y-1">
              <div>Pre‑funding drift ≥ {(thresh.prefundingDriftPct*100).toFixed(2)}% within {thresh.prefundingWindowMin}m &amp; OI non‑rising</div>
              <div>Elevated basis ≥ {thresh.basisAnnualizedPct}% (annualized)</div>
              <div>Range break requires ↑OI and |funding| ≤ {(thresh.rangeBreakFundingAbsMax*100).toFixed(2)}%</div>
              <div>Short squeeze: 5m move ≥ {(thresh.squeezeMinMovePct5m*100).toFixed(2)}% with ↓OI</div>
              <div>Seasonality lookback: {lookbacks.seasonalityDays} days; OI regime limit: {lookbacks.oiRegimeLimit} bars</div>
            </div>
          </Panel>
        </div>
      )}

      {active === 'tools' && (
        <div className="grid md:grid-cols-2 gap-4">
          <Panel title="Position Size Calculator">
            <div className="text-sm grid grid-cols-2 gap-3 items-end">
              <label className="block">Price
                <input type="number" value={priceInput} onChange={e=>setPriceInput(e.target.value===''? '': Number(e.target.value))} placeholder={mark? String(mark): '60000'} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1"/>
              </label>
              <label className="block">Risk $
                <input type="number" value={risk} onChange={e=>setRisk(Number(e.target.value))} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1"/>
              </label>
              <label className="block">Stop %
                <input type="number" step="0.0001" value={stopPct} onChange={e=>setStopPct(Number(e.target.value))} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1"/>
              </label>
              <div>
                <div className="opacity-70">Size (BTC)</div>
                <div className="text-2xl font-semibold">{sizeBTC ? sizeBTC.toFixed(3) : '—'}</div>
                <div className="opacity-60 text-xs">Notional ≈ {(sizeBTC*px).toLocaleString(undefined,{maximumFractionDigits:0})}</div>
              </div>
            </div>
          </Panel>

          <Panel title="P&L Tracker (Daily)">
            <div className="text-sm flex items-center gap-3">
              <div>PNL: <span className={`font-semibold ${dailyPnl>=0?'text-green-300':'text-red-300'}`}>{dailyPnl.toFixed(2)}</span></div>
              <div className="opacity-70">Target +{TARGET}, Cutoff {MAX_LOSS}</div>
            </div>
            <div className="mt-3 flex gap-2 text-sm">
              <button className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700" onClick={()=>setDailyPnl(p=>p+50)}>+50</button>
              <button className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700" onClick={()=>setDailyPnl(p=>p+100)}>+100</button>
              <button className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700" onClick={()=>setDailyPnl(p=>p-50)}>-50</button>
              <button className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700" onClick={()=>setDailyPnl(p=>p-100)}>-100</button>
              <button className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700" onClick={()=>setDailyPnl(0)}>Reset</button>
            </div>
            {locked && <div className="mt-3 text-xs text-yellow-300">Trading locked by rule (hit target/cutoff). Flatten discretionary risk.</div>}
          </Panel>

          <Panel title="Telegram Alerts">
            <div className="text-sm">Enable push alerts for active signals (Netlify function + Telegram bot).</div>
            <div className="mt-3 flex items-center gap-3">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={alertsOn} onChange={e=>setAlertsOn(e.target.checked)} />
                <span>{alertsOn? 'Alerts ON' : 'Alerts OFF'}</span>
              </label>
              <button className="px-2 py-1 rounded bg-neutral-100 text-neutral-900" onClick={()=>sendTelegram('✅ Test from BTC Futures app')}>Send Test</button>
            </div>
            <div className="text-xs opacity-70 mt-3">Set env vars <code>TELEGRAM_BOT_TOKEN</code> and <code>TELEGRAM_CHAT_ID</code> in Netlify.</div>
          </Panel>

          <Panel title="Tuning (Thresholds & Lookbacks)">
            <div className="text-sm grid grid-cols-2 gap-3">
              <div className="col-span-2 opacity-70">Thresholds</div>
              <label className="block">Pre‑funding drift %
                <input type="number" step="0.01" value={(thresh.prefundingDriftPct*100).toFixed(2)} onChange={e=>setThresh({...thresh, prefundingDriftPct: Number(e.target.value)/100})} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1"/>
              </label>
              <label className="block">Pre‑funding window (min)
                <input type="number" value={thresh.prefundingWindowMin} onChange={e=>setThresh({...thresh, prefundingWindowMin: Number(e.target.value)})} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1"/>
              </label>
              <label className="block">Elevated basis % (annualized)
                <input type="number" step="0.1" value={thresh.basisAnnualizedPct} onChange={e=>setThresh({...thresh, basisAnnualizedPct: Number(e.target.value)})} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1"/>
              </label>
              <label className="block">Range‑break |funding| max %
                <input type="number" step="0.001" value={(thresh.rangeBreakFundingAbsMax*100).toFixed(3)} onChange={e=>setThresh({...thresh, rangeBreakFundingAbsMax: Number(e.target.value)/100})} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1"/>
              </label>
              <label className="block">Squeeze min 5m move %
                <input type="number" step="0.01" value={(thresh.squeezeMinMovePct5m*100).toFixed(2)} onChange={e=>setThresh({...thresh, squeezeMinMovePct5m: Number(e.target.value)/100})} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1"/>
              </label>

              <div className="col-span-2 opacity-70 mt-2">Lookbacks</div>
              <label className="block">Seasonality days
                <input type="number" value={lookbacks.seasonalityDays} onChange={e=>setLookbacks({...lookbacks, seasonalityDays: Number(e.target.value)})} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1"/>
              </label>
              <label className="block">Funding→forward hours
                <input type="number" value={lookbacks.fundingForwardHours} onChange={e=>setLookbacks({...lookbacks, fundingForwardHours: Number(e.target.value)})} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1"/>
              </label>
              <label className="block">OI regime bars
                <input type="number" value={lookbacks.oiRegimeLimit} onChange={e=>setLookbacks({...lookbacks, oiRegimeLimit: Number(e.target.value)})} className="mt-1 w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1"/>
              </label>

              <div className="col-span-2 flex gap-2 mt-2">
                <button className="px-2 py-1 rounded bg-neutral-800 border border-neutral-700" onClick={()=>{ setThresh(THRESH as any); setLookbacks(LOOKBACKS as any); try { if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY); } catch {} }}>Reset defaults</button>
                <div className="text-xs opacity-70 self-center">Changes apply immediately and are saved to this browser.</div>
              </div>
            </div>
          </Panel>
        </div>
      )}

      <footer className="mt-8 opacity-60 text-xs">Data: Binance Futures (USDT-M & COIN-M). UTC-based funding/expiries. Auto-reconnect WS. Patterns & signals are heuristic; enforce risk limits.</footer>
    </div>
  );
}
