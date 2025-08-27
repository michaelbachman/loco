
import React, { useEffect, useState } from 'react'
import './index.css'
import { KrakenFuturesClient } from './lib/krakenClient'
import { Ohlc, pct, closesInRange, nearestBarBefore } from './lib/util'

const client = new KrakenFuturesClient()
const DEFAULT_SYMBOL = 'PI_XBTUSD'

type DriftRow = { t:number; slot:string; d60:number|null; d30:number|null; d15:number|null; d5:number|null; d60Abs:number|null; d30Abs:number|null; d15Abs:number|null; d5Abs:number|null; p1m:number|null; d1m:number|null; d1mAbs:number|null; source?:string; p60:number|null; p30:number|null; p15:number|null; p5:number|null; pnl60:number|null; pnl30:number|null; pnl15:number|null; pnl5:number|null; exit60:number|null; exit30:number|null; exit15:number|null; exit5:number|null }

function formatSlotLabel(h:number, interval:number){
  if(interval===8) return h%24===0?'00:00':h%24===8?'08:00':'16:00'
  if(interval===4) return ['00:00','04:00','08:00','12:00','16:00','20:00'][Math.floor((h%24)/4)]
  return (h%24).toString().padStart(2,'0')+':00'
}

function computeRows(bars:Ohlc[], closes:number[], interval:number, source:string|undefined, sizePct:number, leverage:number, targetUsd:number): DriftRow[] {
  const wins=[60,30,15,5]
  return closes.map(t=>{
    const end = nearestBarBefore(bars, t)
    const oneMin = nearestBarBefore(bars, t - 1*60*1000)
    const slot = formatSlotLabel(new Date(t).getUTCHours(), interval)
    const r: DriftRow = { t, slot, d60:null, d30:null, d15:null, d5:null, d60Abs:null, d30Abs:null, d15Abs:null, d5Abs:null, p1m:null, d1m:null, d1mAbs:null, p60:null, p30:null, p15:null, p5:null, pnl60:null, pnl30:null, pnl15:null, pnl5:null, exit60:null, exit30:null, exit15:null, exit5:null, source }
    if(oneMin){ r.p1m = oneMin.close }
    if(end && oneMin){ r.d1m = pct(end.close, oneMin.close); r.d1mAbs = end.close - oneMin.close }
    if(end){
      for(const m of wins){
        const beg=nearestBarBefore(bars, t - m*60*1000)
        if(beg){
          const pc=pct(end.close, beg.close)
          const usd=end.close - beg.close
                    const qty = (sizePct/100) * leverage // effective BTC size
          const pnl=qty * usd
          const exitTarget=beg.close + (targetUsd/qty) // price to net $100 on 0.01 BTC
          if(m===60){ r.d60=pc; r.d60Abs=usd; r.p60=beg.close; r.pnl60=pnl; r.exit60=exitTarget }
          if(m===30){ r.d30=pc; r.d30Abs=usd; r.p30=beg.close; r.pnl30=pnl; r.exit30=exitTarget }
          if(m===15){ r.d15=pc; r.d15Abs=usd; r.p15=beg.close; r.pnl15=pnl; r.exit15=exitTarget }
          if(m===5){ r.d5=pc; r.d5Abs=usd; r.p5=beg.close; r.pnl5=pnl; r.exit5=exitTarget }
        }
      }
    }
    return r
  })
}

function aggregate(rows:DriftRow[], slots:string[]){
  const by: Record<string, {n:number;s60:number;c60:number;s30:number;c30:number;s15:number;c15:number;s5:number;c5:number}> = {}
  for(const r of rows){
    const b = by[r.slot] ?? (by[r.slot]={n:0,s60:0,c60:0,s30:0,c30:0,s15:0,c15:0,s5:0,c5:0})
    b.n++
    if(r.d60!=null){ b.s60+=r.d60; b.c60++ }
    if(r.d30!=null){ b.s30+=r.d30; b.c30++ }
    if(r.d15!=null){ b.s15+=r.d15; b.c15++ }
    if(r.d5!=null){ b.s5+=r.d5; b.c5++ }
  }
  const avg=(s:number,c:number)=> c>0? s/c : null
  return slots.map(slot=>{
    const b=by[slot]; if(!b) return {slot, n:0, a60:null, a30:null, a15:null, a5:null} as any
    return { slot, n:b.n, a60:avg(b.s60,b.c60), a30:avg(b.s30,b.c30), a15:avg(b.s15,b.c15), a5:avg(b.s5,b.c5) }
  })
}

function exportCsvRows(rows:DriftRow[], name:string){
  const header='funding_close_utc,slot,t_minus_1m_price,size_pct,leverage,target_usd,delta1m_pct,delta1m_usd,delta60_pct,delta60_usd,buyin60,pnl60,exit60_target,delta30_pct,delta30_usd,buyin30,pnl30,exit30_target,delta15_pct,delta15_usd,buyin15,pnl15,exit15_target,delta5_pct,delta5_usd,buyin5,pnl5,exit5_target,source'
  const lines = rows.map(r=>[new Date(r.t).toISOString(), r.slot, r.p1m??'', sizePct, leverage, targetUsd, r.d1m??'', r.d1mAbs??'', r.d60??'', r.d60Abs??'', r.p60??'', r.pnl60??'', r.exit60??'', r.d30??'', r.d30Abs??'', r.p30??'', r.pnl30??'', r.exit30??'', r.d15??'', r.d15Abs??'', r.p15??'', r.pnl15??'', r.exit15??'', r.d5??'', r.d5Abs??'', r.p5??'', r.pnl5??'', r.exit5??'', r.source??''].join(','))
  const csv=[header, ...lines].join('\n')
  const blob = new Blob([csv], {type:'text/csv'}); const url=URL.createObjectURL(blob)
  const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}
function exportCsvAgg(agg:any[], name:string){
  const header='slot,obs,avg_delta60_pct,avg_delta30_pct,avg_delta15_pct,avg_delta5_pct'
  const lines = agg.map(a=>[a.slot, a.n, a.a60??'', a.a30??'', a.a15??'', a.a5??''].join(','))
  const csv=[header, ...lines].join('\n')
  const blob = new Blob([csv], {type:'text/csv'}); const url=URL.createObjectURL(blob)
  const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}

function nextBoundary(from:number, interval:number){
  const d=new Date(from); const h=d.getUTCHours(); const nextBlock=(Math.floor(h/interval)+1)*interval
  const nextMs = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), nextBlock, 0, 0, 0)
  return nextMs
}

function useLocalStorage<T>(key:string, init:T){
  const [val,setVal]=useState<T>(()=>{
    try{ const v=localStorage.getItem(key); return v? JSON.parse(v) as T : init }catch{ return init }
  })
  useEffect(()=>{ try{ localStorage.setItem(key, JSON.stringify(val)) }catch{} },[key,val])
  return [val,setVal] as const
}

export default function App(){
  // Default "Hours" to 16 (lookback window)
  const [hours, setHours] = useLocalStorage<number>('hours', 16)
  const [symbol, setSymbol] = useLocalStorage<string>('kr_symbol', DEFAULT_SYMBOL)
  const [intervalMode, setIntervalMode] = useLocalStorage<'auto'|'manual'>('interval_mode','auto')
  const [manualInterval, setManualInterval] = useLocalStorage<number>('manual_interval', 4)

  // Trade config
  const [sizePct, setSizePct] = useLocalStorage<number>('trade_size_pct', 1)
  const [leverage, setLeverage] = useLocalStorage<number>('trade_leverage', 5)
  const [targetUsd, setTargetUsd] = useLocalStorage<number>('trade_target_usd', 100)

  const [krInterval, setKrInterval] = useState<number>(4) // auto-detected later
  const [krMark, setKrMark] = useState<number|undefined>(undefined)

  const [status, setStatus] = useState<'idle'|'fetching'|'ok'|'error'>('idle')
  const [rows, setRows] = useState<DriftRow[]|null>(null)
  const [agg, setAgg] = useState<any[]|null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Live mark via Kraken WS
  useEffect(()=>{
    const ws = new WebSocket('wss://futures.kraken.com/ws/v1')
    ws.onopen = ()=> ws.send(JSON.stringify({ event:'subscribe', feed:'ticker', product_ids:[symbol] }))
    ws.onmessage = (e)=> { try{ const m=JSON.parse(e.data as string); if(m.feed==='ticker' && m.product_id===symbol){ const p = Number(m.markPrice ?? m.last ?? m.price); if(!Number.isNaN(p)) setKrMark(p) } }catch{} }
    return ()=>{ try{ws.close()}catch{} }
  },[symbol])

  // Autodetect funding interval from ticker nextFundingTime when available
  useEffect(()=>{ (async()=>{
    if(intervalMode==='manual'){ setKrInterval(manualInterval); return }
    try{
      const tickers = await client.getTickers()
      const item = tickers.find(t=>t.symbol===symbol)
      let kInt = 4
      if(item?.nextFundingTime){
        const now = Date.now()
        const deltas = [4,8].map(h=> Math.abs(nextBoundary(now,h)-item.nextFundingTime!))
        kInt = deltas[0] <= deltas[1] ? 4 : 8
      }
      setKrInterval(kInt)
    }catch{ setKrInterval(4) }
  })() },[intervalMode, manualInterval, symbol])

  // Fetch + compute drift
  useEffect(()=>{ (async()=>{
    setErr(null)
    const end=Date.now(), start=end - hours*3600*1000
    try{
      setStatus('fetching')
      const res = await client.getOhlc(symbol, '1m', { since: start - 70*60*1000, until: end })
      const closes = closesInRange(start, end, krInterval)
      const rows0 = computeRows(res.bars, closes, krInterval, res.source, sizePct, leverage, targetUsd)
      setRows(rows0)
      const slots = krInterval===8? ['00:00','08:00','16:00']: ['00:00','04:00','08:00','12:00','16:00','20:00']
      setAgg(aggregate(rows0, slots))
      setStatus('ok')
    }catch(e:any){
      setStatus('error')
      setErr(String(e?.message || e))
      setRows(null); setAgg(null)
    }
  })() },[hours, symbol, krInterval])

  const now = Date.now()
  const next = nextBoundary(now, krInterval)
  function formatCountdown(ms:number){
    const s=Math.max(0, Math.floor(ms/1000)); const hh=Math.floor(s/3600), mm=Math.floor((s%3600)/60), ss=s%60
    return `${hh.toString().padStart(2,'0')}:${mm.toString().padStart(2,'0')}:${ss.toString().padStart(2,'0')}`
  }

  const statusChip = (s:'idle'|'fetching'|'ok'|'error') => (
    <span className={
      'px-2 py-0.5 rounded-full text-xs '+
      (s==='fetching'?'bg-yellow-200 text-yellow-900': s==='ok'?'bg-emerald-200 text-emerald-900': s==='error'?'bg-rose-200 text-rose-900':'bg-neutral-700 text-neutral-100')
    }>{s.toUpperCase()}</span>
  )

  return (
    <div className='min-h-screen bg-neutral-900 text-neutral-100 p-6'>
      <header className='flex items-center justify-between mb-4'>
        <h1 className='text-3xl' style={{ fontFamily:'Creepster, system-ui' }}>Kraken Futures — Funding Drift</h1>
        <div className='flex items-center gap-2 text-xs'>
          <span>Status</span>{statusChip(status)}
          <span>Next Funding Close: {new Date(next).toUTCString()} ({formatCountdown(next - Date.now())})</span>
        </div>
      </header>

      <div className='text-xs opacity-70 mb-2'>Data: Kraken Futures (falls back to Kraken Spot OHLC if needed). Drift into funding closes; 1m bars. Default lookback = 16 hours.</div>

      <div className='rounded-2xl p-4 bg-neutral-800/60 mb-4'>
        <div className='flex flex-wrap items-end gap-3 text-sm'>
          <label>Hours (lookback)
            <input type='number' min={1} max={72} value={hours} onChange={e=>setHours(Number(e.target.value))} className='ml-2 w-24 bg-neutral-800 border border-neutral-700 rounded px-2 py-1' />
          </label>
          <label>Funding Interval
            <select value={intervalMode} onChange={e=>setIntervalMode(e.target.value as any)} className='ml-2 bg-neutral-800 border border-neutral-700 rounded px-2 py-1'>
              <option value='auto'>Auto-detect</option>
              <option value='manual'>Manual</option>
            </select>
          </label>
          {intervalMode==='manual' && (
            <select value={manualInterval} onChange={e=>setManualInterval(Number(e.target.value))} className='bg-neutral-800 border border-neutral-700 rounded px-2 py-1'>
              <option value={4}>4h</option>
              <option value={8}>8h</option>
            </select>
          )}
          <label>Symbol
            <select value={symbol} onChange={e=>setSymbol(e.target.value)} className='ml-2 bg-neutral-800 border border-neutral-700 rounded px-2 py-1'>
              <option>PI_XBTUSD</option>
              <option>PI_ETHUSD</option>
            </select>
          </label>
          <div className='opacity-80'>Mark: {krMark? krMark.toLocaleString(): '—'}</div>
          <div className='opacity-80'>Interval: {intervalMode==='auto'? (krInterval+'h (auto)') : (manualInterval+'h')}</div>
          <div className='ml-auto flex gap-2'>
            <label className='mr-2'>Size (% of 1 BTC)
              <input type='number' min={0.1} step={0.1} max={100} value={sizePct} onChange={e=>setSizePct(Number(e.target.value))} className='ml-2 w-24 bg-neutral-800 border border-neutral-700 rounded px-2 py-1' />
            </label>
            <label className='mr-2'>Leverage (x)
              <input type='number' min={1} step={1} max={125} value={leverage} onChange={e=>setLeverage(Number(e.target.value))} className='ml-2 w-20 bg-neutral-800 border border-neutral-700 rounded px-2 py-1' />
            </label>
            <label className='mr-2'>Target $ Profit
              <input type='number' min={10} step={10} value={targetUsd} onChange={e=>setTargetUsd(Number(e.target.value))} className='ml-2 w-28 bg-neutral-800 border border-neutral-700 rounded px-2 py-1' />
            </label>
            
            <button onClick={()=> rows && exportCsvRows(rows,'kraken_drift_rows.csv')} className='px-3 py-1.5 rounded bg-neutral-100 text-neutral-900 disabled:opacity-50' disabled={!rows || rows.length===0}>Export Rows</button>
            <button onClick={()=> agg && exportCsvAgg(agg,'kraken_drift_agg.csv')} className='px-3 py-1.5 rounded bg-neutral-100 text-neutral-900 disabled:opacity-50' disabled={!agg || agg.length===0}>Export Aggregates</button>
          </div>
        </div>
      </div>

      <div className='rounded-2xl p-4 bg-neutral-800/60'>
        <div className='opacity-80 mb-2'>Per-event drift (source: {rows && rows[0]?.source || '—'})</div>
        {rows && rows.length>0 ? (
          <div className='overflow-x-auto'>
            <table className='w-full text-xs'>
              <thead className='text-left opacity-70'>
                <tr><th className='py-1 pr-3'>Funding Close (UTC)</th><th className='py-1 pr-3'>Slot</th><th className='py-1 pr-3'>T-1m Price</th><th className='py-1 pr-3'>Δ1m % (USD)</th><th className='py-1 pr-3'>Δ60m % (USD)</th><th className='py-1 pr-3'>Δ30m % (USD)</th><th className='py-1 pr-3'>Δ15m % (USD)</th><th className='py-1 pr-3'>Δ5m % (USD)</th><th className='py-1 pr-3'>Src</th></tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.t} className='border-t border-neutral-800'>
                    <td className='py-1 pr-3'>{new Date(r.t).toUTCString()}</td>
                    <td className='py-1 pr-3'>{r.slot}</td>
                    <td className='py-1 pr-3'>{r.p1m==null?'—':r.p1m.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
                    <td className='py-1 pr-3'>{r.d1m==null?'—':`${r.d1m.toFixed(3)}% ($${(r.d1mAbs??0).toFixed(2)})`}</td>
                    <td className='py-1 pr-3'>{r.d60==null?'—':`${r.d60.toFixed(3)}% ($${(r.d60Abs??0).toFixed(2)})`}</td>
                    <td className='py-1 pr-3'>{r.d30==null?'—':`${r.d30.toFixed(3)}% ($${(r.d30Abs??0).toFixed(2)})`}</td>
                    <td className='py-1 pr-3'>{r.d15==null?'—':`${r.d15.toFixed(3)}% ($${(r.d15Abs??0).toFixed(2)})`}</td>
                    <td className='py-1 pr-3'>{r.d5==null?'—':`${r.d5.toFixed(3)}% ($${(r.d5Abs??0).toFixed(2)})`}</td>
                    <td className='py-1 pr-3'>{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div>No funding closes in range. Increase Hours.</div>}

        <div className='opacity-80 mt-3 mb-1'>Aggregated by slot</div>
        {agg && (
          <div className='overflow-x-auto'>
            <table className='w-full text-xs'>
              <thead className='text-left opacity-70'>
                <tr><th className='py-1 pr-3'>Slot</th><th className='py-1 pr-3'>Obs</th><th className='py-1 pr-3'>Avg Δ60m %</th><th className='py-1 pr-3'>Avg Δ30m %</th><th className='py-1 pr-3'>Avg Δ15m %</th><th className='py-1 pr-3'>Avg Δ5m %</th></tr>
              </thead>
              <tbody>
                {agg.map(a => (
                  <tr key={a.slot} className='border-t border-neutral-800'>
                    <td className='py-1 pr-3'>{a.slot}</td>
                    <td className='py-1 pr-3'>{a.n}</td>
                    <td className='py-1 pr-3'>{a.a60==null?'—':a.a60.toFixed(3)}</td>
                    <td className='py-1 pr-3'>{a.a30==null?'—':a.a30.toFixed(3)}</td>
                    <td className='py-1 pr-3'>{a.a15==null?'—':a.a15.toFixed(3)}</td>
                    <td className='py-1 pr-3'>{a.a5==null?'—':a.a5.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {err && <div className='mt-4 text-red-300 text-xs break-words'>Error: {err}</div>}

      <footer className='mt-8 opacity-60 text-xs'>
        Funding cadence auto-detect uses Kraken tickers when available; otherwise aligns to 4h/8h UTC grids. Default lookback window is 16 hours.
      </footer>
    </div>
  )
}