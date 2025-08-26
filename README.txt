
Kraken Futures BTC Perp — Simulation App

Deploy (Netlify):
- Base directory: repo root (the config handles cd'ing into the app)
- Build command: (from netlify.toml) `cd apps/btc-futures && npm install --no-audit --no-fund && npm run build`
- Publish directory: `apps/btc-futures/dist`
- Functions directory: `apps/btc-futures/netlify/functions`
- Node: 18 (.nvmrc included)

Features:
- Simulation tab computes Δ60/30/15/5m price drift into funding closes over the last N hours.
- Funding interval selectable: 8h (Binance-style) or 4h (Kraken-style).
- CSV export of per-event rows.
- Uses `/.netlify/functions/kraken` proxy to call Kraken Futures public endpoints.
- OHLC fetched via `/derivatives/api/v3/ohlc` if available; falls back to `/trades` aggregation to 1m.
- Symbol: `PI_XBTUSD`.

If you see errors in the Simulation tab, paste the first error line from the browser console and we can fine-tune the endpoint names/params for your account region.
