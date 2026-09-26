/**
 * /api/history: how one stock's turnover has moved over the past days.
 *
 * Every snapshot of the whole board is committed to the repository, one line per run, one file per
 * day. This route reads those files straight from GitHub rather than from the deployment, because
 * the bot keeps committing between deploys: reading the repo means the chart is current without a
 * redeploy. The answer is CDN-cached for ten minutes, which is shorter than the gap between runs.
 *
 * Query: ?symbol=DJT[&days=7]
 * Answer: { symbol, points: [{t, price, liq, vol, turn}], stats: {...} }, oldest first.
 */
const RAW = 'https://raw.githubusercontent.com/usestrak/strak/main/history';
const UA = 'strak-history';
const HOT = 12, PRINTED = 50;

export const config = { maxDuration: 20 };

const day = (d) => new Date(d).toISOString().slice(0, 10);

async function fetchDay(d) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  try {
    const r = await fetch(`${RAW}/${d}.ndjson`, { signal: ac.signal, headers: { 'User-Agent': UA } });
    if (!r.ok) return [];                       // a day with no snapshots simply has no file
    return (await r.text()).trim().split('\n').filter(Boolean);
  } catch { return []; } finally { clearTimeout(t); }
}

export default async function handler(req, res) {
  const symbol = String(req.query?.symbol || '').trim();
  if (!symbol || !/^[\w.\-]{1,20}$/.test(symbol)) return res.status(400).json({ error: 'bad symbol' });
  const days = Math.min(Math.max(parseInt(req.query?.days, 10) || 7, 1), 30);

  const wanted = Array.from({ length: days }, (_, i) => day(Date.now() - i * 86400000)).reverse();
  const files = await Promise.all(wanted.map(fetchDay));

  const points = [];
  for (const lines of files) {
    for (const line of lines) {
      let snap;
      try { snap = JSON.parse(line); } catch { continue; }
      // a row is [symbol, issuer, price, liquidity, volume 24h, turnover]
      const row = (snap.rows || []).find((r) => r[0] === symbol);
      if (row) points.push({ t: snap.t, price: row[2], liq: row[3], vol: row[4], turn: row[5] });
    }
  }
  points.sort((a, b) => a.t - b.t);

  let stats = null;
  if (points.length) {
    const turns = points.map((p) => p.turn);
    const peak = points.reduce((a, p) => (p.turn > a.turn ? p : a));
    // Time above the line, weighted by the gap each reading stands for. With readings hours apart
    // this is an estimate, so the client only shows it when they are dense enough to mean anything.
    let hotMs = 0, spanMs = 0;
    for (let i = 1; i < points.length; i++) {
      const gap = points[i].t - points[i - 1].t;
      if (gap > 6 * 3600e3) continue;           // a gap that long says nothing about what happened inside it
      spanMs += gap;
      if (points[i - 1].turn > HOT) hotMs += gap;
    }
    stats = {
      readings: points.length,
      from: points[0].t,
      to: points[points.length - 1].t,
      first: points[0].turn,
      last: points[points.length - 1].turn,
      peak: peak.turn,
      peakAt: peak.t,
      low: Math.min(...turns),
      aboveHot: turns.filter((t) => t > HOT).length,
      abovePrinted: turns.filter((t) => t > PRINTED).length,
      coveredHours: +(spanMs / 3600e3).toFixed(1),
      hotHours: +(hotMs / 3600e3).toFixed(1),
    };
  }

  res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
  return res.status(200).json({ symbol, days, points, stats });
}
