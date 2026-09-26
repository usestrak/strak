/**
 * registry.mjs: every tokenized equity on Solana, in the shape the terminal reads.
 *
 * Shared by the build script (writes public/data/equities.json) and /api/registry (serves the same
 * thing live, CDN-cached). One source of truth for the filters, so the file and the live board can
 * never disagree about what counts as a market.
 *
 * Solana has a curated source: Jupiter's verified token list tags tokenized shares by issuer
 * (xstocks, ondo, backpack) and ships 24h volume and liquidity in the same record. The raw list is
 * noisy: issuers mint one token per listing even when nobody trades it, and scam copies reuse real
 * tickers. So we keep only tokens with the issuer tag AND real liquidity, and collapse same-ticker
 * duplicates within one issuer to the deepest one.
 *
 * Pools for charts come from DexScreener (batched 30 mints per call), deepest pair per token.
 */
const JUP = 'https://lite-api.jup.ag/tokens/v2/tag?query=verified';
const DS = 'https://api.dexscreener.com/tokens/v1/solana/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

export const ISSUERS = ['xstocks', 'ondo', 'backpack'];

/**
 * Pre-IPO tokens track companies that have no listed shares at all: OpenAI, Anthropic, SpaceX.
 * Two issuers compete on the same names, PreStocks and Tessera (the `t` prefix).
 *
 * They are kept in their own list, never mixed into `equities`, because the whole board rests on a
 * distinction they break: behind a tokenized NVDA sits a real share with a price you can check
 * against, and behind a tokenized OpenAI there is no share and no reference price. The pool price
 * is the only price there is, which makes it unfalsifiable. Turnover still works, and arguably
 * matters more when nothing else can be checked.
 */
export const PREIPO = ['prestocks', 'tessera'];
const MIN_LIQ = 5_000;                 // below this a pool is decoration, not a market

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : 0; };

async function getJson(url, { tries = 3, timeout = 12000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': UA, accept: 'application/json' } });
      if (r.ok) return await r.json();
    } catch {} finally { clearTimeout(t); }
    await sleep(700 * (i + 1));
  }
  return null;
}

// The two pre-IPO issuers name the same company differently: PreStocks ships OPENAI, Tessera
// ships tOpenAI. Fold both to one key so the pair can be lined up.
function preName(sym, name) {
  const base = /^t[A-Z]/.test(sym) ? sym.slice(1) : sym;
  return base.toUpperCase();
}

// Issuers suffix their tickers (NVDAx, AAPLon); the plain ticker is what people search for.
function baseTicker(sym, issuer) {
  if (issuer === 'xstocks') return sym.replace(/x$/, '');
  if (issuer === 'ondo') return sym.replace(/on$/, '');
  return sym;
}

export async function buildRegistry({ tries = 3 } = {}) {
  const list = await getJson(JUP, { tries });
  if (!Array.isArray(list)) throw new Error('Jupiter list unavailable');

  const shape = (t, issuer, ticker) => {
    const s = t.stats24h || {};
    return {
      address: t.id,
      ticker,
      symbol: t.symbol,
      name: t.name,
      issuer,
      price: num(t.usdPrice),
      liq: num(t.liquidity),
      vol24: num(s.buyVolume) + num(s.sellVolume),
      change24: num(s.priceChange),
      txns24: num(s.numBuys) + num(s.numSells),
      holders: num(t.holderCount),
      organic: num(t.organicScore),
      icon: t.icon || null,
    };
  };

  let rows = [];
  let pre = [];
  for (const t of list) {
    const tags = new Set(t.tags || []);
    if (tags.has('unknown') || num(t.liquidity) < MIN_LIQ) continue;

    const issuer = ISSUERS.find((i) => tags.has(i));
    if (issuer) { rows.push(shape(t, issuer, baseTicker(String(t.symbol || ''), issuer))); continue; }

    // Pre-IPO: the two issuers tag themselves. Metals carry `commodities` and are not stocks.
    const preIssuer = PREIPO.find((i) => tags.has(i));
    if (preIssuer && !tags.has('commodities')) {
      const sym = String(t.symbol || '');
      pre.push(shape(t, preIssuer, preName(sym, t.name)));
    }
  }

  // Same ticker from the same issuer twice means one is a leftover listing: keep the deepest.
  const dedupe = (list) => {
    const best = new Map();
    for (const r of list) {
      const k = `${r.issuer}:${r.ticker}`;
      if (!best.has(k) || best.get(k).liq < r.liq) best.set(k, r);
    }
    return [...best.values()];
  };
  rows = dedupe(rows);
  pre = dedupe(pre);
  const all = [...rows, ...pre];

  // Deepest pool per mint, for candles. The chunks are independent, so fetch them together.
  const chunks = [];
  for (let i = 0; i < all.length; i += 30) chunks.push(all.slice(i, i + 30));
  await Promise.all(chunks.map(async (chunk) => {
    const pairs = await getJson(DS + chunk.map((r) => r.address).join(','), { tries });
    if (!Array.isArray(pairs)) return;
    for (const r of chunk) {
      const mine = pairs.filter((p) => p.baseToken?.address === r.address || p.quoteToken?.address === r.address);
      mine.sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd));
      const p = mine[0];
      if (p) {
        r.pool = p.pairAddress;
        r.dex = p.dexId;
        r.quote = p.baseToken?.address === r.address ? p.quoteToken?.symbol : p.baseToken?.symbol;
        r.createdMs = num(p.pairCreatedAt) || null;
        // pool price change over 24h, 6h, 1h: a coarse but real price path when candles are missing
        const pc = p.priceChange || {};
        if (pc.h24 != null) r.pc = [num(pc.h24), num(pc.h6), num(pc.h1)];
      }
    }
  }));

  // Turnover: 24h volume per dollar of liquidity. The terminal colours by it.
  for (const r of all) r.turnover = r.liq ? +(r.vol24 / r.liq).toFixed(2) : 0;
  rows.sort((a, b) => b.vol24 - a.vol24);
  pre.sort((a, b) => b.vol24 - a.vol24);

  return {
    updatedAt: Date.now(),
    chain: { name: 'Solana', id: 'solana' },
    count: rows.length,          // listed stocks only: pre-IPO is a separate universe
    equities: rows,
    preipo: pre,
  };
}
