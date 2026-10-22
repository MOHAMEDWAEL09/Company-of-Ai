// Vercel serverless function: a thin relay between the browser and the LLM providers.
// Browsers can't call most of these APIs directly (CORS), so the page sends the request here.
// The API key arrives with each request from the user's own browser and is never stored or logged.
const CHAT = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  grok: 'https://api.x.ai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
};
const MODELS = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/models',
  deepseek: 'https://api.deepseek.com/models',
  grok: 'https://api.x.ai/v1/models',
  openrouter: 'https://openrouter.ai/api/v1/models',
  groq: 'https://api.groq.com/openai/v1/models',
};

module.exports = async (req, res) => {
  res.setHeader('x-sim-proxy', '1');
  res.setHeader('Cache-Control', 'no-store');

  // Health check used by the settings screen: GET /api/llm
  if (req.method === 'GET') return res.status(200).json({ ok: true, providers: Object.keys(CHAT) });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Only accept calls coming from this same site.
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try { ok = new URL(origin).host === req.headers.host; } catch (e) { /* bad origin */ }
    if (!ok) return res.status(403).json({ error: 'forbidden origin' });
  }

  let payload = req.body;
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch (e) { payload = null; } }
  const { provider, apiKey, body, op } = payload || {};
  const listing = op === 'models';
  const url = (listing ? MODELS : CHAT)[provider];
  if (!url || typeof apiKey !== 'string' || !apiKey || (!listing && (!body || typeof body !== 'object'))) {
    return res.status(400).json({ error: 'bad request' });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 280000);
  try {
    const r = await fetch(url, {
      method: listing ? 'GET' : 'POST',
      headers: listing ? { Authorization: 'Bearer ' + apiKey } : { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body: listing ? undefined : JSON.stringify(body),
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
