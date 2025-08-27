export async function handler(event) {
  const { path, pair = 'XBTUSD', interval = '1', since } = event.queryStringParameters || {}
  try {
    if (path === 'spot_ohlc') {
      const url = new URL('https://api.kraken.com/0/public/OHLC')
      url.searchParams.set('pair', pair)
      url.searchParams.set('interval', interval)
      if (since) url.searchParams.set('since', since)
      const r = await fetch(url, { headers: { 'user-agent': 'netlify-function' } })
      const j = await r.json()
      return { statusCode: 200, body: JSON.stringify(j) }
    }
    if (path === 'spot_ticker') {
      const url = new URL('https://api.kraken.com/0/public/Ticker')
      url.searchParams.set('pair', pair)
      const r = await fetch(url, { headers: { 'user-agent': 'netlify-function' } })
      const j = await r.json()
      return { statusCode: 200, body: JSON.stringify(j) }
    }
    return { statusCode: 400, body: JSON.stringify({ error: 'unknown path', path }) }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e) }) }
  }
}
