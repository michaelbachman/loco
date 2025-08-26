
Futures Drift — Kraken vs Binance (v3)

✅ Features
- Auto-detect funding cadence per venue (uses nextFundingTime if available; else aligns 4h/8h to UTC grid)
- Live mark price stream (Kraken WS ticker, Binance markPrice@1s) + countdown to next close
- Symbol switcher with localStorage persistence (Kraken: PI_XBTUSD, PI_ETHUSD; Binance: BTCUSDT, ETHUSDT)
- Source badge for Kraken rows (futures.ohlc, futures.trades, spot.ohlc)
- CSV export for per-event rows and aggregated slot metrics for each venue
- Resilience: fetch retries with exponential backoff + status chips in header
- Side-by-side comparison: Kraken and Binance drift tables & aggregates

Netlify Deploy
- Base directory: repo root
- Build command: `cd apps/btc-futures && npm install --no-audit --no-fund && npm run build`
- Publish directory: `apps/btc-futures/dist`
- Functions directory: `apps/btc-futures/netlify/functions`
- Node: 18 (.nvmrc included)

Notes
- Kraken OHLC tries Futures first, then Futures trades→1m, then Spot OHLC (XBTUSD) as final fallback.
- Binance uses public klines and premiumIndex for funding timing check.
- All endpoints are public and proxied via Netlify functions to avoid CORS.
