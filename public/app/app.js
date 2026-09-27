/* Strak terminal.
   Every tokenized stock on Solana on one board, coloured by turnover: 24h volume over pool depth.
   The board comes from /api/registry (live, CDN-cached) with /data/equities.json as the fallback.
   Candles go through /api/candles, because GeckoTerminal answers the browser with a 429 and no CORS. */

const SOLSCAN = 'https://solscan.io';
const DEXSCREENER = 'https://dexscreener.com/solana';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ISSUER = {
  backpack: 'Backpack Securities',
  xstocks: 'xStocks',
  ondo: 'Ondo Global Markets',
  prestocks: 'PreStocks',
  tessera: 'Tessera',
};
// Pre-IPO tokens track private companies. They live on their own tab because the board's whole
// premise, a listed share you can price the token against, does not hold for them.
const PRE = new Set(['prestocks', 'tessera']);

const state = {
  equities: [],
  preipo: [],
  updatedAt: 0,
  live: false,
  issuer: 'all',
  selected: null,
  sort: 'turn',
  dir: -1,          // -1 largest first, 1 smallest first
  onlySuspect: false,
  q: '',
  iv: '1_MINUTE',    // chart interval, as Jupiter names it; 1m by default, as on GMGN
  ctype: 'mcap',     // market cap by default, as on GMGN; the toolbar switches to price
};

/* ── format ─────────────────────────────────────── */
const usd = (n) => {
  if (!Number.isFinite(n) || n === 0) return '·';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(2);
};
const price = (n) => {
  if (!Number.isFinite(n) || n === 0) return '·';
  if (n >= 1000) return n.toFixed(1);
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toPrecision(3);
};
const pct = (n) => (Number.isFinite(n) ? (n >= 0 ? '+' : '') + n.toFixed(2) + '%' : '·');
const cls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : 'muted');

/* Turnover: 24h volume over pool depth. The whole product in one ratio.
   Under 12 a market is doing what a market does; past 50 the volume is larger than the pool can
   organically carry, which is the signature of the same coins going in a circle. */
const turnover = (e) => (e.liq > 0 ? e.vol24 / e.liq : null);
const band = (t) => (t == null ? null : t > 50 ? 'printed' : t > 12 ? 'hot' : 'organic');
const BAND_WORD = { organic: 'normal trading', hot: 'suspiciously hot', printed: 'volume is painted' };
const BAND_WHY = {
  organic: 'volume fits what this pool can carry',
  hot: 'volume is running far ahead of depth, check the chart before trusting the price',
  printed: 'more volume than the pool can physically turn over, treat the price as unquoted',
};
// log placement so 0.1x..200x all read on one bar
const barPos = (t) => Math.max(1, Math.min(99, (Math.log10(Math.max(t, .1)) + 1) / (Math.log10(200) + 1) * 100));

function marketPhase() {
  const ny = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const d = ny.getDay(), m = ny.getHours() * 60 + ny.getMinutes();
  if (d === 0 || d === 6) return { label: 'US WEEKEND · CLOSED', open: false };
  if (m >= 570 && m < 960) return { label: 'US MARKET OPEN', open: true };
  if (m >= 240 && m < 570) return { label: 'PRE-MARKET', open: false };
  if (m >= 960 && m < 1200) return { label: 'AFTER HOURS', open: false };
  return { label: 'US MARKET CLOSED', open: false };
}

/* ── data ───────────────────────────────────────── */
async function fetchRegistry() {
  for (const url of ['/api/registry', '/data/equities.json']) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) continue;
      const j = await r.json();
      if (j?.equities?.length) return j;
    } catch {}
  }
  return null;
}

function stampUpdated() {
  const age = Math.max(0, Math.round((Date.now() - state.updatedAt) / 1000));
  const when = age < 90 ? `${age}s ago` : age < 5400 ? `${Math.round(age / 60)}m ago`
    : new Date(state.updatedAt).toISOString().slice(0, 10);
  $('updated').textContent = (state.live ? 'live · ' : 'snapshot · ') + when;
}

function applyRegistry(j) {
  const byAddr = new Map([...state.equities, ...state.preipo].map((e) => [e.address, e]));
  state.equities = j.equities.map((n) => Object.assign(byAddr.get(n.address) || {}, n));
  state.preipo = (j.preipo || []).map((n) => Object.assign(byAddr.get(n.address) || {}, n));
  state.updatedAt = j.updatedAt;
  state.live = !!j.live;
  if (state.selected) state.selected = [...state.equities, ...state.preipo].find((e) => e.address === state.selected.address) || state.selected;
  paintCounts();
  stampUpdated();
}

function paintCounts() {
  const L = state.equities;
  const n = (k) => L.filter((e) => e.issuer === k).length;
  $('cAll').textContent = L.length;
  $('cBackpack').textContent = n('backpack');
  $('cXstocks').textContent = n('xstocks');
  $('cOndo').textContent = n('ondo');
  $('cPre').textContent = state.preipo.length;
  $('cFav').textContent = FAV.size;
  $('sCount').textContent = L.length;
  $('sVol').textContent = usd(L.reduce((a, e) => a + e.vol24, 0));
  $('sHot').textContent = L.filter((e) => (turnover(e) || 0) > 12).length;
}

async function refresh() {
  const j = await fetchRegistry();
  if (!j) return;
  applyRegistry(j);
  render();
  buildTape();
  if (state.selected) paintDetail(state.selected);
}

/* ── board ──────────────────────────────────────── */
// column headers sort too: click once for the natural order, again to flip it
const COLS = [['Stock', '', 'ticker'], ['Price', 'r', 'price'], ['24h', 'r c-chg', 'change24'], ['Volume', 'r', 'vol24'], ['Turnover', 'r', 'turn']];
const firstDir = (k) => (k === 'ticker' ? 1 : -1);

/* the watchlist: starred stocks, kept in this browser only */
const FAV = new Set();
try { for (const a of JSON.parse(localStorage.getItem('strak.fav') || '[]')) FAV.add(a); } catch { /* private window */ }
function toggleFav(addr) {
  if (FAV.has(addr)) FAV.delete(addr); else FAV.add(addr);
  try { localStorage.setItem('strak.fav', JSON.stringify([...FAV])); } catch { /* private window */ }
  $('cFav').textContent = FAV.size;
  render();
}
const SORTS = [['turn', 'Turnover'], ['vol24', 'Volume'], ['liq', 'Depth'], ['change24', 'Change'], ['ticker', 'A to Z']];

const match = (e) => {
  const q = state.q.trim().toLowerCase();
  return !q || e.symbol.toLowerCase().includes(q) || e.ticker.toLowerCase().includes(q) || (e.name || '').toLowerCase().includes(q);
};

// The pre-IPO tab swaps the dataset rather than filtering the board: the two never mix.
const dataset = () => (state.issuer === 'preipo' ? state.preipo
  : state.issuer === 'fav' ? [...state.equities, ...state.preipo].filter((e) => FAV.has(e.address))
  : state.equities);

function rows() {
  let l = dataset().filter(match);
  if (!['all', 'preipo', 'fav'].includes(state.issuer)) l = l.filter((e) => e.issuer === state.issuer);
  if (state.onlySuspect) l = l.filter((e) => (turnover(e) || 0) > 12);
  const s = state.sort, d = state.dir;
  const v = (e) => (s === 'turn' ? turnover(e) : e[s]);
  return l.sort((a, b) => {
    if (s === 'ticker') return d * a.ticker.localeCompare(b.ticker);
    const x = v(a), y = v(b);
    // stocks with no reading sink to the bottom whichever way the column is sorted
    if (!Number.isFinite(x) || !Number.isFinite(y)) return (Number.isFinite(y) ? 1 : 0) - (Number.isFinite(x) ? 1 : 0);
    return d * (x - y);
  });
}

function cells(e) {
  const t = turnover(e), bd = band(t);
  const ico = e.icon ? `<img class="ico" src="${esc(e.icon)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="ico"></span>';
  return [
    `<span class="tk"><button class="star${FAV.has(e.address) ? ' on' : ''}" data-fav="${esc(e.address)}" aria-label="${FAV.has(e.address) ? 'Remove from' : 'Add to'} watchlist" title="Watchlist">${FAV.has(e.address) ? '★' : '☆'}</button>${ico}<div><b>${esc(e.symbol)}<i class="idot ${e.issuer}" title="${ISSUER[e.issuer]}"></i></b><i>${esc(e.name || '')}</i></div></span>`,
    `<span class="r">${price(e.price)}</span>`,
    `<span class="r c-chg ${cls(e.change24)}">${pct(e.change24)}</span>`,
    `<span class="r">${usd(e.vol24)}</span>`,
    `<span class="r"><b class="turn ${bd || ''}">${t == null ? '·' : t.toFixed(1) + 'x'}</b></span>`,
  ];
}

function render() {
  const list = rows();
  $('thead').innerHTML = COLS.map(([c, k, key]) => {
    const on = state.sort === key;
    return `<button class="${k}${on ? ' on' : ''}" data-col="${key}" aria-sort="${on ? (state.dir < 0 ? 'descending' : 'ascending') : 'none'}">${c}${on ? `<i>${state.dir < 0 ? '↓' : '↑'}</i>` : ''}</button>`;
  }).join('');
  $('sorts').innerHTML = SORTS.map(([k, label]) =>
    `<button data-sort="${k}"${state.sort === k ? ' class="on"' : ''}>${label}</button>`).join('') +
    `<button data-filter="suspect" class="flt${state.onlySuspect ? ' on' : ''}">Above 12x only</button>`;

  const box = $('rows');
  box.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const e of list) {
    const div = document.createElement('div');
    const bd = band(turnover(e));
    div.className = 'row' + (bd && bd !== 'organic' ? ' ' + bd : '') + (state.selected?.address === e.address ? ' on' : '');
    div.innerHTML = cells(e).join('');
    div.onclick = (ev) => {
      const star = ev.target.closest('.star');
      if (star) { ev.stopPropagation(); toggleFav(e.address); return; }
      select(e);
    };
    frag.appendChild(div);
  }
  box.appendChild(frag);
  if (!list.length) box.innerHTML = state.issuer === 'fav' && !state.q ? '<div class="empty-rows">tap ☆ next to any stock to keep it here</div>' : '<div class="empty-rows">nothing matches</div>';
  $('rowCount').textContent = list.length + ' listed';
}

/* ── detail ─────────────────────────────────────── */
function select(e, opts = {}) {
  state.selected = e;
  document.body.classList.add('has-detail');
  render();
  paintDetail(e);
  loadCandles(e);
  loadWho(e);
  loadHistory(e);
  if (!opts.silent) history.replaceState(null, '', '#' + e.symbol);
}

function paintDetail(e) {
  $('dTicker').textContent = e.symbol;
  $('dName').textContent = e.name || '';
  $('dIssuer').innerHTML = `<i class="idot ${e.issuer}"></i>${ISSUER[e.issuer] || e.issuer}`;
  const ic = $('dIcon');
  if (e.icon) { ic.src = e.icon; ic.hidden = false; ic.onerror = () => { ic.hidden = true; }; } else ic.hidden = true;
  $('dPrice').textContent = e.price ? '$' + price(e.price) : '·';
  const chg = $('dChange');
  chg.textContent = e.change24 ? pct(e.change24) + ' 24h' : '';
  chg.className = 'chg ' + cls(e.change24);

  const t = turnover(e), bd = band(t);
  const box = $('verdict');
  if (t == null) box.hidden = true;
  else {
    box.hidden = false;
    box.className = 'verdict ' + bd;
    box.style.setProperty('--p12', barPos(12) + '%');
    box.style.setProperty('--p50', barPos(50) + '%');
    $('verdictFill').style.width = barPos(t) + '%';
    $('verdictVal').textContent = t.toFixed(1) + 'x';
    $('verdictWord').textContent = BAND_WORD[bd];
    $('verdictWhy').textContent = BAND_WHY[bd];
  }

  const m = [];
  if (e.vol24) m.push(['Volume 24h', usd(e.vol24)]);
  if (e.liq) m.push(['Pool liquidity', usd(e.liq)]);
  if (t) {
    const mins = 1440 / t;
    m.push(['Pool turns over every', mins < 90 ? Math.round(mins) + ' min' : mins < 1440 ? (mins / 60).toFixed(1) + ' h' : (mins / 1440).toFixed(1) + ' days']);
  }
  if (e.txns24) m.push(['Trades 24h', e.txns24.toLocaleString('en-US')]);
  if (e.holders) m.push(['Holders', e.holders.toLocaleString('en-US')]);
  if (e.organic) m.push(['Jupiter organic score', Math.round(e.organic) + ' / 100']);
  $('metrics').innerHTML = m.map(([k, v]) => `<div class="metric"><i>${k}</i><b>${v}</b></div>`).join('');

  $('noRef').hidden = !PRE.has(e.issuer);
  paintCompare(e);

  $('lToken').href = `${SOLSCAN}/token/${e.address}`;
  $('lPool').href = e.pool ? `${SOLSCAN}/account/${e.pool}` : '#';
  $('lPool').hidden = !e.pool;
  $('lDex').href = e.pool ? `${DEXSCREENER}/${e.pool}` : `${DEXSCREENER}/${e.address}`;
  $('dQuote').textContent = e.pool ? `pool: ${e.dex || '?'} · quoted in ${e.quote || '?'}` : 'no pool found';
}

/* One company, several wrappers (IONQ, IONQx, IONQon): the prices should agree. When they don't,
   one of the pools is not pricing the stock. */
function paintCompare(e) {
  const pre = PRE.has(e.issuer);
  const sibs = (pre ? state.preipo : state.equities).filter((x) => x.ticker === e.ticker);
  const box = $('compare');
  if (sibs.length < 2) { box.hidden = true; return; }
  box.hidden = false;
  box.querySelector('.compare-title').textContent = pre ? 'Same company, other issuer' : 'Same stock, other issuers';
  $('compareRows').innerHTML = sibs.map((x) => {
    // Two wrappers of a listed share track the same thing, so the difference between them means
    // something. Two pre-IPO issuers may define a token as a different slice of a notional share,
    // so the same subtraction would be noise dressed up as a signal. It is left out.
    const diff = !pre && e.price && x.price ? (x.price / e.price - 1) * 100 : null;
    const t = turnover(x);
    const mid = x.address === e.address ? '<span class="r muted">this one</span>'
      : pre ? `<span class="r muted">${ISSUER[x.issuer] || x.issuer}</span>`
      : `<span class="r ${cls(diff)}">${pct(diff)}</span>`;
    return `<button data-addr="${x.address}" class="${x.address === e.address ? 'self' : ''}">` +
      `<span class="nm"><i class="idot ${x.issuer}"></i>${esc(x.symbol)}</span>` +
      `<span class="r">$${price(x.price)}</span>${mid}` +
      `<span class="r"><b class="turn ${band(t) || ''}">${t == null ? '·' : t.toFixed(1) + 'x'}</b></span></button>`;
  }).join('') + (pre ? '<p class="compare-note">Each issuer sets its own share fraction, so these prices are not directly comparable.</p>' : '');
}


/* ── turnover over time ─────────────────────────
   The verdict strip says what the pool looks like now. This says whether it has looked like that
   all day. Points come from the hourly snapshot of the whole board, so the line is as
   dense as the scheduler managed, and the panel says plainly how many readings stand behind it. */
const HIST = { cache: new Map(), key: '' };

function histPath(points, w, h, pad, scale) {
  const n = points.length;
  const x = (i) => (n === 1 ? w / 2 : pad + (i / (n - 1)) * (w - pad * 2));
  const y = (v) => h - pad - scale(v) * (h - pad * 2);
  const pts = points.map((p, i) => [x(i), y(p.turn)]);
  if (pts.length < 3) return { line: pts.map(([a, b], i) => (i ? 'L' : 'M') + a.toFixed(1) + ' ' + b.toFixed(1)).join(''), pts, x, y };
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return { line: d, pts, x, y };
}

function drawHistory(j) {
  const box = $('histBody');
  const pts = j.points || [];
  if (pts.length < 2) {
    box.innerHTML = `<p class="hist-empty">${pts.length ? 'only one reading so far' : 'no history for this one yet'}. The board is snapshotted a few times an hour and the record starts 25.09.2026.</p>`;
    return;
  }
  const W = 560, H = 132, PAD = 10;
  const top = Math.max(j.stats.peak * 1.18, 15);
  const scale = (v) => Math.max(0, Math.min(1, v / top));
  const { line, pts: xy, x, y } = histPath(pts, W, H, PAD, scale);
  const b = band(j.stats.last);
  const col = b === 'printed' ? '#3CFFAA' : b === 'hot' ? '#C9A6FF' : 'rgba(225,215,255,.6)';

  // the two thresholds, drawn only where they fall inside the view
  const rule = (v, label, c) => {
    if (v > top) return '';
    const yy = y(v).toFixed(1);
    return `<line x1="${PAD}" y1="${yy}" x2="${W - PAD}" y2="${yy}" stroke="${c}" stroke-width="1" stroke-dasharray="3 4" opacity=".55"/>` +
           `<text x="${W - PAD}" y="${(+yy - 4).toFixed(1)}" text-anchor="end" class="hist-rule">${label}</text>`;
  };

  const dots = xy.map(([px, py], i) =>
    `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${i === xy.length - 1 ? 3.4 : 2.2}" fill="${col}">` +
    `<title>${new Date(pts[i].t).toLocaleString()} · ${pts[i].turn}x · ${usd(pts[i].vol)} on ${usd(pts[i].liq)}</title></circle>`).join('');

  const when = (t) => new Date(t).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  box.innerHTML =
    `<svg class="hist-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Turnover over time">` +
    `<defs><linearGradient id="histFill" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="${col}" stop-opacity=".26"/><stop offset="1" stop-color="${col}" stop-opacity="0"/>` +
    `</linearGradient></defs>` +
    rule(50, '50x', '#3CFFAA') + rule(12, '12x', '#C9A6FF') +
    `<path d="${line}L${xy[xy.length - 1][0].toFixed(1)} ${H - PAD}L${xy[0][0].toFixed(1)} ${H - PAD}Z" fill="url(#histFill)"/>` +
    `<path d="${line}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>` +
    dots + '</svg>' +
    `<div class="hist-axis"><span>${when(j.stats.from)}</span><span>${when(j.stats.to)}</span></div>`;
}

function historySummary(st) {
  const hours = (st.to - st.from) / 3600e3;
  const bits = [`${st.readings} readings over ${hours < 48 ? hours.toFixed(1) + ' h' : (hours / 24).toFixed(1) + ' days'}`];
  bits.push(`peak ${st.peak.toFixed(1)}x`);
  // Readings, not hours: the scheduler leaves gaps, and a reading cannot speak for the hours
  // around it. `coveredHours` and `hotHours` are in the API for anyone who wants to weight them.
  if (st.abovePrinted) bits.push(`above 50x in ${st.abovePrinted} of ${st.readings}`);
  else if (st.aboveHot === st.readings) bits.push('above 12x throughout');
  else if (st.aboveHot) bits.push(`above 12x in ${st.aboveHot} of ${st.readings}`);
  else bits.push('never above 12x');
  return bits.join(' · ');
}

async function loadHistory(e) {
  const box = $('history');
  const key = e.symbol;
  HIST.key = key;
  box.hidden = false;
  $('histSum').textContent = 'reading the record…';
  $('histBody').innerHTML = '';
  let j = HIST.cache.get(key);
  if (!j) {
    try {
      const r = await fetch(`/api/history?symbol=${encodeURIComponent(key)}&days=7`);
      j = r.ok ? await r.json() : null;
    } catch { j = null; }
    if (j) HIST.cache.set(key, j);
  }
  if (HIST.key !== key) return;
  if (!j) { $('histSum').textContent = 'the record is unavailable right now'; return; }
  $('histSum').textContent = j.stats ? historySummary(j.stats) : 'nothing recorded yet';
  drawHistory(j);
}

/* ── chart: laid out like GMGN / TradingView, drawn by Lightweight Charts, updated live ─────
   Candles come newest first from GeckoTerminal. Times are shifted to the viewer's clock, the
   price scale ignores lone spike prints (a wick far outside the bodies is drawn, but off scale),
   and the last bars are re-pulled every 20 to 60 seconds so the chart moves while you watch.
   Around the pane: timeframes, chart type, indicators, image and full screen on top; crosshair,
   trend line, horizontal line and eraser on the left; ranges, clock and scale modes below. */
const TZ = -new Date().getTimezoneOffset() * 60;
const UP = '#089981', DOWN = '#F23645';
const MAS = [['ma7', 7, '#F7A600'], ['ma25', 25, '#C9A6FF'], ['ma99', 99, '#5B8CFF']];
const CH = {
  chart: null, LC: null, candle: null, line: null, vol: null, mas: {}, data: [], timer: null, key: '',
  asLine: false, tool: 'cross', pending: null, trends: [], hlines: [], draw: null, range: 0,
};
const IND = { ma7: true, ma25: true, ma99: false, vol: true };
try { Object.assign(IND, JSON.parse(localStorage.getItem('strak.ind') || '{}')); } catch { /* private window */ }

function robustScale(original) {
  // only in the plain price mode; log and percent scales are left to the library
  if (CH.chart?.priceScale('right').options().mode !== 0) return original();
  const r = CH.chart?.timeScale().getVisibleLogicalRange();
  const D = CH.data;
  if (!r || !D.length) return original();
  const a = Math.max(0, Math.floor(r.from)), b = Math.min(D.length - 1, Math.ceil(r.to));
  if (b < a) return original();
  let lo = Infinity, hi = -Infinity, wlo = Infinity, whi = -Infinity;
  for (let i = a; i <= b; i++) {
    const c = D[i];
    lo = Math.min(lo, c.open, c.close); hi = Math.max(hi, c.open, c.close);
    wlo = Math.min(wlo, c.low); whi = Math.max(whi, c.high);
  }
  const span = (hi - lo) || hi * 0.002 || 1;
  const minValue = Math.max(wlo, lo - span * 0.6);
  const maxValue = Math.min(whi, hi + span * 0.6);
  // A range the library cannot draw throws and kills the chart; hand it back to the default instead.
  if (![minValue, maxValue].every(Number.isFinite) || maxValue <= minValue) return original();
  return { priceRange: { minValue, maxValue }, margins: { above: 10, below: 10 } };
}

function precisionFor(p) { return p >= 1000 ? 2 : p >= 1 ? 2 : p >= 0.01 ? 4 : 6; }

/* trend lines live in a series primitive, so they pan and zoom with the candles */
class Drawings {
  attached({ chart, series, requestUpdate }) { this.chart = chart; this.series = series; this.update = requestUpdate; }
  detached() {}
  updateAllViews() {}
  paneViews() {
    const self = this;
    return [{
      zOrder: () => 'top',
      renderer: () => ({
        draw(target) {
          const all = CH.pending?.to ? [...CH.trends, CH.pending] : CH.trends;
          if (!all.length || !self.series) return;
          target.useBitmapCoordinateSpace(({ context: c, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
            const ts = self.chart.timeScale();
            c.lineWidth = Math.max(1, 2 * hr);
            for (const t of all) {
              const x1 = ts.logicalToCoordinate(t.from.l), x2 = ts.logicalToCoordinate(t.to.l);
              const y1 = self.series.priceToCoordinate(t.from.p), y2 = self.series.priceToCoordinate(t.to.p);
              if ([x1, x2, y1, y2].some((v) => v === null || !Number.isFinite(v))) continue;
              c.strokeStyle = t === CH.pending ? 'rgba(201,166,255,.8)' : '#9945FF';
              c.beginPath(); c.moveTo(x1 * hr, y1 * vr); c.lineTo(x2 * hr, y2 * vr); c.stroke();
              c.fillStyle = '#C9A6FF';
              for (const [x, y] of [[x1, y1], [x2, y2]]) { c.beginPath(); c.arc(x * hr, y * vr, 3.5 * hr, 0, Math.PI * 2); c.fill(); }
            }
          });
        },
      }),
    }];
  }
}

function initChart() {
  if (CH.chart || !window.LightweightCharts) return;
  const LC = CH.LC = window.LightweightCharts;
  CH.chart = LC.createChart($('chart'), {
    autoSize: true,
    layout: { background: { type: 'solid', color: '#0F0F10' }, textColor: 'rgba(255,255,255,.6)', fontFamily: '"Ubuntu Sans Mono", ui-monospace, monospace', fontSize: 11 },
    grid: { vertLines: { color: 'rgba(255,255,255,.035)' }, horzLines: { color: 'rgba(255,255,255,.035)' } },
    watermark: { visible: true, text: 'Strak', fontSize: 120, fontFamily: 'Inter, system-ui, sans-serif', fontStyle: 'bold', color: 'rgba(255,255,255,.035)', horzAlign: 'center', vertAlign: 'center' },
    crosshair: {
      mode: LC.CrosshairMode.Normal,
      vertLine: { color: 'rgba(255,255,255,.3)', width: 1, style: LC.LineStyle.Dashed, labelBackgroundColor: '#2B2B30' },
      horzLine: { color: 'rgba(255,255,255,.3)', width: 1, style: LC.LineStyle.Dashed, labelBackgroundColor: '#2B2B30' },
    },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.14, bottom: 0.22 }, entireTextOnly: true },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, rightOffset: 10, barSpacing: 8, minBarSpacing: 2 },
    handleScroll: { vertTouchDrag: false },
    localization: { locale: 'en-US' },
  });
  // Volume first, so the candles draw over it rather than under; it sits in the bottom fifth.
  CH.vol = CH.chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  CH.vol.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  for (const [id, , color] of MAS) {
    CH.mas[id] = CH.chart.addLineSeries({ color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  }
  CH.line = CH.chart.addLineSeries({ color: '#C9A6FF', lineWidth: 2, visible: false, priceLineStyle: LC.LineStyle.Dotted, autoscaleInfoProvider: robustScale });
  CH.candle = CH.chart.addCandlestickSeries({
    upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN,
    priceLineStyle: LC.LineStyle.Dotted, priceLineWidth: 1, autoscaleInfoProvider: robustScale,
  });
  CH.draw = new Drawings();
  CH.candle.attachPrimitive(CH.draw);
  CH.chart.subscribeCrosshairMove(onCrosshair);
  CH.chart.timeScale().subscribeVisibleLogicalRangeChange(moreHistory);
  // Drawing clicks are read from the DOM, not from the library: it holds a second click back while
  // it waits to see whether it becomes a double click, and a quick second point would be lost.
  // A press that moved more than a few pixels was a pan, not a click.
  const el = $('chart');
  let down = null;
  el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down = null; return; }
    down = null;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const ts = CH.chart.timeScale();
    if (x < 0 || y < 0 || x > ts.width() || y > r.height - ts.height()) return;   // on an axis
    onChartClick({ point: { x, y }, logical: ts.coordinateToLogical(x) });
  });
  applyIndicators();
  chartControls();
}

// A row can arrive with a missing field; a NaN there throws inside the
// charting library and takes the whole chart down, so bad rows are dropped on the way in.
const toBar = (c) => ({ time: c.time + TZ, open: +c.open, high: +c.high, low: +c.low, close: +c.close, value: +c.volume || 0 });
const drawable = (b) => Number.isFinite(b.time) && [b.open, b.high, b.low, b.close, b.value].every(Number.isFinite);
// A source can repeat a bar now and then (two rows with one timestamp), and the
// library throws on anything but strictly rising times: keep the freshest row per time, then sort.
const toBars = (list) => {
  const seen = new Map();
  for (const b of list.map(toBar).filter(drawable)) if (!seen.has(b.time)) seen.set(b.time, b);
  return [...seen.values()].sort((x, y) => x.time - y.time);
};
const volBar = (b) => ({ time: b.time, value: b.value, color: b.close >= b.open ? 'rgba(8,153,129,.5)' : 'rgba(242,54,69,.5)' });

/** Simple moving average of closes, skipping the first n-1 bars that have nothing to average. */
function ma(bars, n) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= n) sum -= bars[i - n].close;
    if (i >= n - 1 && Number.isFinite(sum)) out.push({ time: bars[i].time, value: sum / n });
  }
  return out;
}
const maAt = (bars, n, i) => {
  if (i < n - 1) return null;
  let sum = 0;
  for (let k = i - n + 1; k <= i; k++) sum += bars[k].close;
  return sum / n;
};

// the last price line takes the colour of the last candle, as on every trading screen
function paintLast() {
  const b = CH.data[CH.data.length - 1];
  if (!b) return;
  const col = b.close >= b.open ? UP : DOWN;
  CH.candle.applyOptions({ priceLineColor: col });
  CH.line.applyOptions({ priceLineColor: col });
}

function setSeries() {
  CH.candle.setData(CH.data);
  CH.line.setData(CH.data.map((b) => ({ time: b.time, value: b.close })));
  CH.vol.setData(CH.data.map(volBar));
  for (const [id, n] of MAS) CH.mas[id].setData(ma(CH.data, n));
  paintLast();
}

function legend(bar) {
  const b = bar || CH.data[CH.data.length - 1];
  const e = state.selected;
  if (!b || !e) { $('legend').innerHTML = ''; return; }
  const i = CH.data.indexOf(b);
  if (i < 0) return;
  const d = b.close - b.open;
  const ch = b.open ? (d / b.open) * 100 : 0;
  const c = d >= 0 ? 'up' : 'down';
  const tf = $('tfs').querySelector('.on')?.textContent || '';
  const mas = MAS.filter(([id]) => IND[id]).map(([id, n, color]) => {
    const v = maAt(CH.data, n, i);
    return v ? `<span class="lg-ma" style="color:${color}">MA ${n} <em>${fmtV(v)}</em></span>` : '';
  }).join('');
  $('legend').innerHTML =
    `<div class="lg-row"><span class="lg-id"><b>${esc(e.symbol)}</b> · ${esc(tf)} · Strak</span>` +
    `<span>O <em class="${c}">${fmtV(b.open)}</em> H <em class="${c}">${fmtV(b.high)}</em> ` +
    `L <em class="${c}">${fmtV(b.low)}</em> C <em class="${c}">${fmtV(b.close)}</em> ` +
    `<em class="${c}">${d >= 0 ? '+' : '-'}${fmtV(Math.abs(d)) === '·' ? '0' : fmtV(Math.abs(d))} (${pct(ch)})</em></span></div>` +
    `<div class="lg-row">${IND.vol ? `<span>Volume <em class="${c}">${usd(b.value)}</em></span>` : ''}${mas}</div>`;
}

function barAt(time) { return CH.data.find((c) => c.time === time) || null; }

function onCrosshair(p) {
  legend(p?.time ? barAt(p.time) : null);
  // while a trend line waits for its second point, it follows the cursor
  if (CH.pending && p?.point && p.logical !== undefined) {
    const price = CH.candle.coordinateToPrice(p.point.y);
    if (price !== null) { CH.pending.to = { l: p.logical, p: price }; CH.draw.update?.(); }
  }
}

function onChartClick(p) {
  if (!p?.point || CH.tool === 'cross') return;
  const at = CH.candle.coordinateToPrice(p.point.y);
  if (at === null || !Number.isFinite(at)) return;
  if (CH.tool === 'hline') {
    CH.hlines.push(CH.candle.createPriceLine({ price: at, color: '#9945FF', lineWidth: 1, lineStyle: CH.LC.LineStyle.Solid, axisLabelVisible: true, title: '' }));
    setTool('cross');
  } else if (CH.tool === 'trend') {
    const pt = { l: p.logical, p: at };
    if (!CH.pending) CH.pending = { from: pt, to: null };
    else { CH.trends.push({ from: CH.pending.from, to: pt }); CH.pending = null; setTool('cross'); }
    CH.draw.update?.();
  }
}

function clearDrawings() {
  for (const l of CH.hlines) CH.candle?.removePriceLine(l);
  CH.hlines = []; CH.trends = []; CH.pending = null;
  CH.draw?.update?.();
}

function setTool(t) {
  CH.tool = t;
  CH.pending = null;
  [...$('ctools').children].forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  $('chartWrap').classList.toggle('drawing', t === 'trend' || t === 'hline');
  CH.draw?.update?.();
}

function applyIndicators() {
  for (const [id] of MAS) CH.mas[id]?.applyOptions({ visible: IND[id] && !CH.asLine });
  CH.vol?.applyOptions({ visible: IND.vol });
  document.querySelectorAll('#indMenu input').forEach((i) => { i.checked = !!IND[i.dataset.ind]; });
  try { localStorage.setItem('strak.ind', JSON.stringify(IND)); } catch { /* private window */ }
  legend(null);
}

function setType(asLine) {
  CH.asLine = asLine;
  $('chartWrap').classList.toggle('as-line', asLine);
  const clear = 'rgba(0,0,0,0)';
  // the candle series stays (drawings hang on it); in line mode it is only made invisible
  CH.candle.applyOptions(asLine
    ? { upColor: clear, downColor: clear, wickUpColor: clear, wickDownColor: clear, priceLineVisible: false, lastValueVisible: false }
    : { upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, priceLineVisible: true, lastValueVisible: true });
  CH.line.applyOptions({ visible: asLine });
  applyIndicators();
}

function setScale(which) {
  const ps = CH.chart.priceScale('right');
  const o = ps.options();
  const M = CH.LC.PriceScaleMode;
  if (which === 'auto') ps.applyOptions({ autoScale: !o.autoScale });
  if (which === 'log') ps.applyOptions({ mode: o.mode === M.Logarithmic ? M.Normal : M.Logarithmic });
  if (which === 'pct') ps.applyOptions({ mode: o.mode === M.Percentage ? M.Normal : M.Percentage });
  const n = ps.options();
  const on = { auto: n.autoScale, log: n.mode === M.Logarithmic, pct: n.mode === M.Percentage };
  [...$('cScale').children].forEach((b) => b.classList.toggle('on', !!on[b.dataset.scale]));
}

// ranges pick a timeframe that fits the span, the way the range bar on GMGN does
const RANGE_IV = { 1: '5_MINUTE', 7: '15_MINUTE', 30: '1_HOUR', 180: '4_HOUR' };

function chartControls() {
  $('ctools').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tool === 'erase') { clearDrawings(); setTool('cross'); return; }
    setTool(CH.tool === b.dataset.tool ? 'cross' : b.dataset.tool);
  });
  $('cType').addEventListener('click', () => setType(!CH.asLine));
  $('cInd').addEventListener('click', (e) => {
    e.stopPropagation();
    const m = $('indMenu'); m.hidden = !m.hidden;
    $('cInd').setAttribute('aria-expanded', String(!m.hidden));
  });
  $('indMenu').addEventListener('click', (e) => e.stopPropagation());
  $('indMenu').addEventListener('change', (e) => { const i = e.target; if (i.dataset.ind) { IND[i.dataset.ind] = i.checked; applyIndicators(); } });
  document.addEventListener('click', () => { $('indMenu').hidden = true; $('cInd').setAttribute('aria-expanded', 'false'); });
  $('cShot').addEventListener('click', () => {
    const cv = CH.chart.takeScreenshot();
    cv.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `strak-${(state.selected?.symbol || 'chart').toLowerCase()}-${($('tfs').querySelector('.on')?.textContent || '').toLowerCase()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });
  });
  $('cFull').addEventListener('click', () => {
    const w = $('chartWrap');
    if (document.fullscreenElement) document.exitFullscreen?.(); else w.requestFullscreen?.();
  });
  $('cScale').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setScale(b.dataset.scale); });
  $('cPm').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.dataset.type === state.ctype) return;
    state.ctype = b.dataset.type;
    [...$('cPm').querySelectorAll('button')].forEach((c) => c.classList.toggle('on', c === b));
    if (state.selected) loadCandles(state.selected);
  });
  $('ranges').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const days = +b.dataset.range;
    CH.range = days;
    state.iv = RANGE_IV[days];
    [...$('tfs').children].forEach((c) => c.classList.toggle('on', c.dataset.iv === state.iv));
    [...$('ranges').children].forEach((c) => c.classList.toggle('on', c === b));
    if (state.selected) loadCandles(state.selected);
  });
  // the clock at the bottom right, in the viewer's time zone like the axis
  const off = -new Date().getTimezoneOffset() / 60;
  const zone = 'UTC' + (off ? (off > 0 ? '+' : '') + off : '');
  const clock = () => { const d = new Date(); $('cClock').textContent = `${d.toTimeString().slice(0, 8)} ${zone}`; };
  clock(); setInterval(clock, 1000);
}

/* ── candles: Jupiter's chart data, the source jup.ag itself draws from ──
   Token level (every pool of the token at once, the same scope as the registry's volume), each
   candle already opening at the previous close, history back to the token's first trade, and CORS
   open to this site, so every visitor spends their own limit instead of one shared server's.
   /api/candles is the fallback: it asks Jupiter from the server and, failing that, GeckoTerminal. */
const JUP = 'https://datapi.jup.ag/v2/charts/';
const LIVE_MS = { '1_SECOND': 2000, '15_SECOND': 5000, '1_MINUTE': 10000, '5_MINUTE': 20000, '15_MINUTE': 30000, '1_HOUR': 60000, '4_HOUR': 60000, '1_DAY': 120000 };
const CACHE = new Map();   // `${mint}:${interval}:${type}` → { bars, t }

async function fetchCandles(e, iv, type, toMs, n, signal) {
  const q = `interval=${iv}&to=${Math.floor(toMs)}&candles=${n}&type=${type}&quote=usd`;
  try {
    const r = await fetch(`${JUP}${e.address}?${q}`, { signal });
    if (r.ok) { const j = await r.json(); if (Array.isArray(j.candles)) return j.candles; }
  } catch (err) { if (err.name === 'AbortError') throw err; }
  const r = await fetch(`/api/candles?mint=${e.address}${e.pool ? `&pool=${e.pool}` : ''}&${q}`, { signal });
  if (!r.ok) return null;
  const j = await r.json();
  return Array.isArray(j.candles) ? j.candles : null;
}

// how a value reads in the legend and on the scale: a price, or a market cap in $K/$M/$B
const fmtV = (v) => (state.ctype === 'mcap' ? usd(v) : price(v));

function showBars(bars, fresh) {
  CH.data = bars;
  const fmt = state.ctype === 'mcap'
    ? { priceFormat: { type: 'custom', minMove: 0.01, formatter: (v) => usd(v).replace('$', '') } }
    : (() => { const p = precisionFor(bars[bars.length - 1].close); return { priceFormat: { type: 'price', precision: p, minMove: 1 / 10 ** p } }; })();
  // every series on the right scale gets the format: the scale labels follow the first one added (an MA)
  for (const x of [CH.candle, CH.line, ...Object.values(CH.mas)]) x.applyOptions(fmt);
  setSeries();
  const ts = CH.chart.timeScale();
  if (CH.range) {
    // a range button asked for a span of days: show exactly that much, or all there is
    const last = bars[bars.length - 1].time;
    ts.setVisibleRange({ from: Math.max(bars[0].time, last - CH.range * 86400), to: last });
    CH.range = 0;
  } else if (fresh) {
    // the recent stretch at a readable width rather than hundreds of bars squeezed in
    const span = Math.min(bars.length, $('chart').clientWidth < 600 ? 60 : 130);
    ts.setVisibleLogicalRange({ from: bars.length - span, to: bars.length + 8 });
  }
  legend(null);
}

function clearSeries() {
  CH.data = [];
  CH.candle?.setData([]); CH.line?.setData([]); CH.vol?.setData([]);
  for (const s of Object.values(CH.mas)) s.setData([]);
  legend(null);
}

async function loadCandles(e) {
  initChart();
  const wrap = $('chartWrap');
  clearInterval(CH.timer);
  CH.abort?.abort();
  const ac = CH.abort = new AbortController();
  clearDrawings();
  const iv = state.iv, type = state.ctype;
  const key = `${e.address}:${iv}:${type}`;
  CH.key = key; CH.more = false; CH.exhausted = false;
  wrap.classList.remove('empty', 'loading');
  // what this view looked like last time shows at once; fresh candles replace it below
  const hit = CACHE.get(key);
  if (hit?.bars.length) showBars(hit.bars, true);
  else { clearSeries(); $('chartEmpty').textContent = 'loading candles'; wrap.classList.add('loading'); }
  let list = null;
  for (let attempt = 0; attempt < 3 && !list; attempt++) {
    try { list = await fetchCandles(e, iv, type, Date.now(), CH.range ? 1000 : 600, ac.signal); }
    catch (err) { if (err.name === 'AbortError') return; }
    if (CH.key !== key) return;   // the viewer moved on
    if (!list) await new Promise((r) => setTimeout(r, 900 * (attempt + 1)));
  }
  if (CH.key !== key) return;
  wrap.classList.remove('loading');
  const bars = list ? toBars(list) : [];
  if (bars.length) {
    CACHE.set(key, { bars, t: Date.now() });
    showBars(bars, !hit);
  } else if (!hit) {
    $('chartEmpty').textContent = list ? 'no trades in this window yet' : 'candles did not load, trying again';
    wrap.classList.add('empty');
    if (!list) setTimeout(() => { if (CH.key === key && !CH.data.length) loadCandles(e); }, 5000);
  }
  CH.timer = setInterval(() => tick(e, key), LIVE_MS[iv] || 30000);
}

// scrolling to the left edge pulls the next 500 bars of history, back to the first trade
async function moreHistory(r) {
  if (!r || r.from > 25 || CH.more || CH.exhausted || !CH.data.length || !state.selected) return;
  CH.more = true;
  const key = CH.key, e = state.selected;
  let older = null;
  try { older = await fetchCandles(e, state.iv, state.ctype, (CH.data[0].time - TZ) * 1000 - 1, 500, CH.abort?.signal); } catch { /* aborted */ }
  if (CH.key !== key) { CH.more = false; return; }
  const bars = older ? toBars(older).filter((b) => b.time < CH.data[0].time) : [];
  if (!bars.length) { CH.exhausted = true; CH.more = false; return; }
  const ts = CH.chart.timeScale();
  const cur = ts.getVisibleLogicalRange();
  for (const t of CH.trends) { t.from.l += bars.length; t.to.l += bars.length; }
  CH.data = [...bars, ...CH.data];
  setSeries();
  if (cur) ts.setVisibleLogicalRange({ from: cur.from + bars.length, to: cur.to + bars.length });
  CACHE.set(key, { bars: CH.data, t: Date.now() });
  CH.more = false;
}

async function tick(e, key) {
  if (document.hidden || CH.key !== key || CH.more) return;
  let list = null;
  try { list = await fetchCandles(e, state.iv, state.ctype, Date.now(), 3, CH.abort?.signal); } catch { return; }
  if (CH.key !== key || !list?.length) return;
  const bars = toBars(list);
  if (!bars.length) return;
  if (!CH.data.length) { loadCandles(e); return; }
  const last = CH.data[CH.data.length - 1].time;
  let touched = false;
  for (const b of bars) {
    if (b.time < last) continue;
    CH.candle.update(b);
    CH.line.update({ time: b.time, value: b.close });
    CH.vol.update(volBar(b));
    if (b.time === CH.data[CH.data.length - 1].time) CH.data[CH.data.length - 1] = b; else CH.data.push(b);
    touched = true;
  }
  if (touched) {
    const i = CH.data.length - 1;
    for (const [id, n] of MAS) {
      const v = maAt(CH.data, n, i);
      if (Number.isFinite(v)) CH.mas[id].update({ time: CH.data[i].time, value: v });
    }
    paintLast();
    CACHE.set(key, { bars: CH.data, t: Date.now() });
  }
  legend(null);
  if (state.ctype !== 'price') return;
  // the last trade is the freshest price there is
  const lp = CH.data[CH.data.length - 1].close;
  const el = $('dPrice');
  const txt = '$' + price(lp);
  if (el.textContent !== txt) {
    const up = parseFloat(el.textContent.slice(1)) < lp;
    el.textContent = txt;
    el.classList.remove('flash-up', 'flash-down'); void el.offsetWidth; el.classList.add(up ? 'flash-up' : 'flash-down');
  }
}

/* ── who trades this pool ─────────────────────── */
const shortW = (w) => w.slice(0, 4) + '…' + w.slice(-4);
const cash = (n) => (n >= 1000 ? usd(n) : '$' + n.toFixed(2));
let whoTimer = null;
async function loadWho(e) {
  clearInterval(whoTimer);
  const box = $('who');
  if (!e.address) { box.hidden = true; return; }
  box.hidden = false;
  const run = async () => {
    if (document.hidden) return;
    try {
      const r = await fetch(`/api/trades?mint=${e.address}${e.pool ? `&pool=${e.pool}` : ''}`);
      if (state.selected?.address !== e.address) return;
      if (!r.ok) {
        // keep the last good reading on screen; only an empty panel says it is still trying
        if (!$('whoOut').querySelector('.who-stats')) {
          $('whoOut').innerHTML = '<p class="muted">swaps did not load, trying again</p>';
          setTimeout(() => { if (state.selected?.address === e.address) run(); }, 5000);
        }
        return;
      }
      const { stats: s, scope } = await r.json();
      const max = s.top[0]?.usd || 1;
      $('whoOut').innerHTML = `
        <div class="who-stats">
          <div><i>Trades a minute</i><b>${s.perMin == null ? '·' : s.perMin.toFixed(1)}</b></div>
          <div><i>Median trade</i><b>${cash(s.median)}</b></div>
          <div><i>Wallets</i><b>${s.wallets}</b></div>
          <div><i>Top 3 wallets</i><b class="${s.top3Share > .5 ? 'hot' : ''}">${(s.top3Share * 100).toFixed(1)}%</b></div>
          <div><i>Bought and sold</i><b>${s.roundTripWallets} · ${(s.roundTripShare * 100).toFixed(1)}%</b></div>
        </div>
        <div class="who-top">${s.top.map((w, i) => `<a href="https://solscan.io/account/${w.wallet}" target="_blank" rel="noopener"><span>#${i + 1} ${shortW(w.wallet)}</span><em>${w.buy} buy · ${w.sell} sell</em><b>${cash(w.usd)}</b><i style="width:${(w.usd / max * 100).toFixed(1)}%"></i></a>`).join('')}</div>
        <p class="who-note">Last ${s.count} swaps ${scope === 'pool' ? 'in the deepest pool' : 'across every pool'}, ${s.minutes < 90 ? Math.round(s.minutes) + ' min' : (s.minutes / 60).toFixed(1) + ' h'} of trading. Refreshes every 30 s.</p>`;
    } catch {}
  };
  $('whoOut').innerHTML = '<p class="muted">reading the latest swaps…</p>';
  await run();
  whoTimer = setInterval(run, 30000);
}

/* ── tape: highest turnover first ───────────────── */
function buildTape() {
  const top = [...state.equities].sort((a, b) => (turnover(b) || 0) - (turnover(a) || 0)).slice(0, 24);
  const html = top.map((e) => {
    const t = turnover(e);
    return `<a href="#${encodeURIComponent(e.symbol)}"><i class="idot ${e.issuer}"></i><b>${esc(e.symbol)}</b>` +
      `<span class="${band(t)}">${t.toFixed(1)}x</span><span class="${cls(e.change24)}">${pct(e.change24)}</span></a>`;
  }).join('');
  $('tapeTrack').innerHTML = html + html;
}

/* ── wiring ─────────────────────────────────────── */
function wire() {
  $('q').addEventListener('input', (e) => { state.q = e.target.value; render(); });

  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.issuer = b.dataset.issuer;
    [...$('tabs').children].forEach((c) => c.classList.toggle('on', c === b));
    render();
  });

  $('sorts').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.filter === 'suspect') state.onlySuspect = !state.onlySuspect;
    else { state.sort = b.dataset.sort; state.dir = firstDir(state.sort); }
    render();
  });

  $('thead').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-col]'); if (!b) return;
    const k = b.dataset.col;
    if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = firstDir(k); }
    render();
  });

  $('tfs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.iv = b.dataset.iv;
    [...$('tfs').children].forEach((c) => c.classList.toggle('on', c === b));
    CH.range = 0;
    [...$('ranges').children].forEach((c) => c.classList.remove('on'));
    if (state.selected) loadCandles(state.selected);
  });

  $('compareRows').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b || b.classList.contains('self')) return;
    const hit = [...state.equities, ...state.preipo].find((x) => x.address === b.dataset.addr);
    if (hit) select(hit);
  });

  // On a phone the board and the chart cannot share a screen: selecting swaps to the detail,
  // and this button swaps back.
  $('back').addEventListener('click', () => {
    document.body.classList.remove('has-detail');
    history.replaceState(null, '', location.pathname);
  });

  window.addEventListener('hashchange', openFromHash);
}

/* Deep link: /app#IONQ or /app#NVDAx opens straight on that market, so a post can point at one name.
   The exact symbol wins; a bare ticker falls back to its deepest wrapper. */
function openFromHash() {
  const t = decodeURIComponent(location.hash.replace('#', '')).trim().toLowerCase();
  if (!t) return false;
  // /app#issuer=backpack opens the board filtered to one issuer
  const iss = t.match(/^issuer=(\w+)$/);
  if (iss) {
    const b = document.querySelector(`#tabs button[data-issuer="${iss[1]}"]`);
    if (b) b.click();
    return false;
  }
  const all = [...state.equities, ...state.preipo];
  const hit = all.find((e) => e.symbol.toLowerCase() === t)
    || all.filter((e) => e.ticker.toLowerCase() === t).sort((a, b) => b.liq - a.liq)[0];
  if (!hit) return false;
  if (PRE.has(hit.issuer) && state.issuer !== 'preipo') {
    document.querySelector('#tabs button[data-issuer="preipo"]')?.click();
  }
  select(hit, { silent: true });
  return true;
}

async function main() {
  const ph = marketPhase();
  $('phasePill').textContent = ph.label;
  $('phasePill').className = 'pill ' + (ph.open ? 'open' : 'closed');

  wire();
  const j = await fetchRegistry();
  if (!j) { $('rows').innerHTML = '<div class="empty-rows">registry unavailable, try again in a minute</div>'; return; }
  applyRegistry(j);
  render();
  buildTape();

  if (!openFromHash() && state.equities.length && window.innerWidth > 900) {
    select(rows()[0], { silent: true });
  }

  setInterval(refresh, 120000);   // the CDN entry lives five minutes; polling faster buys nothing
  setInterval(stampUpdated, 30000);
}

main();
