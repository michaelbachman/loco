
Kraken Futures — Funding Drift (v4 USD)

Changes in this build
- Displays absolute USD change next to each percentage change (e.g., 0.24% ($65.20)).
- CSV export now includes USD delta columns for each window (60/30/15/5m).
- Still Kraken-only, default lookback = 16 hours, with auto-detected (or manual) funding interval.

Deploy (Netlify)
- Build: `cd apps/btc-futures && npm install --no-audit --no-fund && npm run build`
- Publish: `apps/btc-futures/dist`
- Functions: `apps/btc-futures/netlify/functions`
- Node: 18 (.nvmrc included)
