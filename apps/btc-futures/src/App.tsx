
import React, { useEffect, useState } from 'react'
import './index.css'
import { KrakenFuturesClient, Ohlc } from './lib/krakenClient'

const client = new KrakenFuturesClient('/.netlify/functions/kraken')
const SYMBOL = 'PI_XBTUSD'

function Panel({ title, children }: { title: string; children: any }) {
  return (
    <div className='rounded-2xl p-4 bg-neutral-800/60 shadow'>
      <div className='text-sm opacity-70 mb-2'>{title}</div>
      {children}
    </div>
  )
}

function slotLabelFromHour(h: number, fundingIntervalHours: number) {
  if (fundingIntervalHours === 8) return h % 24 === 0 ? '00:00' : h % 24 === 8 ? '08:00' : '16:00'
  const hh = (h % 24).toString().padStart(2,'0') + ':00'
  return hh as any
}
function floorToBoundary(ms: number, fundingIntervalHours: number): number {
  const d = new Date(ms)
  const h = d.getUTCHours()
  const boundaryHour = Math.floor(h / fundingIntervalHours) * fundingIntervalHours
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), boundaryHour, 0, 0, 0)
}
function getFundingClosesInRange(startMs: number, endMs: number, fundingIntervalHours: number): number[] {
  const out: number[] = []
  let cur = floorToBoundary(endMs, fundingIntervalHours)
  if (cur > endMs) cur -= fundingIntervalHours * 3600 * 1000
  while (cur >= startMs) { out.push(cur); cur -= fundingIntervalHours * 3600 * 1000 }
  return out.reverse()
}
type Row = { t: number; slot: string; d60: number|null; d30: number|null; d15: number|null; d5: number|null }

function nearestCloseBefore(kl: Ohlc[], t: number): Ohlc | undefined {
  let lo = 0, hi = kl.length - 1, ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (kl[mid].time <= t) { ans = mid; lo = mid + 1 } else { hi = mid - 1 }
  }
  return ans >= 0 ? kl[ans] : undefined
}
function pct(a: number, b: number): number { return ((a - b) / b) * 100 }

function Simulate() {
  const [hours, setHours] = useState<number>(16)
  const [fundingInterval, setFundingInterval] = useState<number>(8)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [agg, setAgg] = useState<Array<{ slot: string; n: number; a60: number|null; a30: number|null; a15: number|null; a5: number|null }> | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function exportCsv() {
    if (!rows || rows.length === 0) return;
    const header = 'funding_close_utc,slot,delta60_pct,delta30_pct,delta15_pct,delta5_pct';
    const lines = rows.map(r => [ new Date(r.t).toISOString(), r.slot, r.d60 ?? '', r.d30 ?? '', r.d15 ?? '', r.d5 ?? '' ].join(','));
    const csv = [header, ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'kraken_funding_drift.csv'; document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  useEffect(() => { (async () => {
    setLoading(true); setErr(null);
    try {
      const end = Date.now();
      const start = end - hours * 3600 * 1000;
      const kl = await client.getOhlc(SYMBOL, '1m', { since: start - 70*60*1000, until: end });
      const closes = getFundingClosesInRange(start, end, fundingInterval);
      const windows = [60,30,15,5]
      const rows0 = closes.map(t => {
        const endK = nearestCloseBefore(kl, t)
        const slot = slotLabelFromHour(new Date(t).getUTCHours(), fundingInterval)
        const rec: Row = { t, slot, d60: null, d30: null, d15: null, d5: null }
        if (endK) {
          for (const m of windows) {
            const startK = nearestCloseBefore(kl, t - m*60*1000)
            if (startK) {
              const pc = pct(endK.close, startK.close)
              if (m===60) rec.d60 = pc
              if (m===30) rec.d30 = pc
              if (m===15) rec.d15 = pc
              if (m===5) rec.d5 = pc
            }
          }
        }
        return rec
      })
      setRows(rows0)

      const by: Record<string, { n:number; s60:number; c60:number; s30:number; c30:number; s15:number; c15:number; s5:number; c5:number }> = {}
      for (const r of rows0) {
        const b = by[r.slot] ?? (by[r.slot] = { n:0, s60:0,c60:0, s30:0,c30:0, s15:0,c15:0, s5:0,c5:0 })
        b.n += 1
        if (r.d60!==null) { b.s60 += r.d60; b.c60++ }
        if (r.d30!==null) { b.s30 += r.d30; b.c30++ }
        if (r.d15!==null) { b.s15 += r.d15; b.c15++ }
        if (r.d5!==null) { b.s5 += r.d5; b.c5++ }
      }
      const avg = (s:number,c:number)=> c>0? s/c : null
      const slots = fundingInterval===8 ? ['00:00','08:00','16:00'] : ['00:00','04:00','08:00','12:00','16:00','20:00']
      setAgg(slots.map(slot => {
        const b = by[slot]; if (!b) return { slot, n:0, a60:null,a30:null,a15:null,a5:null }
        return { slot, n: b.n, a60: avg(b.s60,b.c60), a30: avg(b.s30,b.c30), a15: avg(b.s15,b.c15), a5: avg(b.s5,b.c5) }
      }))
    } catch (e:any) {
      setErr(String(e?.message || e))
      setRows(null); setAgg(null)
    } finally {
      setLoading(false);
    }
  })() }, [hours, fundingInterval])

  return (
    <div className='text-sm'>
      <div className='flex flex-wrap items-end gap-3 mb-3'>
        <label className='block'>Hours
          <input type='number' min={1} max={48} value={hours} onChange={e=>setHours(Number(e.target.value))} className='mt-1 w-24 bg-neutral-800 border border-neutral-700 rounded px-2 py-1' />
        </label>
        <label className='block'>Funding Interval
          <select value={fundingInterval} onChange={e=>setFundingInterval(Number(e.target.value))} className='mt-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1'>
            <option value={8}>8h (Binance-style)</option>
            <option value={4}>4h (Kraken-style)</option>
          </select>
        </label>
        <div className='opacity-70'>Symbol: <code>{SYMBOL}</code></div>
        <button onClick={exportCsv} disabled={!rows || rows.length===0} className='px-3 py-1.5 rounded bg-neutral-100 text-neutral-900 disabled:opacity-50'>Export CSV</button>
      </div>
      {loading && <div>Loading…</div>}
      {err && <div className='text-red-300 break-words'>Error: {err}</div>}
      {rows && rows.length>0 && (
        <div className='space-y-4'>
          <div>
            <div className='opacity-80 mb-2'>Per-event drift into funding close</div>
            <div className='overflow-x-auto'>
              <table className='w-full text-xs'>
                <thead className='text-left opacity-70'>
                  <tr><th className='py-1 pr-3'>Funding Close (UTC)</th><th className='py-1 pr-3'>Slot</th><th className='py-1 pr-3'>Δ60m %</th><th className='py-1 pr-3'>Δ30m %</th><th className='py-1 pr-3'>Δ15m %</th><th className='py-1 pr-3'>Δ5m %</th></tr>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className='opacity-80 mb-2'>Aggregated by slot</div>
            <div className='overflow-x-auto'>
              <table className='w-full text-xs'>
                <thead className='text-left opacity-70'>
                  <tr><th className='py-1 pr-3'>Slot</th><th className='py-1 pr-3'>Obs</th><th className='py-1 pr-3'>Avg Δ60m %</th><th className='py-1 pr-3'>Avg Δ30m %</th><th className='py-1 pr-3'>Avg Δ15m %</th><th className='py-1 pr-3'>Avg Δ5m %</th></tr>
                </thead>
                <tbody>
                  {agg?.map(a => (
                    <tr key={a.slot} className='border-t border-neutral-800'>
                      <td className='py-1 pr-3'>{a.slot}</td>
                      <td className='py-1 pr-3'>{a.n}</td>
                      <td className='py-1 pr-3'>{a.a60===null?'—':a.a60.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{a.a30===null?'—':a.a30.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{a.a15===null?'—':a.a15.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{a.a5===null?'—':a.a5.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {!loading && (!rows || rows.length===0) && <div>No funding closes within the chosen window. Try increasing "Hours" or switch interval to 4h.</div>}
    </div>
  )
}

export default function App() {
  return (
    <div className='min-h-screen bg-neutral-900 text-neutral-100 p-6'>
      <header className='flex items-center justify-between mb-6'>
        <h1 className='text-3xl' style={{ fontFamily: 'Creepster, system-ui' }}>Kraken Futures — BTC Perp</h1>
        <nav className='flex gap-2 text-sm'>
          <span className='px-3 py-1.5 rounded-full border bg-neutral-100 text-neutral-900 border-neutral-100'>SIMULATE</span>
        </nav>
      </header>
      <div className='text-xs opacity-70 mb-2'>Data source: Kraken Futures; falls back to Kraken Spot OHLC if futures endpoints are unavailable.</div>
      <div className='grid gap-4'>
        <Panel title='Funding Drift Simulation (last N hours)'>
          <Simulate />
        </Panel>
      </div>
      <footer className='mt-8 opacity-60 text-xs'>Data: Kraken Futures public API via Netlify proxy. Funding interval selectable (4h/8h). Results are heuristic; manage risk.</footer>
    </div>
  )
}
