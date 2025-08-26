# BTC Futures (Netlify)

## 1) Install & run locally
```bash
npm i
npm run dev
```

## 2) Netlify setup
- Connect this repo to Netlify
- Build command: `npm run build`
- Publish dir: `dist`
- Functions dir: `netlify/functions`
- Environment variables:
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_CHAT_ID`

## 3) What’s included
- Public REST proxy for Binance (`/.netlify/functions/binance`)
- Telegram push (`/.netlify/functions/telegram`)
- React app with Tailwind + Recharts
- Patterns, Signals, Tools tabs

## 4) Notes
- Browser hits Binance via the Netlify proxy to avoid CORS.
- Tailwind is already wired via `index.css` + `tailwind.config.js`.
- Tuning values persist in `localStorage` and can be reset from Tools → Tuning.
