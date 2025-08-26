
// Proxy for Kraken Spot public API (https://api.kraken.com/0/public/*)
async function getFetch() {
  if (typeof fetch !== 'undefined') return fetch;
  try { const { fetch: undiciFetch } = await import('undici'); return undiciFetch; }
  catch { throw new Error('No fetch available in this runtime'); }
}

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const path = String(qs.path || '/0/public/Time');
    const rawQs = String(qs.qs || '');
    if (!path.startsWith('/0/public/')) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid path' }) };
    }
    const url = `https://api.kraken.com${path}${rawQs ? (path.includes('?') ? '&' : '?') + rawQs : ''}`;
    const r = await (await getFetch())(url, { headers: { 'Accept': 'application/json' } });
    const text = await r.text();
    return { statusCode: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3', 'Access-Control-Allow-Origin': '*' }, body: text };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: String(e?.message || e) }) };
  }
};
