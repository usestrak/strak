/**
 * /api/candles: the chart's fallback source.
 *
 * The terminal asks Jupiter's chart API straight from the browser. When that fails (a network
 * that blocks it, an outage), it comes here: this route asks Jupiter from the server and, if
 * Jupiter is down too, GeckoTerminal for the token's deepest pool. Either way the answer has the
 * same shape, oldest first: { candles: [{ time, open, high, low, close, volume }], source }.
 *
 * Query: ?mint=<token>&interval=15_MINUTE[&pool=<pool>][&to=<ms>][&candles=500][&type=price|mcap]
 * The old form ?pool=&tf=minute|hour|day&agg= still answers from GeckoTerminal as { ohlcv }.
 */
const JUP = 'https://datapi.jup.ag/v2/charts';
const GT = 'https://api.geckoterminal.com/api/v2/networks/solana';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

// Solana addresses are base58: 32 to 44 chars, no 0, O, I or l.
const ok = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || '');
const INTERVALS = new Set(['1_SECOND', '15_SECOND', '1_MINUTE', '5_MINUTE', '15_MINUTE', '30_MINUTE', '1_HOUR', '4_HOUR', '1_DAY', '1_WEEK']);
// the same intervals as GeckoTerminal names them (it has nothing under a minute)
const GT_TF = { '1_MINUTE': ['minute', 1], '5_MINUTE': ['minute', 5], '15_MINUTE': ['minute', 15], '1_HOUR': ['hour', 1], '4_HOUR': ['hour', 4], '1_DAY': ['day', 1] };
const SHORT = new Set(['1_SECOND', '15_SECOND', '1_MINUTE']);

// A warm instance keeps the last good answer per request, so a rate limit costs freshness, not the chart.
const LAST = new Map();
const STALE_OK = 10 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, ms = 9000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { signal: ac.signal, headers: { accept: 'application/json', 'User-Agent': UA } }); }
  finally { clearTimeout(t); }
}

async function fromJupiter({ mint, interval, to, n, type }) {
  const r = await get(`${JUP}/${mint}?interval=${interval}&to=${to}&candles=${n}&type=${type}&quote=usd`);
  if (!r.ok) return null;
  const j = await r.json();
  return Array.isArray(j.candles) ? j.candles : null;
}

async function fromGecko({ pool, mint, interval, n }) {
  const tf = GT_TF[interval];
  if (!tf || !ok(pool)) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await get(`${GT}/pools/${pool}/ohlcv/${tf[0]}?aggregate=${tf[1]}&limit=${Math.min(n, 1000)}&currency=usd&token=${mint}`);
    if (r.status === 429 && attempt === 0) { await sleep(1200); continue; }
    if (!r.ok) return null;
    const j = await r.json();
    const list = j?.data?.attributes?.ohlcv_list || [];
    return list.map((c) => ({ time: c[0], open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5] || 0 })).reverse();
  }
  return null;
}

export default async function handler(req, res) {
  const q = req.query || {};

  // ── the old GeckoTerminal form, kept for anything that still asks it ──
  if (!q.mint) {
    const { pool, token, tf = 'hour', agg = '1', limit = '200' } = q;
    if (!ok(pool)) return res.status(400).json({ error: 'bad pool' });
    if (token && !ok(token)) return res.status(400).json({ error: 'bad token' });
    if (!['minute', 'hour', 'day'].includes(String(tf))) return res.status(400).json({ error: 'bad timeframe' });
    const a = Math.min(Math.max(parseInt(agg, 10) || 1, 1), 30);
    const n = Math.min(Math.max(parseInt(limit, 10) || 200, 10), 1000);
    try {
      const r = await get(`${GT}/pools/${pool}/ohlcv/${tf}?aggregate=${a}&limit=${n}&currency=usd${token ? `&token=${token}` : ''}`);
      if (!r.ok) return res.status(r.status === 429 ? 429 : 502).json({ error: `upstream ${r.status}` });
      const j = await r.json();
      res.setHeader('Cache-Control', 'public, s-maxage=45, stale-while-revalidate=300');
      return res.status(200).json({ ohlcv: j?.data?.attributes?.ohlcv_list || [] });
    } catch { return res.status(502).json({ error: 'fetch failed' }); }
  }

  const mint = String(q.mint), pool = q.pool ? String(q.pool) : '';
  const interval = String(q.interval || '15_MINUTE');
  const type = q.type === 'mcap' ? 'mcap' : 'price';
  if (!ok(mint)) return res.status(400).json({ error: 'bad mint' });
  if (pool && !ok(pool)) return res.status(400).json({ error: 'bad pool' });
  if (!INTERVALS.has(interval)) return res.status(400).json({ error: 'bad interval' });
  const n = Math.min(Math.max(parseInt(q.candles, 10) || 500, 1), 1000);
  const now = Date.now();
  const to = Math.min(Math.max(parseInt(q.to, 10) || now, 1_500_000_000_000), now + 60_000);
  const args = { mint, pool, interval, n, type, to };
  const key = `${mint}:${interval}:${type}:${n}:${Math.floor(to / 5000)}`;

  let candles = null, source = 'jupiter';
  try { candles = await fromJupiter(args); } catch { candles = null; }
  if (!candles && type === 'price') {
    try { candles = await fromGecko(args); source = 'geckoterminal'; } catch { candles = null; }
  }
  if (!candles) {
    const hit = LAST.get(key);
    if (hit && now - hit.t < STALE_OK) {
      res.setHeader('Cache-Control', 'public, s-maxage=10');
      return res.status(200).json({ candles: hit.candles, source: hit.source, stale: true });
    }
    res.setHeader('Cache-Control', 'public, s-maxage=5');
    return res.status(502).json({ error: 'no source answered' });
  }
  if (candles.length) LAST.set(key, { candles, source, t: now });
  // closed candles never change; only the newest does, and the short intervals move fastest
  res.setHeader('Cache-Control', SHORT.has(interval) ? 'public, s-maxage=3, stale-while-revalidate=30' : 'public, s-maxage=20, stale-while-revalidate=120');
  return res.status(200).json({ candles, source });
}
