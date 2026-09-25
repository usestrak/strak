/**
 * /api/trades: the last swaps in one pool, and who made them.
 *
 * Turnover says the volume doesn't fit the pool. This says who is making it: how many wallets, how
 * much of the volume the top three carry, and how many wallets both bought and sold inside the
 * window (the round trip that wash trading needs). Source: GeckoTerminal's last 300 trades.
 *
 * Query: ?pool=<pool>[&token=<mint>]
 * Answer: { trades: [{ t, kind, usd, wallet, tx }], stats: { … } }, newest first.
 * Cached 20 s at the CDN: a whole page of visitors costs GeckoTerminal three calls a minute per pool.
 */
const GT = 'https://api.geckoterminal.com/api/v2/networks/solana/pools';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const ok = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || '');

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  const { pool } = req.query || {};
  if (!ok(pool)) return res.status(400).json({ error: 'bad pool' });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  let list;
  try {
    const r = await fetch(`${GT}/${pool}/trades`, { signal: ac.signal, headers: { accept: 'application/json', 'User-Agent': UA } });
    if (r.status === 429) { res.setHeader('Cache-Control', 'public, s-maxage=10'); return res.status(429).json({ error: 'upstream rate limited' }); }
    if (!r.ok) return res.status(502).json({ error: `upstream ${r.status}` });
    list = (await r.json())?.data || [];
  } catch {
    return res.status(502).json({ error: 'fetch failed' });
  } finally { clearTimeout(timer); }

  const trades = list.map(({ attributes: a }) => ({
    t: Date.parse(a.block_timestamp),
    kind: a.kind,
    usd: +a.volume_in_usd || 0,
    wallet: a.tx_from_address,
    tx: a.tx_hash,
  })).filter((x) => x.t && x.wallet);

  // who carries the volume
  const by = new Map();
  for (const x of trades) {
    const w = by.get(x.wallet) || { usd: 0, n: 0, buy: 0, sell: 0 };
    w.usd += x.usd; w.n++; w[x.kind === 'sell' ? 'sell' : 'buy']++;
    by.set(x.wallet, w);
  }
  const total = trades.reduce((a, x) => a + x.usd, 0);
  const ranked = [...by.entries()].sort((a, b) => b[1].usd - a[1].usd);
  const top3 = ranked.slice(0, 3).reduce((a, [, w]) => a + w.usd, 0);
  const both = ranked.filter(([, w]) => w.buy && w.sell);
  const bothUsd = both.reduce((a, [, w]) => a + w.usd, 0);
  const sizes = trades.map((x) => x.usd).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  const span = trades.length > 1 ? (trades[0].t - trades[trades.length - 1].t) / 60000 : 0;

  res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=60');
  return res.status(200).json({
    trades: trades.slice(0, 60),
    stats: {
      count: trades.length,
      usd: total,
      wallets: by.size,
      minutes: +span.toFixed(1),
      perMin: span ? +(trades.length / span).toFixed(2) : null,
      median: +median.toFixed(2),
      top3Share: total ? +(top3 / total).toFixed(4) : 0,
      roundTripWallets: both.length,
      roundTripShare: total ? +(bothUsd / total).toFixed(4) : 0,
      top: ranked.slice(0, 5).map(([wallet, w]) => ({ wallet, usd: w.usd, n: w.n, buy: w.buy, sell: w.sell })),
    },
  });
}
