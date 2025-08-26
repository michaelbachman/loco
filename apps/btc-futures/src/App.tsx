
import React, { useEffect, useMemo, useRef, useState } from 'react'
import './index.css'
import { KrakenFuturesClient, OhlcResult } from './lib/krakenClient'
import { BinanceFuturesClient } from './lib/binanceClient'
import { Ohlc, pct, closesInRange, nearestBarBefore } from './lib/util'

const kraken = new KrakenFuturesClient()
const binance = new BinanceFuturesClient()

type DriftRow = { t:number; slot:string; d60:number|null; d30:number|null; d15:number|null; d5:number|null; source?:string }

function formatSlotLabel(h:number, interval:number){
  if(interval===8) return h%24===0?'00:00':h%24===8?'08:00':'16:00'
  return (h%24).toString().padStart(2,'0')+':00'
}

function computeRows(bars:Ohlc[], closes:number[], interval:number, source?:string): DriftRow[] {
  const wins=[60,30,15,5]
  return closes.map(t=>{
    const end=nearestBarBefore(bars,t)
    const slot = formatSlotLabel(new Date(t).getUTCHours(), interval)
    const r: DriftRow = { t, slot, d60:null, d30:null, d15:null, d5:null, source }
    if(end){
      for(const m of wins){
        const beg=nearestBarBefore(bars, t - m*60*1000)
        if(beg){
          const pc=pct(end.close, beg.close)
          if(m===60) r.d60=pc; if(m===30) r.d30=pc; if(m===15) r.d15=pc; if(m===5) r.d5=pc
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
  const header='funding_close_utc,slot,delta60_pct,delta30_pct,delta15_pct,delta5_pct,source'
  const lines = rows.map(r=>[new Date(r.t).toISOString(), r.slot, r.d60??'', r.d30??'', r.d15??'', r.d5??'', r.source??''].join(','))
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
  const [hours, setHours] = useLocalStorage<number>('hours', 24)
  const [krSymbol, setKrSymbol] = useLocalStorage<string>('kr_symbol', 'PI_XBTUSD')
  const [bzSymbol, setBzSymbol] = useLocalStorage<string>('bz_symbol', 'BTCUSDT')
  const [intervalMode, setIntervalMode] = useLocalStorage<'auto'|'manual'>('interval_mode','auto')
  const [manualInterval, setManualInterval] = useLocalStorage<number>('manual_interval', 4)

  const [krInterval, setKrInterval] = useState<number>(4) // autodetected later
  const [bzInterval, setBzInterval] = useState<number>(8)

  const [krMark, setKrMark] = useState<number|undefined>(undefined)
  const [bzMark, setBzMark] = useState<number|undefined>(undefined)

  const [krStatus, setKrStatus] = useState<'idle'|'fetching'|'ok'|'error'>('idle')
  const [bzStatus, setBzStatus] = useState<'idle'|'fetching'|'ok'|'error'>('idle')

  const [krRows, setKrRows] = useState<DriftRow[]|null>(null)
  const [bzRows, setBzRows] = useState<DriftRow[]|null>(null)
  const [krAgg, setKrAgg] = useState<any[]|null>(null)
  const [bzAgg, setBzAgg] = useState<any[]|null>(null)
  const [err, setErr] = useState<string|nil>(null as any)

  // Live marks
  useEffect(()=>{
    // Kraken WS
    const ws = new WebSocket('wss://futures.kraken.com/ws/v1')
    ws.onopen = ()=> ws.send(JSON.stringify({ event:'subscribe', feed:'ticker', product_ids:[krSymbol] }))
    ws.onmessage = (e)=> { try{ const m=JSON.parse(e.data as string); if(m.feed==='ticker' && m.product_id===krSymbol){ const p = Number(m.markPrice ?? m.last ?? m.price); if(!Number.isNaN(p)) setKrMark(p) } }catch{} }
    ws.onerror = ()=>{}; ws.onclose=()=>{}
    return ()=>{ try{ws.close()}catch{} }
  },[krSymbol])

  useEffect(()=>{
    const sub = binance.subscribeMark(bzSymbol, (p)=> setBzMark(p))
    return ()=> sub.close()
  },[bzSymbol])

  // Autodetect funding interval
  useEffect(()=>{ (async()=>{
    if(intervalMode==='manual'){ setKrInterval(manualInterval); setBzInterval(manualInterval===4?8:8); return }
    try{
      const [krt, bpi] = await Promise.allSettled([ kraken.getTickers(), binance.getPremiumIndex(bzSymbol) ])
      // Kraken: infer 4h if nextFundingTime aligns better with 4h grid
      let kInt = 4
      if(krt.status==='fulfilled'){
        const item = krt.value.find(t=>t.symbol===krSymbol)
        const nft = item?.nextFundingTime
        if(nft){
          const now = Date.now()
          const deltas = [4,8].map(h=> Math.abs(nextBoundary(now,h)-nft))
          kInt = deltas[0] <= deltas[1] ? 4 : 8
        }
      }
      setKrInterval(kInt)
      // Binance: default 8h; validate via premiumIndex
      let bInt = 8
      if(bpi.status==='fulfilled'){
        const nft = Number(bpi.value?.nextFundingTime ?? 0)
        if(nft){
          const now = Date.now()
          const deltas = [4,8].map(h=> Math.abs(nextBoundary(now,h)-nft))
          bInt = deltas[0] < deltas[1] ? 4 : 8
        }
      }
      setBzInterval(bInt)
    }catch{}
  })() },[intervalMode, manualInterval, krSymbol, bzSymbol])

  // Fetch + compute drift
  useEffect(()=>{ (async()=>{
    setErr(null as any)
    const end=Date.now(), start=end - hours*3600*1000
    // Kraken
    try{
      setKrStatus('fetching')
      const kr = await kraken.getOhlc(krSymbol, '1m', { since: start - 70*60*1000, until: end })
      const kcl = closesInRange(start,end, krInterval)
      const krows = computeRows(kr.bars, kcl, krInterval, kr.source)
      setKrRows(krows); setKrAgg(aggregate(krows, krInterval===8? ['00:00','08:00','16:00']: ['00:00','04:00','08:00','12:00','16:00','20:00'])); setKrStatus('ok')
    }catch(e:any){ setKrStatus('error'); setErr(String(e?.message||e)) }

    // Binance
    try{
      setBzStatus('fetching')
      const bars = await binance.getKlines(bzSymbol, '1m', { startTime: start - 70*60*1000, endTime: end, limit: 2000 })
      const bcl = closesInRange(start,end, bzInterval)
      const brows = computeRows(bars, bcl, bzInterval, 'futures.ohlc')
      setBzRows(brows); setBzAgg(aggregate(brows, bzInterval===8? ['00:00','08:00','16:00']: ['00:00','04:00','08:00','12:00','16:00','20:00'])); setBzStatus('ok')
    }catch(e:any){ setBzStatus('error'); setErr(prev=> (prev? prev+' | ': '') + String(e?.message||e)) }
  })() },[hours, krSymbol, bzSymbol, krInterval, bzInterval])

  const now = Date.now()
  const krNext = nextBoundary(now, krInterval)
  const bzNext = nextBoundary(now, bzInterval)
  const [tick, setTick] = useState(0)
  useEffect(()=>{ const t=setInterval(()=>setTick(x=>x+1), 1000); return ()=>clearInterval(t) },[])

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
        <h1 className='text-3xl' style={{ fontFamily:'Creepster, system-ui' }}>Futures Drift — Kraken vs Binance</h1>
        <div className='flex items-center gap-2 text-xs'>
          <span>Kraken</span>{statusChip(krStatus)}
          <span>Binance</span>{statusChip(bzStatus)}
        </div>
      </header>

      <div className='text-xs opacity-70 mb-2'>Data: Kraken Futures (falls back to Spot if needed) & Binance Futures. Drift into funding closes; 1m bars.</div>

      <div className='grid md:grid-cols-2 gap-4 mb-4'>
        <div className='rounded-2xl p-4 bg-neutral-800/60'>
          <div className='flex items-center justify-between mb-2'>
            <div className='font-semibold'>Kraken</div>
            <div className='text-xs opacity-80'>Next: {new Date(krNext).toUTCString()} ({formatCountdown(krNext - Date.now())})</div>
          </div>
          <div className='flex flex-wrap items-end gap-2 text-sm'>
            <label>Symbol
              <select value={krSymbol} onChange={e=>setKrSymbol(e.target.value)} className='ml-2 bg-neutral-800 border border-neutral-700 rounded px-2 py-1'>
                <option>PI_XBTUSD</option>
                <option>PI_ETHUSD</option>
              </select>
            </label>
            <div className='opacity-80'>Mark: {krMark? krMark.toLocaleString(): '—'}</div>
            <div className='opacity-80'>Interval: {intervalMode==='auto'? (krInterval+'h (auto)') : (manualInterval+'h')}</div>
            <div className='opacity-80'>Rows: {krRows?.length ?? 0}</div>
          </div>
        </div>

        <div className='rounded-2xl p-4 bg-neutral-800/60'>
          <div className='flex items-center justify-between mb-2'>
            <div className='font-semibold'>Binance</div>
            <div className='text-xs opacity-80'>Next: {new Date(bzNext).toUTCString()} ({formatCountdown(bzNext - Date.now())})</div>
          </div>
          <div className='flex flex-wrap items-end gap-2 text-sm'>
            <label>Symbol
              <select value={bzSymbol} onChange={e=>setBzSymbol(e.target.value)} className='ml-2 bg-neutral-800 border border-neutral-700 rounded px-2 py-1'>
                <option>BTCUSDT</option>
                <option>ETHUSDT</option>
              </select>
            </label>
            <div className='opacity-80'>Mark: {bzMark? bzMark.toLocaleString(): '—'}</div>
            <div className='opacity-80'>Interval: {intervalMode==='auto'? (bzInterval+'h (auto)') : (manualInterval+'h')}</div>
            <div className='opacity-80'>Rows: {bzRows?.length ?? 0}</div>
          </div>
        </div>
      </div>

      <div className='rounded-2xl p-4 bg-neutral-800/60 mb-4'>
        <div className='flex flex-wrap items-end gap-3 text-sm'>
          <label>Hours
            <input type='number' min={1} max={72} value={hours} onChange={e=>setHours(Number(e.target.value))} className='ml-2 w-24 bg-neutral-800 border border-neutral-700 rounded px-2 py-1' />
          </label>
          <label>Funding Interval
            <select value={intervalMode} onChange={e=>setIntervalMode(e.target.value as any)} className='ml-2 bg-neutral-800 border border-neutral-700 rounded px-2 py-1'>
              <option value='auto'>Auto-detect per venue</option>
              <option value='manual'>Manual</option>
            </select>
          </label>
          {intervalMode==='manual' && (
            <select value={manualInterval} onChange={e=>setManualInterval(Number(e.target.value))} className='bg-neutral-800 border border-neutral-700 rounded px-2 py-1'>
              <option value={4}>4h</option>
              <option value={8}>8h</option>
            </select>
          )}
          <div className='ml-auto flex gap-2'>
            <button onClick={()=> krRows && exportCsvRows(krRows,'kraken_drift_rows.csv')} className='px-3 py-1.5 rounded bg-neutral-100 text-neutral-900 disabled:opacity-50' disabled={!krRows || krRows.length===0}>Export Kraken Rows</button>
            <button onClick={()=> krAgg && exportCsvAgg(krAgg,'kraken_drift_agg.csv')} className='px-3 py-1.5 rounded bg-neutral-100 text-neutral-900 disabled:opacity-50' disabled={!krAgg || krAgg.length===0}>Export Kraken Aggregates</button>
            <button onClick={()=> bzRows && exportCsvRows(bzRows,'binance_drift_rows.csv')} className='px-3 py-1.5 rounded bg-neutral-100 text-neutral-900 disabled:opacity-50' disabled={!bzRows || bzRows.length===0}>Export Binance Rows</button>
            <button onClick={()=> bzAgg && exportCsvAgg(bzAgg,'binance_drift_agg.csv')} className='px-3 py-1.5 rounded bg-neutral-100 text-neutral-900 disabled:opacity-50' disabled={!bzAgg || bzAgg.length===0}>Export Binance Aggregates</button>
          </div>
        </div>
      </div>

      <div className='grid md:grid-cols-2 gap-4'>
        <div className='rounded-2xl p-4 bg-neutral-800/60'>
          <div className='opacity-80 mb-2'>Kraken — Per-event drift (source: {krRows && krRows[0]?.source || '—'})</div>
          {krRows && krRows.length>0 ? (
            <div className='overflow-x-auto'>
              <table className='w-full text-xs'>
                <thead className='text-left opacity-70'>
                  <tr><th className='py-1 pr-3'>Funding Close (UTC)</th><th className='py-1 pr-3'>Slot</th><th className='py-1 pr-3'>Δ60m %</th><th className='py-1 pr-3'>Δ30m %</th><th className='py-1 pr-3'>Δ15m %</th><th className='py-1 pr-3'>Δ5m %</th><th className='py-1 pr-3'>Src</th></tr>
                </thead>
                <tbody>
                  {krRows.map(r => (
                    <tr key={r.t} className='border-t border-neutral-800'>
                      <td className='py-1 pr-3'>{new Date(r.t).toUTCString()}</td>
                      <td className='py-1 pr-3'>{r.slot}</td>
                      <td className='py-1 pr-3'>{r.d60==null?'—':r.d60.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{r.d30==null?'—':r.d30.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{r.d15==null?'—':r.d15.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{r.d5==null?'—':r.d5.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{r.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div>No funding closes in range. Increase Hours.</div>}
          <div className='opacity-80 mt-3 mb-1'>Kraken — Aggregated by slot</div>
          {krAgg && (
            <div className='overflow-x-auto'>
              <table className='w-full text-xs'>
                <thead className='text-left opacity-70'>
                  <tr><th className='py-1 pr-3'>Slot</th><th className='py-1 pr-3'>Obs</th><th className='py-1 pr-3'>Avg Δ60m %</th><th className='py-1 pr-3'>Avg Δ30m %</th><th className='py-1 pr-3'>Avg Δ15m %</th><th className='py-1 pr-3'>Avg Δ5m %</th></tr>
                </thead>
                <tbody>
                  {krAgg.map(a => (
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

        <div className='rounded-2xl p-4 bg-neutral-800/60'>
          <div className='opacity-80 mb-2'>Binance — Per-event drift</div>
          {bzRows && bzRows.length>0 ? (
            <div className='overflow-x-auto'>
              <table className='w-full text-xs'>
                <thead className='text-left opacity-70'>
                  <tr><th className='py-1 pr-3'>Funding Close (UTC)</th><th className='py-1 pr-3'>Slot</th><th className='py-1 pr-3'>Δ60m %</th><th className='py-1 pr-3'>Δ30m %</th><th className='py-1 pr-3'>Δ15m %</th><th className='py-1 pr-3'>Δ5m %</th></tr>
                </thead>
                <tbody>
                  {bzRows.map(r => (
                    <tr key={r.t} className='border-t border-neutral-800'>
                      <td className='py-1 pr-3'>{new Date(r.t).toUTCString()}</td>
                      <td className='py-1 pr-3'>{r.slot}</td>
                      <td className='py-1 pr-3'>{r.d60==null?'—':r.d60.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{r.d30==null?'—':r.d30.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{r.d15==null?'—':r.d15.toFixed(3)}</td>
                      <td className='py-1 pr-3'>{r.d5==null?'—':r.d5.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div>No funding closes in range. Increase Hours.</div>}
          <div className='opacity-80 mt-3 mb-1'>Binance — Aggregated by slot</div>
          {bzAgg && (
            <div className='overflow-x-auto'>
              <table className='w-full text-xs'>
                <thead className='text-left opacity-70'>
                  <tr><th className='py-1 pr-3'>Slot</th><th className='py-1 pr-3'>Obs</th><th className='py-1 pr-3'>Avg Δ60m %</th><th className='py-1 pr-3'>Avg Δ30m %</th><th className='py-1 pr-3'>Avg Δ15m %</th><th className='py-1 pr-3'>Avg Δ5m %</th></tr>
                </thead>
                <tbody>
                  {bzAgg.map(a => (
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
      </div>

      {err && <div className='mt-4 text-red-300 text-xs break-words'>Error: {err}</div>}

      <footer className='mt-8 opacity-60 text-xs'>
        Autodetect funding interval uses nextFundingTime when available; otherwise aligns to 4h/8h UTC grids. Data is heuristic; trade carefully.
      </footer>
    </div>
  )
}
