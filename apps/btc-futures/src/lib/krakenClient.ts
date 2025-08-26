
export type KrakenTicker = {
  symbol: string
  markPrice?: number
  indexPrice?: number
  fundingRate?: number
  nextFundingTime?: number
}

export type KrakenTrade = { time: number; price: number; size?: number }
export type Ohlc = { time: number; open: number; high: number; low: number; close: number; volume?: number }

export class KrakenFuturesClient {
  private proxy: string
  private fetcher: typeof fetch
  constructor(proxy = '/.netlify/functions/kraken', fetchImpl?: typeof fetch) {
    this.proxy = proxy
    const raw = fetchImpl ?? (globalThis as any).fetch
    if (!raw) throw new Error('No fetch available')
    this.fetcher = ((input: any, init?: any) => (raw as any)(input, init)) as any
  }

  private async get<T>(path: string, params?: Record<string, any>): Promise<T> {
    const qs = new URLSearchParams()
    if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) qs.set(k, String(v))
    const url = `${this.proxy}?path=${encodeURIComponent(path)}&qs=${encodeURIComponent(qs.toString())}`
    const r = await this.fetcher(url, { headers: { 'Accept': 'application/json' } })
    if (!r.ok) { const t = await r.text().catch(()=> ''); throw new Error(`HTTP ${r.status} ${r.statusText} – ${t}`) }
    return r.json() as Promise<T>
  }

  async getTickers(): Promise<KrakenTicker[]> {
    const res: any = await this.get('/derivatives/api/v3/tickers')
    const arr = (res?.tickers ?? res?.result ?? res?.data ?? []) as any[]
    return arr.map(t => ({
      symbol: t.symbol || t.product_id || t.pair || '',
      markPrice: Number(t.markPrice ?? t.mark_price ?? t.last ?? t.last_price ?? t.price ?? NaN),
      indexPrice: Number(t.indexPrice ?? t.index_price ?? NaN),
      fundingRate: t.fundingRate !== undefined ? Number(t.fundingRate) : (t.funding_rate !== undefined ? Number(t.funding_rate) : undefined),
      nextFundingTime: t.nextFundingTime ? Number(t.nextFundingTime) : (t.next_funding_time ? Number(t.next_funding_time) : undefined),
    }))
  }

  async getOhlc(symbol: string, interval: string, opts: { since?: number; until?: number } = {}): Promise<Ohlc[]> {
    // Try an OHLC endpoint if available
    try {
      const res: any = await this.get('/derivatives/api/v3/ohlc', { symbol, interval, since: opts.since, until: opts.until })
      const rows = (res?.candles ?? res?.result ?? res?.data ?? []) as any[]
      if (rows.length > 0) {
        return rows.map((c: any) => ({
          time: String(c.time ?? c.t ?? '').length === 10 ? Number(c.time ?? c.t) * 1000 : Number(c.time ?? c.t),
          open: Number(c.open ?? c.o),
          high: Number(c.high ?? c.h),
          low: Number(c.low ?? c.l),
          close: Number(c.close ?? c.c),
          volume: Number(c.volume ?? c.v ?? 0),
        }))
      }
    } catch { /* fall through to trades agg */ }

    // Fallback: pull trades and aggregate to 1m bars (best-effort)
    const trades = await this.getTrades(symbol, opts)
    if (trades.length === 0) return []
    const bucket = new Map<number, { o:number; h:number; l:number; c:number; v:number }>()
    for (const tr of trades) {
      const m = Math.floor(tr.time / 60000) * 60000
      const b = bucket.get(m) ?? { o: tr.price, h: tr.price, l: tr.price, c: tr.price, v: 0 }
      b.h = Math.max(b.h, tr.price)
      b.l = Math.min(b.l, tr.price)
      b.c = tr.price
      b.v += tr.size ?? 0
      if (!bucket.has(m)) bucket.set(m, b)
    }
    return Array.from(bucket.entries()).sort((a,b)=>a[0]-b[0]).map(([t,b]) => ({ time: t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }))
  }

  async getTrades(symbol: string, opts: { since?: number; until?: number } = {}): Promise<KrakenTrade[]> {
    const res: any = await this.get('/derivatives/api/v3/trades', { symbol, since: opts.since, until: opts.until, count: 1000 })
    const rows = (res?.trades ?? res?.result ?? res?.data ?? []) as any[]
    return rows.map((t: any) => ({
      time: String(t.time ?? t.timestamp ?? '').length === 10 ? Number(t.time ?? t.timestamp) * 1000 : Number(t.time ?? t.timestamp),
      price: Number(t.price ?? t.p),
      size: t.size !== undefined ? Number(t.size) : (t.qty !== undefined ? Number(t.qty) : undefined),
    })).filter(x => isFinite(x.time) && isFinite(x.price))
  }
}
