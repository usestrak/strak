/**
 * /api/trades: the last swaps of one stock, and who made them.
 *
 * Turnover says the volume doesn't fit the pool. This says who is making it: how many wallets, how
 * much of the volume the top three carry, and how many wallets both bought and sold inside the
 * window (the round trip that wash trading needs).
 *
 * Source: Jupiter's trade feed for the whole token, every pool at once (the same scope as turnover
 * and the chart), paged 30 at a time up to 300 or five seconds. If Jupiter does not answer, GeckoTerminal's last
 * 300 trades of the deepest pool stand in, and `scope` says "pool".
 *
 * Query: ?mint=<token>[&pool=<pool>]   (the old ?pool= alone still works, pool scope)
 * Answer: { trades: [{ t, kind, usd, wallet, tx }], stats: { … }, source, scope }, newest first.
 * Cached 20 s at the CDN, so a page full of visitors costs the upstream a few calls a minute.
 */
const JUP = 'https://datapi.jup.ag/v1/txs';
const GT = 'https://api.geckoterminal.com/api/v2/networks/solana/pools';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const ok = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || '');
const WANT = 300;

export const config = { maxDuration: 15 };

async function get(url, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { signal: ac.signal, headers: { accept: 'application/json', 'User-Agent': UA } }); }
  finally { clearTimeout(t); }
}

// Jupiter pages back 30 swaps at a time; stop at 300 or when the time budget runs out
async function fromJupiter(mint) {
  const out = [];
  let offset = '';
  const until = Date.now() + 5000;   // a first visitor should not wait longer; the CDN serves the rest
  while (out.length < WANT && Date.now() < until) {
    const r = await get(`${JUP}/${mint}${offset ? `?offset=${offset}` : ''}`, 5000);
    if (!r.ok) break;
    const j = await r.json();
    const page = (j.txs || []).filter((x) => !offset || x.actionId !== offset);
    for (const x of page) out.push({ t: Date.parse(x.timestamp), kind: x.type === 'sell' ? 'sell' : 'buy', usd: +x.usdVolume || 0, wallet: x.traderAddress, tx: x.txHash });
    if (!j.next || !page.length) break;
    offset = j.next;
  }
  return out.length ? out.slice(0, WANT) : null;
}

async function fromGecko(pool) {
  const r = await get(`${GT}/${pool}/trades`, 8000);
  if (!r.ok) return null;
  const list = (await r.json())?.data || [];
  return list.map(({ attributes: a }) => ({ t: Date.parse(a.block_timestamp), kind: a.kind, usd: +a.volume_in_usd || 0, wallet: a.tx_from_address, tx: a.tx_hash }));
}

export default async function handler(req, res) {
  const { mint, pool } = req.query || {};
  if (mint && !ok(mint)) return res.status(400).json({ error: 'bad mint' });
  if (pool && !ok(pool)) return res.status(400).json({ error: 'bad pool' });
  if (!mint && !pool) return res.status(400).json({ error: 'bad mint' });

  let list = null, source = 'jupiter', scope = 'token';
  if (mint) { try { list = await fromJupiter(mint); } catch { list = null; } }
  if (!list && pool) { try { list = await fromGecko(pool); source = 'geckoterminal'; scope = 'pool'; } catch { list = null; } }
  if (!list) { res.setHeader('Cache-Control', 'public, s-maxage=10'); return res.status(502).json({ error: 'no source answered' }); }

  const trades = list.filter((x) => x.t && x.wallet).sort((x, y) => y.t - x.t);

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
    source, scope,
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
