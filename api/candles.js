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

  try {
    const r = await fetch(url, {
      headers: {
        accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
      },
    });

    if (r.status === 429) {
      res.setHeader('Cache-Control', 'public, s-maxage=10');
      return res.status(429).json({ error: 'upstream rate limited' });
    }
    if (!r.ok) return res.status(502).json({ error: `upstream ${r.status}` });

    const j = await r.json();
    const list = j?.data?.attributes?.ohlcv_list || [];

    // Candles for a closed interval never change, so let the CDN answer most of these.
    res.setHeader('Cache-Control', 'public, s-maxage=45, stale-while-revalidate=120');
    return res.status(200).json({ ohlcv: list });
  } catch (e) {
    return res.status(502).json({ error: 'fetch failed' });
  }
}
