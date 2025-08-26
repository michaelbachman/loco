
Kraken Futures — Funding Drift (v4, Kraken-only)

Features
- Single-venue (Kraken) simulation of price drift into funding close (Δ60/30/15/5m)
- Auto-detect funding cadence from Kraken tickers if available; fallback to 4h/8h grid
- Live mark stream (WS) + countdown to next close
- Symbol switcher: PI_XBTUSD / PI_ETHUSD (persisted)
- CSV export: per-event rows & aggregated slot averages
- Resilient fetch with backoff; clear status chip
- Default lookback (Hours) set to 16

Deploy (Netlify)
- Build: `cd apps/btc-futures && npm install --no-audit --no-fund && npm run build`
- Publish: `apps/btc-futures/dist`
- Functions: `apps/btc-futures/netlify/functions`
- Node: 18 (.nvmrc included)

Notes
- Uses Netlify proxies: `/.netlify/functions/kraken` and `/krakenSpot` to avoid CORS.
- OHLC order: Futures OHLC → Futures trades aggregated to 1m → Spot OHLC fallback (XBTUSD).
