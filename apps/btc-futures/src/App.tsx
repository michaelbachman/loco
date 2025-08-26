
import React, { useEffect, useMemo, useState } from 'react'
import { BinanceFuturesClient, NormalizedKline } from './lib/binanceClient'
import './index.css'

const client = new BinanceFuturesClient({ useProxy: true, proxyUrl: '/.netlify/functions/binance' })

function Panel({ title, children }: { title: string; children: any }) {
  return (
    <div className='rounded-2xl p-4 bg-neutral-800/60 shadow'>
      <div className='text-sm opacity-70 mb-2'>{title}</div>
      {children}
    </div>
  )
}

// Funding closes helpers
function fundingSlotLabel(t: number): '00:00'|'08:00'|'16:00' {
  const h = new Date(t).getUTCHours() % 24
  if (h === 0) return '00:00'
  if (h === 8) return '08:00'
  return '16:00'
}
function floorToFundingBoundary(ms: number): number {
  const d = new Date(ms)
  const h = d.getUTCHours()
  const boundaryHour = h >= 16 ? 16 : h >= 8 ? 8 : 0
  const floored = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), boundaryHour, 0, 0, 0)
  return floored
}
function getFundingClosesInRange(startMs: number, endMs: number): number[] {
  const out: number[] = []
  let cur = floorToFundingBoundary(endMs)
  if (cur > endMs) cur -= 8 * 3600 * 1000
  while (cur >= startMs) { out.push(cur); cur -= 8 * 3600 * 1000 }
  return out.reverse()
}
type FundingDriftRow = { t: number; slot: '00:00'|'08:00'|'16:00'; d60: number|null; d30: number|null; d15: number|null; d5: number|null; oi60: number|null; oi30: number|null; oi15: number|null; oi5: number|null }
function nearestCloseBefore(kl: NormalizedKline[], t: number): NormalizedKline | undefined {
  let lo = 0, hi = kl.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (kl[mid].closeTime <= t) { ans = mid; lo = mid + 1 } else { hi = mid - 1 }
  }
  return ans >= 0 ? kl[ans] : undefined
}
function pct(a: number, b: number): number { return ((a - b) / b) * 100 }
function summarizeFundingDrift1m(kl: NormalizedKline[], closes: number[]): FundingDriftRow[] {
  const windows = [60, 30, 15, 5]
  return closes.map(t => {
    const slot = fundingSlotLabel(t)
    const endK = nearestCloseBefore(kl, t)
    const d: Record<string, number|null> = { d60: null, d30: null, d15: null, d5: null }
    if (endK) {
      for (const m of windows) {
        const startK = nearestCloseBefore(kl, t - m * 60 * 1000)
        if (startK) {
          const pc = pct(endK.close, startK.close)
          if (m === 60) d.d60 = pc
          if (m === 30) d.d30 = pc
          if (m === 15) d.d15 = pc
          if (m === 5) d.d5 = pc
        }
      }
    }
    return { t, slot, d60: d.d60, d30: d.d30, d15: d.d15, d5: d.d5, oi60: null, oi30: null, oi15: null, oi5: null }
  })
}

function SimulateFunding() {
  const [hours, setHours] = useState<number>(16)
  const [rows, setRows] = useState<FundingDriftRow[] | null>(null)
  const [agg, setAgg] = useState<Array<{ slot: string; n: number; avg60: number|null; avg30: number|null; avg15: number|null; avg5: number|null; avgOI60: number|null; avgOI30: number|null; avgOI15: number|null; avgOI5: number|null }> | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function aggregateBySlot(rows: FundingDriftRow[]): Array<{ slot: string; n: number; avg60: number|null; avg30: number|null; avg15: number|null; avg5: number|null; avgOI60: number|null; avgOI30: number|null; avgOI15: number|null; avgOI5: number|null }> {
    const by: Record<string, { n: number; s60: number; c60: number; s30: number; c30: number; s15: number; c15: number; s5: number; c5: number; sOI60: number; cOI60: number; sOI30: number; cOI30: number; sOI15: number; cOI15: number; sOI5: number; cOI5: number }> = {}
    for (const r of rows) {
      if (!by[r.slot]) by[r.slot] = { n: 0, s60: 0, c60: 0, s30: 0, c30: 0, s15: 0, c15: 0, s5: 0, c5: 0, sOI60: 0, cOI60: 0, sOI30: 0, cOI30: 0, sOI15: 0, cOI15: 0, sOI5: 0, cOI5: 0 }
      const b = by[r.slot]
      b.n += 1
      if (r.d60 !== null) { b.s60 += r.d60; b.c60 += 1 }
      if (r.d30 !== null) { b.s30 += r.d30; b.c30 += 1 }
      if (r.d15 !== null) { b.s15 += r.d15; b.c15 += 1 }
      if (r.d5 !== null) { b.s5 += r.d5; b.c5 += 1 }
      if (r.oi60 !== null) { b.sOI60 += r.oi60; b.cOI60 += 1 }
      if (r.oi30 !== null) { b.sOI30 += r.oi30; b.cOI30 += 1 }
      if (r.oi15 !== null) { b.sOI15 += r.oi15; b.cOI15 += 1 }
      if (r.oi5 !== null) { b.sOI5 += r.oi5; b.cOI5 += 1 }
    }
    const avg = (s: number, c: number) => c>0 ? s/c : null
    return ['00:00','08:00','16:00'].map(slot => {
      const b = by[slot]
      if (!b) return { slot, n: 0, avg60: null, avg30: null, avg15: null, avg5: null, avgOI60: null, avgOI30: null, avgOI15: null, avgOI5: null }
      return { slot, n: b.n, avg60: avg(b.s60,b.c60), avg30: avg(b.s30,b.c30), avg15: avg(b.s15,b.c15), avg5: avg(b.s5,b.c5), avgOI60: avg(b.sOI60,b.cOI60), avgOI30: avg(b.sOI30,b.cOI30), avgOI15: avg(b.sOI15,b.cOI15), avgOI5: avg(b.sOI5,b.cOI5) }
    })
  }

  function exportCsv() {
    if (!rows || rows.length === 0) return;
    const header = 'funding_close_utc,slot,delta60_pct,delta30_pct,delta15_pct,delta5_pct,oi60_delta,oi30_delta,oi15_delta,oi5_delta';
    const lines = rows.map(r => [
      new Date(r.t).toISOString(), r.slot,
      r.d60 ?? '', r.d30 ?? '', r.d15 ?? '', r.d5 ?? '',
      r.oi60 ?? '', r.oi30 ?? '', r.oi15 ?? '', r.oi5 ?? ''
    ].join(','));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'funding_drift_sim.csv'; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  useEffect(() => { (async () => {
    setLoading(true); setErr(null);
    try {
      const end = Date.now();
      const start = end - hours * 3600 * 1000;
      const kl = await client.getKlines('BTCUSDT','1m',{ startTime: start - 70*60*1000, endTime: end }, 'usdt');
      const closes = getFundingClosesInRange(start, end);
      let rows0 = summarizeFundingDrift1m(kl, closes);
      // Attach OI (5m) deltas if available
      try {
        const limit5 = Math.min(500, Math.ceil(hours * 12) + 40);
        const oi = await client.getOpenInterestHist('BTCUSDT','5m', limit5);
        const sorted = oi.slice().sort((a,b)=>a.timestamp - b.timestamp);
        const times = sorted.map(x=>x.timestamp);
        const vals = sorted.map(x=>x.sumOpenInterest);
        const idxBefore = (t:number) => { let lo=0, hi=times.length-1, ans=-1; while (lo<=hi){ const mid=(lo+hi)>>1; if (times[mid] <= t){ ans=mid; lo=mid+1 } else hi=mid-1 } return ans };
        const windows = [60,30,15,5];
        rows0 = rows0.map(r => {
          const out = { ...r } as FundingDriftRow;
          for (const m of windows) {
            const iEnd = idxBefore(r.t);
            const iBeg = idxBefore(r.t - m*60*1000);
            if (iEnd>=0 && iBeg>=0) {
              const d = vals[iEnd] - vals[iBeg];
              if (m===60) out.oi60 = d;
              if (m===30) out.oi30 = d;
              if (m===15) out.oi15 = d;
              if (m===5) out.oi5 = d;
            }
          }
          return out;
        });
      } catch {}
      setRows(rows0);
      setAgg(aggregateBySlot(rows0));
    } catch (e:any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  })() }, [hours])

  return (
    <div className='text-sm'>
      <div className='flex items-end gap-3 mb-3'>
        <label className='block'>Hours
          <input type='number' min={1} max={48} value={hours} onChange={e=>setHours(Number(e.target.value))} className='mt-1 w-24 bg-neutral-800 border border-neutral-700 rounded px-2 py-1' />
        </label>
        <div className='opacity-70'>Uses BTCUSDT 1m + OI (5m). Funding closes at 00:00, 08:00, 16:00 UTC.</div>
        <button onClick={exportCsv} disabled={!rows || rows.length===0} className='px-3 py-1.5 rounded bg-neutral-100 text-neutral-900 disabled:opacity-50'>Export CSV</button>
      </div>
      {loading && <div>Loading…</div>}
      {err && <div className='text-red-300'>{err}</div>}
      {rows && rows.length>0 && (
        <div className='space-y-4'>
          <div>
            <div className='opacity-80 mb-2'>Per-event drift into funding close</div>
            <div className='overflow-x-auto'>
              <table className='w-full text-xs'>
                <thead className='text-left opacity-70'>
                  <tr><th className='py-1 pr-3'>Funding Close (UTC)</th><th className='py-1 pr-3'>Slot</th><th className='py-1 pr-3'>Δ60m %</th><th className='py-1 pr-3'>Δ30m %</th><th className='py-1 pr-3'>Δ15m %</th><th className='py-1 pr-3'>Δ5m %</th><th className='py-1 pr-3'>ΔOI60</th><th className='py-1 pr-3'>ΔOI30</th><th className='py-1 pr-3'>ΔOI15</th><th className='py-1 pr-3'>ΔOI5</th></tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.t} className='border-t border-neutral-800'>
                      <td className='py-1 pr-3'>{new Date(r.t).toUTCString()}</td>
                      <td className='py-1 pr-3'>{r.slot}</td>
                      <td className='py-1 pr-3'>{r.d60===null?'—':r.d60.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{r.d30===null?'—':r.d30.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{r.d15===null?'—':r.d15.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{r.d5===null?'—':r.d5.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{r.oi60===null?'—':Math.round(r.oi60).toLocaleString()}</td>
                      <td className='py-1 pr-3'>{r.oi30===null?'—':Math.round(r.oi30).toLocaleString()}</td>
                      <td className='py-1 pr-3'>{r.oi15===null?'—':Math.round(r.oi15).toLocaleString()}</td>
                      <td className='py-1 pr-3'>{r.oi5===null?'—':Math.round(r.oi5).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className='opacity-80 mb-2'>Aggregated by slot (within window)</div>
            <div className='overflow-x-auto'>
              <table className='w-full text-xs'>
                <thead className='text-left opacity-70'>
                  <tr><th className='py-1 pr-3'>Slot</th><th className='py-1 pr-3'>Obs</th><th className='py-1 pr-3'>Avg Δ60m %</th><th className='py-1 pr-3'>Avg Δ30m %</th><th className='py-1 pr-3'>Avg Δ15m %</th><th className='py-1 pr-3'>Avg Δ5m %</th><th className='py-1 pr-3'>Avg ΔOI60</th><th className='py-1 pr-3'>Avg ΔOI30</th><th className='py-1 pr-3'>Avg ΔOI15</th><th className='py-1 pr-3'>Avg ΔOI5</th></tr>
                </thead>
                <tbody>
                  {agg?.map(a => (
                    <tr key={a.slot} className='border-t border-neutral-800'>
                      <td className='py-1 pr-3'>{a.slot}</td>
                      <td className='py-1 pr-3'>{a.n}</td>
                      <td className='py-1 pr-3'>{a.avg60===null?'—':a.avg60.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{a.avg30===null?'—':a.avg30.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{a.avg15===null?'—':a.avg15.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{a.avg5===null?'—':a.avg5.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{a.avgOI60===null?'—':Math.round(a.avgOI60).toLocaleString()}</td>
                      <td className='py-1 pr-3'>{a.avgOI30===null?'—':Math.round(a.avgOI30).toLocaleString()}</td>
                      <td className='py-1 pr-3'>{a.avgOI15===null?'—':Math.round(a.avgOI15).toLocaleString()}</td>
                      <td className='py-1 pr-3'>{a.avgOI5===null?'—':Math.round(a.avgOI5).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {!loading && (!rows || rows.length===0) && <div>No funding closes within the chosen window. Try increasing "Hours" to 24–36.</div>}
    </div>
  )
}

export default function App() {
  const [active, setActive] = useState<'simulate'>('simulate')
  return (
    <div className='min-h-screen bg-neutral-900 text-neutral-100 p-6'>
      <header className='flex items-center justify-between mb-6'>
        <h1 className='text-3xl' style={{ fontFamily: 'Creepster, system-ui' }}>BTC Futures</h1>
        <nav className='flex gap-2 text-sm'>
          <button className='px-3 py-1.5 rounded-full border bg-neutral-100 text-neutral-900 border-neutral-100'>SIMULATE</button>
        </nav>
      </header>
      <div className='grid gap-4'>
        <Panel title='Funding Drift Simulation (last N hours)'>
          <SimulateFunding />
        </Panel>
      </div>
      <footer className='mt-8 opacity-60 text-xs'>Data: Binance Futures (USDT-M & COIN-M). UTC-based funding. Heuristic metrics; enforce risk limits.</footer>
    </div>
  )
}
