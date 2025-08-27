import React, { useEffect, useState } from 'react'

type Ohlc = { t:number; close:number }
type DriftRow = {
  t:number; slot:string;
  d60:number|null; d30:number|null; d15:number|null; d5:number|null;
  d60Abs:number|null; d30Abs:number|null; d15Abs:number|null; d5Abs:number|null;
  p1m:number|null; d1m:number|null; d1mAbs:number|null;
  p60:number|null; p30:number|null; p15:number|null; p5:number|null;
  pnl60:number|null; pnl30:number|null; pnl15:number|null; pnl5:number|null;
  exit60:number|null; exit30:number|null; exit15:number|null; exit5:number|null;
  source?:string
}

function useLocalStorage<T>(key:string, initial:T){
  const [v,setV] = useState<T>(()=>{
    try{ const s = localStorage.getItem(key); return s? JSON.parse(s) as T : initial }catch{ return initial }
  })
  useEffect(()=>{ try{ localStorage.setItem(key, JSON.stringify(v)) }catch{} }, [key,v])
  return [v,setV] as const
}

const SYMBOL = 'XBTUSD'

function nearestBarBefore(bars:Ohlc[], t:number){ 
  let lo=0, hi=bars.length-1, ans:Ohlc|undefined
  while(lo<=hi){
    const mid=(lo+hi)>>1
    const b=bars[mid]
    if(b.t<=t){ ans=b; lo=mid+1 } else hi=mid-1
  }
  return ans
}
const pct = (end:number, beg:number)=> ( (end - beg) / beg ) * 100

function formatSlotLabel(h:number){
  const grid = ['00:00','04:00','08:00','12:00','16:00','20:00']
  return grid[Math.floor((h%24)/4)]
}

async function fetchSpotBars(hours:number): Promise<Ohlc[]>{
  const sinceSec = Math.floor( (Date.now() - hours*3600*1000)/1000 )
  const url = `/.netlify/functions/kraken?path=spot_ohlc&pair=XBTUSD&interval=1&since=${sinceSec}`
  const r = await fetch(url)
  if(!r.ok) throw new Error(`HTTP ${r.status}`)
  const j = await r.json()
  const arr:number[][] = j.result?.XBTUSD ?? j.result?.XXBTZUSD ?? []
  return arr.map(row=>({ t: row[0]*1000, close: Number(row[4]) })).sort((a,b)=>a.t-b.t)
}

function fundingCloses(hours:number){
  const end = Date.now()
  const start = end - hours*3600*1000
  const closes:number[] = []
  const fourH = 4*3600*1000
  const startAligned = Math.floor(start / fourH) * fourH
  for(let t=startAligned; t<=end; t+=fourH) if(t>=start) closes.push(t)
  return closes
}

type SizingMode = 'notional'|'margin'

function computeRows(bars:Ohlc[], closes:number[], sizePct:number, leverage:number, targetUsd:number, sizingMode:SizingMode): DriftRow[] {
  const wins=[60,30,15,5]
  return closes.map(t=>{
    const end = nearestBarBefore(bars, t)
    const oneMin = nearestBarBefore(bars, t - 1*60*1000)
    const slot = formatSlotLabel(new Date(t).getUTCHours())
    const r: DriftRow = { t, slot,
      d60:null,d30:null,d15:null,d5:null,
      d60Abs:null,d30Abs:null,d15Abs:null,d5Abs:null,
      p1m:null,d1m:null,d1mAbs:null,
      p60:null,p30:null,p15:null,p5:null,
      pnl60:null,pnl30:null,pnl15:null,pnl5:null,
      exit60:null,exit30:null,exit15:null,exit5:null,
      source:'kraken-spot' }
    if(oneMin){ r.p1m = oneMin.close }
    if(end){
      for(const m of wins){
        const beg = nearestBarBefore(bars, t - m*60*1000)
        if(beg){
          const pc = pct(end.close, beg.close)
          const usd = end.close - beg.close
          const qty = sizingMode==='notional' ? (sizePct/100) : (sizePct/100)*leverage // BTC qty
          const pnl = qty * usd
          const exitTarget = beg.close + (targetUsd/qty)
          if(m===60){ r.d60=pc; r.d60Abs=usd; r.p60=beg.close; r.pnl60=pnl; r.exit60=exitTarget }
          if(m===30){ r.d30=pc; r.d30Abs=usd; r.p30=beg.close; r.pnl30=pnl; r.exit30=exitTarget }
          if(m===15){ r.d15=pc; r.d15Abs=usd; r.p15=beg.close; r.pnl15=pnl; r.exit15=exitTarget }
          if(m===5){ r.d5=pc; r.d5Abs=usd; r.p5=beg.close; r.pnl5=pnl; r.exit5=exitTarget }
        }
      }
      if(oneMin){ r.d1m = pct(end.close, oneMin.close); r.d1mAbs = end.close - oneMin.close }
    }
    return r
  })
}

function exportCsvRows(rows:DriftRow[], name:string, cfg:{sizePct:number; leverage:number; targetUsd:number; sizingMode:SizingMode}){
  const header='funding_close_utc,slot,t_minus_1m_price,size_pct,leverage,target_usd,sizing_mode,delta1m_pct,delta1m_usd,delta60_pct,delta60_usd,buyin60,pnl60,exit60_target,delta30_pct,delta30_usd,buyin30,pnl30,exit30_target,delta15_pct,delta15_usd,buyin15,pnl15,exit15_target,delta5_pct,delta5_usd,buyin5,pnl5,exit5_target,source'
  const lines = rows.map(r=>[
    new Date(r.t).toISOString(), r.slot, r.p1m??'',
    cfg.sizePct, cfg.leverage, cfg.targetUsd, cfg.sizingMode,
    r.d1m??'', r.d1mAbs??'',
    r.d60??'', r.d60Abs??'', r.p60??'', r.pnl60??'', r.exit60??'',
    r.d30??'', r.d30Abs??'', r.p30??'', r.pnl30??'', r.exit30??'',
    r.d15??'', r.d15Abs??'', r.p15??'', r.pnl15??'', r.exit15??'',
    r.d5??'', r.d5Abs??'', r.p5??'', r.pnl5??'', r.exit5??'',
    r.source??''
  ].join(','))
  const blob = new Blob([header + '\n' + lines.join('\n')], {type:'text/csv'})
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(()=> URL.revokeObjectURL(a.href), 2000)
}

type DriftCellProps = {
  pct:number|null; usd:number|null; buy:number|null;
  sizePct:number; leverage:number; targetUsd:number; sizingMode:SizingMode
}
const DriftCell: React.FC<DriftCellProps> = ({ pct, usd, buy, sizePct, leverage, targetUsd, sizingMode }) => {
  if (pct==null) return <>—</>;
  const qty = sizingMode==='notional' ? (sizePct/100) : (sizePct/100)*leverage; // BTC qty
  const pnl = (usd==null) ? null : qty * usd;
  const exit = (buy==null || qty===0) ? null : buy + (targetUsd/qty);
  const notional = (buy==null) ? null : buy * qty;
  const margin = (buy==null) ? null : (sizingMode==='notional' ? (buy * qty)/Math.max(1, leverage) : buy * (sizePct/100));
  const disabled = (buy==null) || (pnl==null) || (exit==null);
  const tt = `mode=${sizingMode}; qty=${qty.toFixed(4)} BTC; notional=$${notional?.toFixed(2) ?? '—'}; margin=$${margin?.toFixed(2) ?? '—'}; pnl=qty*Δ$; exit=entry+target/qty`;
  return (
    <div>
      <div>{`${pct.toFixed(3)}% ($${(usd ?? 0).toFixed(2)})`}</div>
      <div className={disabled ? 'sub muted' : 'sub'} title={tt}>
        {buy==null ? '' :
          `Buy @$${Number(buy).toLocaleString(undefined,{maximumFractionDigits:2})} • ` +
          (pnl==null ? '' : `PnL $${pnl.toFixed(2)} • `) +
          (notional==null ? '' : `Notional $${notional.toFixed(2)} • `) +
          (margin==null ? '' : `Margin $${margin.toFixed(2)} • `) +
          (exit==null ? '' : `Exit @$${Number(exit).toLocaleString(undefined,{maximumFractionDigits:2})}`)
        }
      </div>
    </div>
  );
}

export default function App(){
  const [hours, setHours] = useLocalStorage<number>('hours', 16)
  const [sizingMode, setSizingMode] = useLocalStorage<'notional'|'margin'>('trade_sizing_mode','notional')
  const [sizePct, setSizePct] = useLocalStorage<number>('trade_size_pct', 1)
  const [leverage, setLeverage] = useLocalStorage<number>('trade_leverage', 5)
  const [targetUsd, setTargetUsd] = useLocalStorage<number>('trade_target_usd', 100)
  const [rows, setRows] = useState<DriftRow[]|null>(null)
  const [mark, setMark] = useState<number|null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(()=>{
    let stop=false
    async function poll(){
      try{
        const r = await fetch('/.netlify/functions/kraken?path=spot_ticker&pair=XBTUSD')
        const j = await r.json()
        const p = Number(j.result?.XXBTZUSD?.c?.[0] ?? j.result?.XBTUSD?.c?.[0])
        if(!Number.isNaN(p) && !stop) setMark(p)
      }catch{}
      if(!stop) setTimeout(poll, 5000)
    }
    poll()
    return ()=>{ stop=true }
  }, [])

  function fundingCloses(hours:number){
    const end = Date.now()
    const start = end - hours*3600*1000
    const closes:number[] = []
    const fourH = 4*3600*1000
    const startAligned = Math.floor(start / fourH) * fourH
    for(let t=startAligned; t<=end; t+=fourH) if(t>=start) closes.push(t)
    return closes
  }

  async function run(){
    setLoading(true)
    try{
      const bars = await fetchSpotBars(hours)
      const closes = fundingCloses(hours)
      setRows( computeRows(bars, closes, sizePct, leverage, targetUsd, sizingMode) )
    }finally{
      setLoading(false)
    }
  }

  useEffect(()=>{ run() }, [hours, sizePct, leverage, targetUsd, sizingMode])

  return (
    <div className="wrap">
      <div className="row" style={{marginBottom:12}}>
        <div className="card" style={{display:'flex',gap:12,alignItems:'center'}}>
          <strong>Kraken Drift Simulator</strong>
          <span className="muted">Symbol:</span> <code>{SYMBOL}</code>
          <span className="muted">Live mark:</span> <code>{mark? mark.toLocaleString(undefined,{maximumFractionDigits:2}) : '—'}</code>
        </div>
        <div className="row" style={{marginLeft:'auto', gap:12}}>
          <label>Hours
            <input type="number" min={4} max={72} step={1} value={hours} onChange={e=>setHours(Number(e.target.value)||16)} />
          </label>
          <label>Sizing Mode
            <select value={sizingMode} onChange={e=>setSizingMode(e.target.value as any)}>
              <option value='notional'>Notional (% of 1 BTC)</option>
              <option value='margin'>Margin (% × leverage)</option>
            </select>
          </label>
          <label>Size %% of 1 BTC
            <input type="number" min={0.1} step={0.1} max={100} value={sizePct} onChange={e=>setSizePct(Number(e.target.value)||1)} />
          </label>
          <label>Leverage ×
            <input type="number" min={1} step={1} max={125} value={leverage} onChange={e=>setLeverage(Number(e.target.value)||1)} />
          </label>
          <label>Target $
            <input type="number" min={10} step={10} value={targetUsd} onChange={e=>setTargetUsd(Number(e.target.value)||100)} />
          </label>
          <button className="btn" onClick={run} disabled={loading}>{loading?'Loading…':'Refresh'}</button>
          <button className="btn" onClick={()=> rows && exportCsvRows(rows,'kraken_drift_rows.csv',{sizePct, leverage, targetUsd, sizingMode})} disabled={!rows}>Export CSV</button>
        </div>
      </div>

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Funding Close (UTC)</th>
              <th>Slot</th>
              <th>T-1m Price</th>
              <th>Δ1m % (USD)</th>
              <th>Δ60m % (USD)</th>
              <th>Δ30m % (USD)</th>
              <th>Δ15m % (USD)</th>
              <th>Δ5m % (USD)</th>
              <th>Src</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map(r=>(
              <tr key={r.t}>
                <td>{new Date(r.t).toISOString().replace('T',' ').slice(0,16)}</td>
                <td>{r.slot}</td>
                <td>{r.p1m==null?'—':r.p1m.toLocaleString(undefined,{maximumFractionDigits:2})}</td>
                <td>{r.d1m==null?'—':`${r.d1m.toFixed(3)}% ($${(r.d1mAbs??0).toFixed(2)})`}</td>
                <td><DriftCell pct={r.d60} usd={r.d60Abs} buy={r.p60} sizePct={sizePct} leverage={leverage} targetUsd={targetUsd} sizingMode={sizingMode} /></td>
                <td><DriftCell pct={r.d30} usd={r.d30Abs} buy={r.p30} sizePct={sizePct} leverage={leverage} targetUsd={targetUsd} sizingMode={sizingMode} /></td>
                <td><DriftCell pct={r.d15} usd={r.d15Abs} buy={r.p15} sizePct={sizePct} leverage={leverage} targetUsd={targetUsd} sizingMode={sizingMode} /></td>
                <td><DriftCell pct={r.d5} usd={r.d5Abs} buy={r.p5} sizePct={sizePct} leverage={leverage} targetUsd={targetUsd} sizingMode={sizingMode} /></td>
                <td>{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
