// Sends a message via Telegram bot with fetch fallback
async function getFetch() {
  if (typeof fetch !== 'undefined') return fetch;
  try { const { fetch: undiciFetch } = await import('undici'); return undiciFetch; }
  catch { throw new Error('No fetch available in this runtime'); }
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod && event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }
    const payload = typeof event.body === 'string' && event.body ? JSON.parse(event.body) : {};
    const text = payload.text || 'Ping from BTC Futures app';
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return { statusCode: 500, body: JSON.stringify({ error: 'Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID' }) };

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const r = await (await getFetch())(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    const body = await r.text();
    return { statusCode: r.status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: String(e?.message || e) }) };
  }
};
