
// Public REST proxy for Binance (USDT-M & COIN-M) with fetch fallback
async function getFetch() {
  if (typeof fetch !== 'undefined') return fetch;
  try { const { fetch: undiciFetch } = await import('undici'); return undiciFetch; }
  catch { throw new Error('No fetch available in this runtime'); }
}

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const market = String(qs.market || 'usdt').toLowerCase();
    const path = String(qs.path || '/fapi/v1/premiumIndex');
    const rawQs = String(qs.qs || '');
    const base = market === 'coin' ? 'https://dapi.binance.com' : 'https://fapi.binance.com';
    if (!(path.startsWith('/fapi/') || path.startsWith('/dapi/') || path.startsWith('/futures/'))) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid path' }) };
    }
    const url = `${base}${path}${rawQs ? (path.includes('?') ? '&' : '?') + rawQs : ''}`;
    const r = await (await getFetch())(url, { headers: { 'Accept': 'application/json' } });
    const text = await r.text();
    return { statusCode: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3', 'Access-Control-Allow-Origin': '*' }, body: text };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: String(e?.message || e) }) };
  }
};
