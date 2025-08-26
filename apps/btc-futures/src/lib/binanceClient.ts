export type MarketKind = "usdt" | "coin";

export interface BinanceClientConfig {
  usdtRestBase?: string;
  coinRestBase?: string;
  usdtWsBase?: string;
  coinWsBase?: string;
  useProxy?: boolean;
  proxyUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface MarkPriceData { symbol: string; markPrice: string; indexPrice: string; estimatedSettlePrice?: string; lastFundingRate?: string; nextFundingTime?: number; time: number; }
export interface FundingRateItem { symbol: string; fundingRate: string; fundingTime: number; }
export type RawKlineTuple = [number,string,string,string,string,string,number,string,number,string,string,string];
export interface NormalizedKline { openTime: number; open: number; high: number; low: number; close: number; volume: number; closeTime: number; quoteVolume: number; trades: number; takerBuyBase: number; takerBuyQuote: number; }
export interface ExchangeInfoSymbol { symbol: string; pair?: string; contractType?: string; deliveryDate?: number; baseAsset?: string; quoteAsset?: string; marginAsset?: string; pricePrecision?: number; quantityPrecision?: number; filters?: Array<{ filterType: string; [k: string]: any }>; }
export interface DeliveryContractBrief { symbol: string; pair: string; contractType: string; deliveryDate: number; }

function decimalsFromStep(stepStr: string): number { if (!stepStr || typeof stepStr !== 'string') return 0; const dotIdx = stepStr.indexOf('.'); if (dotIdx === -1) return 0; return stepStr.slice(dotIdx + 1).replace(/0+$/, '').length; }
function quantizeToStep(val: number, stepStr: string): number { const step = Number(stepStr); if (!isFinite(step) || step <= 0) return val; const q = Math.floor(val / step) * step; const d = decimalsFromStep(stepStr); return Number(q.toFixed(d)); }

export class BinanceFuturesClient {
  private cfg: Required<BinanceClientConfig>;
  private fetcher: typeof fetch;
  private symbolInfoCache: Map<string, ExchangeInfoSymbol> = new Map();
  constructor(cfg: BinanceClientConfig = {}) {
    this.cfg = {
      usdtRestBase: cfg.usdtRestBase ?? "https://fapi.binance.com",
      coinRestBase: cfg.coinRestBase ?? "https://dapi.binance.com",
      usdtWsBase: cfg.usdtWsBase ?? "wss://fstream.binance.com/ws",
      coinWsBase: cfg.coinWsBase ?? "wss://dstream.binance.com/ws",
      useProxy: cfg.useProxy ?? true,
      proxyUrl: cfg.proxyUrl ?? "/.netlify/functions/binance",
      fetchImpl: cfg.fetchImpl ?? fetch,
      timeoutMs: cfg.timeoutMs ?? 12_000,
    } as Required<BinanceClientConfig>;

    this.fetcher = this.cfg.fetchImpl;
  }
  private restBase(market: MarketKind): string { return market === "coin" ? this.cfg.coinRestBase : this.cfg.usdtRestBase; }
  private wsBase(market: MarketKind): string { return market === "coin" ? this.cfg.coinWsBase : this.cfg.usdtWsBase; }
  private buildUrl(base: string, path: string, params?: Record<string, any>): string { const url = new URL(path, base); if (params) { for (const [k, v] of Object.entries(params)) { if (v === undefined || v === null) continue; url.searchParams.set(k, String(v)); } } return url.toString(); }
  private buildProxyUrl(path: string, params?: Record<string, any>, market: MarketKind = 'usdt'): string {
    const qs = new URLSearchParams();
    if (params) { for (const [k, v] of Object.entries(params)) { if (v === undefined || v === null) continue; qs.set(k, String(v)); } }
    const encodedQS = qs.toString();
    const hasWindow = typeof window !== 'undefined' && (window as any).location;
    const origin = hasWindow ? (window as any).location.origin : 'http://localhost';
    const u = new URL(this.cfg.proxyUrl, origin);
    u.searchParams.set("path", path);
    u.searchParams.set("qs", encodedQS);
    u.searchParams.set("market", market);
    return u.toString();
  }
  private async get<T>(market: MarketKind, path: string, params?: Record<string, any>): Promise<T> {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const url = this.cfg.useProxy
        ? this.buildProxyUrl(path, params, market)
        : this.buildUrl(this.restBase(market), path, params);
      const res = await this.fetcher(url, { headers: { Accept: "application/json" }, signal: controller.signal });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${res.statusText} – ${text}`);
      }
      const data = (await res.json()) as T;
      return data;
    } finally { clearTimeout(t); }
  }

  async getMarkPrice(symbol: string = "BTCUSDT", market: MarketKind = "usdt"): Promise<MarkPriceData> { const path = market === "coin" ? "/dapi/v1/premiumIndex" : "/fapi/v1/premiumIndex"; const data = await this.get<any>(market, path, { symbol }); return { symbol: data.symbol, markPrice: data.markPrice, indexPrice: data.indexPrice, estimatedSettlePrice: data.estimatedSettlePrice, lastFundingRate: data.lastFundingRate, nextFundingTime: data.nextFundingTime, time: data.time }; }
  async getFundingHistory(symbol: string = "BTCUSDT", opts: { startTime?: number; endTime?: number; limit?: number } = {}, market: MarketKind = "usdt" ): Promise<FundingRateItem[]> { const path = market === "coin" ? "/dapi/v1/fundingRate" : "/fapi/v1/fundingRate"; const { startTime, endTime, limit } = opts; const items = await this.get<any[]>(market, path, { symbol, startTime, endTime, limit }); return items.map((i) => ({ symbol: i.symbol, fundingRate: i.fundingRate, fundingTime: i.fundingTime })); }
  async getKlines(symbol: string, interval: string, opts: { limit?: number; startTime?: number; endTime?: number } = {}, market: MarketKind = "usdt" ): Promise<NormalizedKline[]> { const path = market === "coin" ? "/dapi/v1/klines" : "/fapi/v1/klines"; const { limit, startTime, endTime } = opts; const raw = await this.get<RawKlineTuple[]>(market, path, { symbol, interval, limit, startTime, endTime }); return raw.map((k) => ({ openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]), closeTime: k[6], quoteVolume: Number(k[7]), trades: k[8], takerBuyBase: Number(k[9]), takerBuyQuote: Number(k[10]) })); }
  async getContinuousKlines(pair: string, contractType: 'PERPETUAL' | 'CURRENT_QUARTER' | 'NEXT_QUARTER', interval: string, opts: { limit?: number; startTime?: number; endTime?: number } = {}, market: MarketKind = "usdt" ): Promise<NormalizedKline[]> { const path = market === 'coin' ? '/dapi/v1/continuousKlines' : '/fapi/v1/continuousKlines'; const { limit, startTime, endTime } = opts; const raw = await this.get<RawKlineTuple[]>(market, path, { pair, contractType, interval, limit, startTime, endTime }); return raw.map((k) => ({ openTime: k[0], open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]), closeTime: k[6], quoteVolume: Number(k[7]), trades: k[8], takerBuyBase: Number(k[9]), takerBuyQuote: Number(k[10]) })); }
  async listDeliveryContracts(pair: string = "BTCUSD"): Promise<DeliveryContractBrief[]> { const info = await this.get<{ symbols: ExchangeInfoSymbol[] }>("coin", "/dapi/v1/exchangeInfo"); const out: DeliveryContractBrief[] = []; for (const s of info.symbols) { const sPair = s.pair ?? ""; const ctype = (s.contractType ?? "").toUpperCase(); const isDelivery = ctype !== "PERPETUAL" && (s.deliveryDate ?? 0) > 0; if (sPair.startsWith(pair) && isDelivery) { out.push({ symbol: s.symbol, pair: sPair, contractType: ctype, deliveryDate: s.deliveryDate! }); } } out.sort((a, b) => a.deliveryDate - b.deliveryDate); return out; }
  async getExchangeInfo(market: MarketKind = 'usdt'): Promise<{ symbols: ExchangeInfoSymbol[] }> { const path = market === 'coin' ? '/dapi/v1/exchangeInfo' : '/fapi/v1/exchangeInfo'; return this.get<{ symbols: ExchangeInfoSymbol[] }>(market, path); }
  async getSymbolInfo(symbol: string, market: MarketKind = 'usdt'): Promise<ExchangeInfoSymbol | undefined> { const key = `${market}:${symbol}`; if (this.symbolInfoCache.has(key)) return this.symbolInfoCache.get(key); const info = await this.getExchangeInfo(market); const found = info.symbols.find(s => s.symbol === symbol); if (found) this.symbolInfoCache.set(key, found); return found; }
  async formatPrice(symbol: string, price: number, market: MarketKind = 'usdt'): Promise<string> { const info = await this.getSymbolInfo(symbol, market); const tick = info?.filters?.find(f => f.filterType === 'PRICE_FILTER')?.tickSize ?? '0.01'; const q = quantizeToStep(price, tick); return q.toFixed(decimalsFromStep(tick)); }
  async formatQty(symbol: string, qty: number, market: MarketKind = 'usdt'): Promise<string> { const info = await this.getSymbolInfo(symbol, market); const step = info?.filters?.find(f => f.filterType === 'LOT_SIZE')?.stepSize ?? '0.001'; const q = quantizeToStep(qty, step); return q.toFixed(decimalsFromStep(step)); }
  async getOpenInterest(symbol: string = 'BTCUSDT'): Promise<{ symbol: string; openInterest: string }>{ const data = await this.get<any>('usdt', '/fapi/v1/openInterest', { symbol }); return { symbol: data.symbol, openInterest: data.openInterest }; }
  async getOpenInterestHist(symbol: string = 'BTCUSDT', period: '5m'|'15m'|'1h'|'4h'|'1d' = '1h', limit = 200): Promise<Array<{ symbol: string; sumOpenInterest: number; timestamp: number }>>{ const rows = await this.get<any>('usdt', '/futures/data/openInterestHist', { symbol, period, limit }); return rows.map((r: any) => ({ symbol: r.symbol, sumOpenInterest: Number(r.sumOpenInterestValue), timestamp: Number(r.timestamp) })); }
  subscribeMarkPrice(symbol: string = "BTCUSDT", market: MarketKind = "usdt", opts: { onMessage: (data: { eventTime: number; symbol: string; markPrice: number; indexPrice?: number; fundingRate?: number; nextFundingTime?: number }) => void; onError?: (err: any) => void; autoReconnect?: boolean; intervalSec?: 1 | 3; } ): { close: () => void } {
    const { onMessage, onError, autoReconnect = true, intervalSec = 1 } = opts;
    let closed = false; let ws: WebSocket | null = null; let reconnectTimer: any = null;
    const stream = `${symbol.toLowerCase()}@markPrice@${intervalSec}s`;
    const url = `${this.wsBase(market)}/${stream}`;
    const connect = () => {
      ws = new WebSocket(url);
      ws.onmessage = (evt) => {
        try {
          const m = JSON.parse(evt.data as string);
          const mark = Number(m.p);
          const idx = m.i !== undefined ? Number(m.i) : undefined;
          const fr = m.r !== undefined ? Number(m.r) : undefined;
          const nft = m.T !== undefined ? Number(m.T) : undefined;
          onMessage({ eventTime: Number(m.E), symbol: m.s, markPrice: mark, indexPrice: idx, fundingRate: fr, nextFundingTime: nft });
        } catch (err) { onError?.(err); }
      };
      ws.onerror = (e) => onError?.(e);
      ws.onclose = () => { if (!closed && autoReconnect) { reconnectTimer = setTimeout(connect, 1000); } };
    };
    connect();
    return { close: () => { closed = true; if (reconnectTimer) clearTimeout(reconnectTimer); if (ws && ws.readyState === WebSocket.OPEN) ws.close(); } };
  }
}
