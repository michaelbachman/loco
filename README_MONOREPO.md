# Monorepo setup for Netlify

This repo hosts the BTC Futures app under `apps/btc-futures`.

## Netlify
- The root `netlify.toml` sets `base = "apps/btc-futures"` so Netlify builds from that subfolder.
- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`
- Set env vars in the Site → Settings → Environment:
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`

> Tip: The app subfolder also contains its own `netlify.toml`. Netlify will prefer the **root** config; you can remove the subfolder config if you want a single source of truth.

## Local dev
```bash
cd apps/btc-futures
npm i
npm run dev
```
