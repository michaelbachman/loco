
export type KrakenTicker = { symbol:string; markPrice?:number; indexPrice?:number; fundingRate?:number; nextFundingTime?:number }
export type KrakenTrade = { time:number; price:number; size?:number }
export type Ohlc = { time:number; open:number; high:number; low:number; close:number; volume?:number }
export type OhlcSource = 'futures.ohlc' | 'futures.trades' | 'spot.ohlc'
export type OhlcResult = { bars: Ohlc[]; source: OhlcSource }

function sleep(ms:number){ return new Promise(r=>setTimeout(r,ms)) }

export class KrakenFuturesClient {
  private proxy = '/.netlify/functions/kraken'
  private spotProxy = '/.netlify/functions/krakenSpot'
  private fetcher: typeof fetch
  constructor(fetchImpl?: typeof fetch){
    const raw = fetchImpl ?? (globalThis as any).fetch
    if(!raw) throw new Error('No fetch available')
    this.fetcher = ((input:any, init?:any)=> (raw as any)(input, init)) as any
  }
  private async get<T>(path:string, params?:Record<string,any>, retries=2): Promise<T> {
    const qs = new URLSearchParams(); if(params) for(const [k,v] of Object.entries(params)) if(v!==undefined&&v!==null) qs.set(k,String(v))
    const url = `${this.proxy}?path=${encodeURIComponent(path)}&qs=${encodeURIComponent(qs.toString())}`
    for(let i=0;i<=retries;i++){
      const r = await this.fetcher(url,{headers:{Accept:'application/json'}})
      if(r.ok) return r.json() as Promise<T>
      if(i===retries) { const t=await r.text().catch(()=> ''); throw new Error(`HTTP ${r.status} ${r.statusText} – ${t}`) }
      await sleep(300*(2**i))
    }
    throw new Error('unreachable')
  }
  private async getSpot<T>(path:string, params?:Record<string,any>, retries=2): Promise<T> {
    const qs = new URLSearchParams(); if(params) for(const [k,v] of Object.entries(params)) if(v!==undefined&&v!==null) qs.set(k,String(v))
    const url = `${this.spotProxy}?path=${encodeURIComponent(path)}&qs=${encodeURIComponent(qs.toString())}`
    for(let i=0;i<=retries;i++){
      const r = await this.fetcher(url,{headers:{Accept:'application/json'}})
      if(r.ok) return r.json() as Promise<T>
      if(i===retries) { const t=await r.text().catch(()=> ''); throw new Error(`SPOT HTTP ${r.status} ${r.statusText} – ${t}`) }
      await sleep(300*(2**i))
    }
    throw new Error('unreachable')
  }
  async getTickers(): Promise<KrakenTicker[]> {
    const res:any = await this.get('/derivatives/api/v3/tickers')
    const arr = (res?.tickers ?? res?.result ?? res?.data ?? []) as any[]
    return arr.map((t:any)=>({
      symbol: t.symbol || t.product_id || t.pair || '',
      markPrice: Number(t.markPrice ?? t.mark_price ?? t.last ?? t.last_price ?? t.price ?? NaN),
      indexPrice: Number(t.indexPrice ?? t.index_price ?? NaN),
      fundingRate: t.fundingRate !== undefined ? Number(t.fundingRate) : (t.funding_rate !== undefined ? Number(t.funding_rate) : undefined),
      nextFundingTime: t.nextFundingTime ? Number(t.nextFundingTime) : (t.next_funding_time ? Number(t.next_funding_time) : undefined),
    }))
  }
  async getTrades(symbol:string, opts:{since?:number; until?:number}={}): Promise<KrakenTrade[]> {
    const res:any = await this.get('/derivatives/api/v3/trades', {symbol, since:opts.since, until:opts.until, count:1000})
    const rows = (res?.trades ?? res?.result ?? res?.data ?? []) as any[]
    return rows.map((t:any)=>({
      time: String(t.time ?? t.timestamp ?? '').length===10 ? Number(t.time ?? t.timestamp)*1000 : Number(t.time ?? t.timestamp),
      price: Number(t.price ?? t.p),
      size: t.size!==undefined ? Number(t.size) : (t.qty!==undefined? Number(t.qty): undefined),
    })).filter((x:KrakenTrade)=> isFinite(x.time) && isFinite(x.price))
  }
  async getSpotOhlc(pair:string, intervalMin:number, since?:number): Promise<Ohlc[]> {
    const res:any = await this.getSpot('/0/public/OHLC', {pair, interval:intervalMin, since: since? Math.floor(since/1000): undefined})
    const firstKey = Object.keys(res?.result||{}).find(k=>k!=='last'); const rows: any[] = firstKey ? (res.result[firstKey]||[]) : []
    return rows.map((r:any[])=>({
      time: Number(r[0])*1000, open:Number(r[1]), high:Number(r[2]), low:Number(r[3]), close:Number(r[4]), volume:Number(r[6]||0)
    }))
  }
  async getOhlc(symbol:string, interval:string, opts:{since?:number; until?:number}={}): Promise<OhlcResult> {
    // Futures OHLC
    try{
      const res:any = await this.get('/derivatives/api/v3/ohlc', {symbol, interval, since:opts.since, until:opts.until})
      const rows = (res?.candles ?? res?.result ?? res?.data ?? []) as any[]
      if(rows.length>0){
        const bars = rows.map((c:any)=>({
          time: String(c.time ?? c.t ?? '').length===10 ? Number(c.time ?? c.t)*1000 : Number(c.time ?? c.t),
          open:Number(c.open ?? c.o), high:Number(c.high ?? c.h), low:Number(c.low ?? c.l), close:Number(c.close ?? c.c), volume:Number(c.volume ?? c.v ?? 0)
        }))
        return { bars, source:'futures.ohlc' }
      }
    }catch{}
    // Futures trades -> 1m
    try{
      const trades = await this.getTrades(symbol, opts)
      if(trades.length>0){
        const bucket = new Map<number, {o:number;h:number;l:number;c:number;v:number}>()
        for(const tr of trades){
          const m=Math.floor(tr.time/60000)*60000
          const b=bucket.get(m) ?? {o:tr.price,h:tr.price,l:tr.price,c:tr.price,v:0}
          b.h=Math.max(b.h,tr.price); b.l=Math.min(b.l,tr.price); b.c=tr.price; b.v+=tr.size??0
          if(!bucket.has(m)) bucket.set(m,b)
        }
        const bars = Array.from(bucket.entries()).sort((a,b)=>a[0]-b[0]).map(([t,b])=>({time:t, open:b.o, high:b.h, low:b.l, close:b.c, volume:b.v}))
        return { bars, source:'futures.trades' }
      }
    }catch{}
    // Spot OHLC fallback
    const bars = await this.getSpotOhlc('XBTUSD', 1, opts.since)
    return { bars, source:'spot.ohlc' }
  }
}
