/**
 * /api/sparks: 24 hourly closes for the pools the landing draws sparklines for.
 *
 * GeckoTerminal allows about 30 calls a minute and answers the browser without CORS, so the page
 * never calls it directly. This route picks the pools itself from the (CDN-cached) registry, which
 * keeps the URL constant: the CDN then holds ONE answer for half an hour, and the whole site costs
 * the upstream about 30 calls per half hour no matter how many people visit.
 *
 * Which pools: the 8 highest turnover plus the 22 most traded, the rows the landing shows.
 * Answer: { sparks: { <pool>: [close, ...] } }, oldest first; pools that failed are left out.
 */
const GT = 'https://api.geckoterminal.com/api/v2/networks/solana/pools';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

export const config = { maxDuration: 30 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Warm instances remember what they fetched, so a batch cut short by a 429 is topped up on the
// next call instead of starting over. Closes older than half an hour are fetched again.
const MEM = new Map();
const FRESH = 30 * 60 * 1000;

async function getJson(url, ms = 9000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json', 'User-Agent': UA } });
    return { status: r.status, json: r.ok ? await r.json() : null };
  } catch { return { status: 0, json: null }; } finally { clearTimeout(t); }
}

async function one(pool, mint) {
  const url = `${GT}/${pool}/ohlcv/hour?aggregate=1&limit=24&currency=usd&token=${mint}`;
  for (let i = 0; i < 2; i++) {
    const { status, json } = await getJson(url);
    const list = json?.data?.attributes?.ohlcv_list || [];
    if (list.length > 2) return list.map((c) => +c[4]).reverse();
    if (status !== 429) return null;
    await sleep(1500);
  }
  return null;
}

async function pick(req) {
  const host = req.headers?.host;
  const proto = req.headers?.['x-forwarded-proto'] || (/^localhost|^127\./.test(host || '') ? 'http' : 'https');
  let reg = null;
  for (const path of ['/api/registry', '/data/equities.json']) {
    reg = (await getJson(`${proto}://${host}${path}`, 20000)).json;
    if (reg?.equities?.length) break;
  }
  const L = (reg?.equities || []).filter((e) => e.pool && e.address);
  const hot = [...L].sort((a, b) => b.turnover - a.turnover).slice(0, 8);
  const busy = [...L].sort((a, b) => b.vol24 - a.vol24).slice(0, 22);
  const seen = new Map();
  for (const e of [...hot, ...busy]) seen.set(e.pool, e.address);
  return [...seen.entries()].slice(0, 30);
}

export default async function handler(req, res) {
  const pairs = await pick(req);
  if (!pairs.length) {
    res.setHeader('Cache-Control', 'public, s-maxage=30');
    return res.status(502).json({ error: 'registry unavailable' });
  }
  const sparks = {};
  const now = Date.now();
  const todo = [];
  for (const [p, m] of pairs) {
    const hit = MEM.get(p);
    if (hit && now - hit.t < FRESH) sparks[p] = hit.s; else todo.push([p, m]);
  }
  for (let i = 0; i < todo.length; i += 3) {
    const got = await Promise.all(todo.slice(i, i + 3).map(([p, m]) => one(p, m)));
    got.forEach((s, k) => { if (s) { sparks[todo[i + k][0]] = s; MEM.set(todo[i + k][0], { s, t: now }); } });
  }
  // A mostly failed batch should not be pinned for half an hour.
  const good = Object.keys(sparks).length >= pairs.length * .6;
  res.setHeader('Cache-Control', good ? 'public, s-maxage=1800, stale-while-revalidate=3600' : 'public, s-maxage=60');
  return res.status(200).json({ sparks, count: Object.keys(sparks).length, of: pairs.length });
}
