/**
 * /api/candles: server-side proxy for GeckoTerminal OHLCV.
 *
 * The browser cannot call GeckoTerminal directly: it rate-limits hard, and a 429 comes back
 * without CORS headers, which the browser reports as a CORS failure rather than a rate limit.
 * Proxying from the edge fixes both: one origin, and a short cache so repeated views of the same
 * chart do not each cost an upstream call.
 */
const GT = 'https://api.geckoterminal.com/api/v2';
const NET = 'solana';

// A warm instance keeps the last good answer per chart. When the upstream rate limits, the chart
// gets slightly stale candles instead of an error, which is the difference between a chart that
// flickers and one that looks broken.
const LAST = new Map();
const STALE_OK = 10 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Solana addresses are base58: 32 to 44 chars, no 0, O, I or l.
const ok = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || '');
const TF = new Set(['minute', 'hour', 'day']);

export default async function handler(req, res) {
  const { pool, token, tf = 'hour', agg = '1', limit = '200' } = req.query || {};

  if (!ok(pool)) return res.status(400).json({ error: 'bad pool' });
  if (token && !ok(token)) return res.status(400).json({ error: 'bad token' });
  if (!TF.has(String(tf))) return res.status(400).json({ error: 'bad timeframe' });

  const a = Math.min(Math.max(parseInt(agg, 10) || 1, 1), 30);
  const n = Math.min(Math.max(parseInt(limit, 10) || 200, 10), 1000);

  const url = `${GT}/networks/${NET}/pools/${pool}/ohlcv/${tf}` +
              `?aggregate=${a}&limit=${n}&currency=usd${token ? `&token=${token}` : ''}`;

  const key = url;
  const headers = {
    accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  };

  const stale = () => {
    const hit = LAST.get(key);
    if (!hit || Date.now() - hit.t > STALE_OK) return null;
    res.setHeader('Cache-Control', 'public, s-maxage=20');
    res.setHeader('X-Strak-Stale', String(Math.round((Date.now() - hit.t) / 1000)));
    return res.status(200).json({ ohlcv: hit.list, stale: true });
  };

  // One retry: GeckoTerminal's limit is short, and a single pause usually clears it.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers });

      if (r.status === 429) {
        if (attempt === 0) { await sleep(1200); continue; }
        return stale() || (res.setHeader('Cache-Control', 'public, s-maxage=10'), res.status(429).json({ error: 'upstream rate limited' }));
      }
      if (!r.ok) return stale() || res.status(502).json({ error: `upstream ${r.status}` });

      const j = await r.json();
      const list = j?.data?.attributes?.ohlcv_list || [];
      if (list.length) LAST.set(key, { list, t: Date.now() });

      // Candles for a closed interval never change, so let the CDN answer most of these.
      res.setHeader('Cache-Control', 'public, s-maxage=45, stale-while-revalidate=300');
      return res.status(200).json({ ohlcv: list });
    } catch {
      if (attempt === 0) { await sleep(600); continue; }
      return stale() || res.status(502).json({ error: 'fetch failed' });
    }
  }
}
