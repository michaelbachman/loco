
export type Ohlc = { time:number; open:number; high:number; low:number; close:number; volume?:number }
function sleep(ms:number){ return new Promise(r=>setTimeout(r,ms)) }

export class BinanceFuturesClient {
  private proxy='/.netlify/functions/binance'
  private fetcher: typeof fetch
  constructor(fetchImpl?: typeof fetch){ const raw=fetchImpl ?? (globalThis as any).fetch; if(!raw) throw new Error('No fetch'); this.fetcher=((i:any,init?:any)=>(raw as any)(i,init)) as any }
  private async get<T>(path:string, params?:Record<string,any>, retries=2): Promise<T> {
    const qs=new URLSearchParams(); if(params) for(const [k,v] of Object.entries(params)) if(v!==undefined&&v!==null) qs.set(k,String(v))
    const url = `${this.proxy}?path=${encodeURIComponent(path)}&qs=${encodeURIComponent(qs.toString())}`
    for(let i=0;i<=retries;i++){ const r=await this.fetcher(url,{headers:{Accept:'application/json'}}); if(r.ok) return r.json() as Promise<T>; if(i===retries){const t=await r.text().catch(()=> ''); throw new Error(`HTTP ${r.status} ${r.statusText} – ${t}`)}; await sleep(300*(2**i)) }
    throw new Error('unreachable')
  }
  async getKlines(symbol:string, interval:string, opts:{limit?:number; startTime?:number; endTime?:number}={}): Promise<Ohlc[]> {
    const raw = await this.get<any[]>('/fapi/v1/klines', { symbol, interval, limit: opts.limit, startTime: opts.startTime, endTime: opts.endTime })
    return raw.map(k=>({ time:k[6], open:Number(k[1]), high:Number(k[2]), low:Number(k[3]), close:Number(k[4]), volume:Number(k[5]) }))
  }
  async getPremiumIndex(symbol:string){ return this.get<any>('/fapi/v1/premiumIndex', { symbol }) }
  subscribeMark(symbol:string, on:(p:number)=>void){ const ws=new WebSocket(`wss://fstream.binance.com/ws/${symbol.toLowerCase()}@markPrice@1s`); ws.onmessage=(e)=>{ try{ const m=JSON.parse(e.data as string); on(Number(m.p)) }catch{} }; return { close:()=>{ try{ws.close()}catch{} } } }
}
