Deploy on Netlify:
- Base directory: apps/btc-futures
- Build command: npm install --no-audit --no-fund && npm run build
- Publish directory: dist
- Functions directory: netlify/functions
- Node: 18 (see .nvmrc)

Notes:
- Simulation tab pulls 1m klines + 5m OI and computes drifts into funding closes (00:00/08:00/16:00 UTC).
- Export CSV button in Simulation downloads rows with price and OI deltas.
