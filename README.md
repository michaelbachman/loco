# Kraken Futures Drift Simulator (Notional vs. Margin Sizing)

This repo contains a single web app under `apps/btc-futures` for Netlify.
It proxies **Kraken Spot** (ticker + 1m OHLC) via a Netlify Function,
and simulates price drift into each 4-hour funding close.

## Quick Deploy (Netlify)
- Use this repo root.
- `netlify.toml` at the root will **cd** into `apps/btc-futures` to build.
- Publish dir: `apps/btc-futures/dist`
- Functions dir: `apps/btc-futures/netlify/functions`

### Local dev
```bash
cd apps/btc-futures
npm install
npm run dev
```
