// Vercel serverless function: a thin relay between the browser and the LLM providers.
// Browsers can't call most of these APIs directly (CORS), so the page sends the request here.
// The API key arrives with each request from the user's own browser and is never stored or logged.
const UPSTREAM = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  grok: 'https://api.x.ai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
};

module.exports = async (req, res) => {
  res.setHeader('x-sim-proxy', '1');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Only accept calls coming from this same site.
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === req.headers.host; } catch (e) { /* bad origin */ }
    if (!ok) return res.status(403).json({ error: 'forbidden origin' });
  }

  const { provider, apiKey, body } = req.body || {};
  const url = UPSTREAM[provider];
  if (!url || typeof apiKey !== 'string' || !apiKey || !body || typeof body !== 'object') {
    return res.status(400).json({ error: 'bad request' });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 55000);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    const retry = r.headers.get('retry-after');
    if (retry) res.setHeader('Retry-After', retry);
    res.setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    return res.status(r.status).send(text);
  } catch (e) {
    return res.status(504).json({ error: e && e.name === 'AbortError' ? 'upstream timeout' : String((e && e.message) || e) });
  } finally {
    clearTimeout(timer);
  }
};
