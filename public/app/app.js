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
  onlySuspect: false,
  q: '',
  tf: { tf: 'minute', agg: 15 },
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
const COLS = [['Stock', ''], ['Price', 'r'], ['24h', 'r c-chg'], ['Volume', 'r'], ['Turnover', 'r']];
const SORTS = [['turn', 'Turnover'], ['vol24', 'Volume'], ['liq', 'Depth'], ['change24', 'Change'], ['ticker', 'A to Z']];

const match = (e) => {
  const q = state.q.trim().toLowerCase();
  return !q || e.symbol.toLowerCase().includes(q) || e.ticker.toLowerCase().includes(q) || (e.name || '').toLowerCase().includes(q);
};

// The pre-IPO tab swaps the dataset rather than filtering the board: the two never mix.
const dataset = () => (state.issuer === 'preipo' ? state.preipo : state.equities);

function rows() {
  let l = dataset().filter(match);
  if (state.issuer !== 'all' && state.issuer !== 'preipo') l = l.filter((e) => e.issuer === state.issuer);
  if (state.onlySuspect) l = l.filter((e) => (turnover(e) || 0) > 12);
  const s = state.sort;
  return l.sort((a, b) => (s === 'ticker' ? a.ticker.localeCompare(b.ticker)
    : s === 'turn' ? (turnover(b) || 0) - (turnover(a) || 0)
    : (b[s] || 0) - (a[s] || 0)));
}

function cells(e) {
  const t = turnover(e), bd = band(t);
  const ico = e.icon ? `<img class="ico" src="${esc(e.icon)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="ico"></span>';
  return [
    `<span class="tk">${ico}<div><b>${esc(e.symbol)}<i class="idot ${e.issuer}" title="${ISSUER[e.issuer]}"></i></b><i>${esc(e.name || '')}</i></div></span>`,
    `<span class="r">${price(e.price)}</span>`,
    `<span class="r c-chg ${cls(e.change24)}">${pct(e.change24)}</span>`,
    `<span class="r">${usd(e.vol24)}</span>`,
    `<span class="r"><b class="turn ${bd || ''}">${t == null ? '·' : t.toFixed(1) + 'x'}</b></span>`,
  ];
}

function render() {
  const list = rows();
  $('thead').innerHTML = COLS.map(([c, k]) => `<span class="${k}">${c}</span>`).join('');
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
    div.onclick = () => select(e);
    frag.appendChild(div);
  }
  box.appendChild(frag);
  if (!list.length) box.innerHTML = '<div class="empty-rows">nothing matches</div>';
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

/* ── chart: TradingView Lightweight Charts, updated live ─────────────
   Candles come newest first from GeckoTerminal. Times are shifted to the viewer's clock, the
   price scale ignores lone spike prints (a wick far outside the bodies is drawn, but off scale),
   and the last bars are re-pulled every 15 to 60 seconds so the chart moves while you watch. */
const TZ = -new Date().getTimezoneOffset() * 60;
const CH = { chart: null, candle: null, vol: null, ma7: null, ma25: null, data: [], timer: null, key: '' };

function robustScale(original) {
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

function initChart() {
  if (CH.chart || !window.LightweightCharts) return;
  const LC = window.LightweightCharts;
  CH.chart = LC.createChart($('chart'), {
    autoSize: true,
    layout: { background: { type: 'solid', color: 'transparent' }, textColor: 'rgba(225,215,255,.55)', fontFamily: '"Ubuntu Sans Mono", ui-monospace, monospace', fontSize: 11 },
    grid: { vertLines: { color: 'rgba(255,255,255,.035)' }, horzLines: { color: 'rgba(255,255,255,.035)' } },
    crosshair: {
      mode: LC.CrosshairMode.Normal,
      vertLine: { color: 'rgba(201,166,255,.35)', width: 1, style: LC.LineStyle.Dashed, labelBackgroundColor: '#2A1D52' },
      horzLine: { color: 'rgba(201,166,255,.35)', width: 1, style: LC.LineStyle.Dashed, labelBackgroundColor: '#2A1D52' },
    },
    rightPriceScale: { borderColor: 'rgba(255,255,255,.07)', scaleMargins: { top: 0.12, bottom: 0.26 }, entireTextOnly: true },
    timeScale: { borderColor: 'rgba(255,255,255,.07)', timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 10, minBarSpacing: 3 },
    handleScroll: { vertTouchDrag: false },
  });
  // Volume first, so the candles draw over it rather than under.
  CH.vol = CH.chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  CH.vol.priceScale().applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });
  // Moving averages: the two lines every trading screen carries, so the trend reads at a glance.
  CH.ma7 = CH.chart.addLineSeries({ color: '#C9A6FF', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  CH.ma25 = CH.chart.addLineSeries({ color: '#5B8CFF', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  CH.candle = CH.chart.addCandlestickSeries({
    upColor: '#2EBD85', downColor: '#F6465D', borderVisible: false, wickUpColor: '#2EBD85', wickDownColor: '#F6465D',
    priceLineColor: 'rgba(201,166,255,.8)', priceLineStyle: LC.LineStyle.Dashed, priceLineWidth: 1,
    autoscaleInfoProvider: robustScale,
  });
  CH.chart.subscribeCrosshairMove((p) => legend(p?.time ? CH.data.find((c) => c.time === p.time) : null));
}

// GeckoTerminal occasionally returns a row with a missing field; a NaN there throws inside the
// charting library and takes the whole chart down, so bad rows are dropped on the way in.
const toBar = (c) => ({ time: c[0] + TZ, open: +c[1], high: +c[2], low: +c[3], close: +c[4], value: +c[5] || 0 });
const drawable = (b) => Number.isFinite(b.time) && [b.open, b.high, b.low, b.close, b.value].every(Number.isFinite);
const toBars = (list) => list.map(toBar).filter(drawable).reverse();
const volBar = (b) => ({ time: b.time, value: b.value, color: b.close >= b.open ? 'rgba(46,189,133,.45)' : 'rgba(246,70,93,.45)' });

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

function legend(bar) {
  const b = bar || CH.data[CH.data.length - 1];
  const e = state.selected;
  if (!b || !e) { $('legend').innerHTML = ''; return; }
  const i = CH.data.indexOf(b);
  if (i < 0) return;
  const ch = b.open ? (b.close / b.open - 1) * 100 : 0;
  const c = ch >= 0 ? 'up' : 'down';
  const m7 = maAt(CH.data, 7, i), m25 = maAt(CH.data, 25, i);
  $('legend').innerHTML =
    `<span class="lg-id"><b>${esc(e.symbol)}</b><span class="tfl">${$('tfs').querySelector('.on')?.textContent || ''}</span></span>` +
    `<span class="lg-ohlc">O <em class="${c}">${price(b.open)}</em> H <em class="${c}">${price(b.high)}</em> ` +
    `L <em class="${c}">${price(b.low)}</em> C <em class="${c}">${price(b.close)}</em> <em class="${c}">${pct(ch)}</em></span>` +
    (m7 ? `<span class="lg-ma ma7">MA7 ${price(m7)}</span>` : '') +
    (m25 ? `<span class="lg-ma ma25">MA25 ${price(m25)}</span>` : '') +
    `<span class="lg-vol">Vol ${usd(b.value)}</span>`;
}

async function candles(pool, token, tf, agg) {
  try {
    const r = await fetch(`/api/candles?pool=${pool}&token=${token}&tf=${tf}&agg=${agg}&limit=300`);
    if (!r.ok) return null;
    const j = await r.json();
    return j.ohlcv || [];
  } catch { return null; }
}

async function loadCandles(e) {
  initChart();
  const wrap = $('chartWrap');
  clearInterval(CH.timer);
  CH.data = [];
  CH.candle?.setData([]); CH.vol?.setData([]); CH.ma7?.setData([]); CH.ma25?.setData([]);
  legend(null);
  wrap.classList.remove('empty');
  if (!e.pool) { $('chartEmpty').textContent = 'no pool for this token'; wrap.classList.add('empty'); return; }
  $('chartEmpty').textContent = 'loading candles';
  wrap.classList.add('loading');
  const { tf, agg } = state.tf;
  const key = `${e.pool}:${tf}:${agg}`;
  CH.key = key;
  const list = await candles(e.pool, e.address, tf, agg);
  if (CH.key !== key) return;   // user moved on
  wrap.classList.remove('loading');
  const bars = list ? toBars(list) : null;
  if (!bars?.length) {
    $('chartEmpty').textContent = list ? 'no candles for this pool right now' : 'candles are rate limited, retrying';
    wrap.classList.add('empty');
    // An empty first load should not leave a dead panel: try again shortly.
    if (!list) setTimeout(() => { if (CH.key === key && !CH.data.length) loadCandles(e); }, 8000);
  }
  else {
    CH.data = bars;
    const p = precisionFor(CH.data[CH.data.length - 1].close);
    CH.candle.applyOptions({ priceFormat: { type: 'price', precision: p, minMove: 1 / 10 ** p } });
    CH.candle.setData(CH.data);
    CH.vol.setData(CH.data.map(volBar));
    CH.ma7.setData(ma(CH.data, 7));
    CH.ma25.setData(ma(CH.data, 25));
    // Show the recent stretch at a readable width rather than squeezing 300 bars in.
    const span = Math.min(CH.data.length, 90);
    CH.chart.timeScale().setVisibleLogicalRange({ from: CH.data.length - span, to: CH.data.length + 6 });
    legend(null);
  }
  // live: pull the latest bars again; the proxy caches 45 s, so faster polling buys nothing
  const every = tf === 'minute' ? 20000 : 60000;
  CH.timer = setInterval(() => tick(e, key), every);
}

async function tick(e, key) {
  if (document.hidden || CH.key !== key) return;
  const { tf, agg } = state.tf;
  const list = await candles(e.pool, e.address, tf, agg);
  if (CH.key !== key || !list?.length) return;
  const bars = toBars(list);
  if (!bars.length) return;
  if (!CH.data.length) { loadCandles(e); return; }
  const last = CH.data[CH.data.length - 1].time;
  let touched = false;
  for (const b of bars) {
    if (b.time < last) continue;
    CH.candle.update(b);
    CH.vol.update(volBar(b));
    if (b.time === CH.data[CH.data.length - 1].time) CH.data[CH.data.length - 1] = b; else CH.data.push(b);
    touched = true;
  }
  if (touched) {
    const i = CH.data.length - 1;
    const m7 = maAt(CH.data, 7, i), m25 = maAt(CH.data, 25, i);
    if (Number.isFinite(m7)) CH.ma7.update({ time: CH.data[i].time, value: m7 });
    if (Number.isFinite(m25)) CH.ma25.update({ time: CH.data[i].time, value: m25 });
  }
  legend(null);
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
  if (!e.pool) { box.hidden = true; return; }
  box.hidden = false;
  const run = async () => {
    if (document.hidden) return;
    try {
      const r = await fetch(`/api/trades?pool=${e.pool}`);
      if (state.selected?.address !== e.address) return;
      if (!r.ok) { $('whoOut').innerHTML = '<p class="muted">swaps are rate limited right now, retrying</p>'; return; }
      const { stats: s } = await r.json();
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
        <p class="who-note">Last ${s.count} swaps, ${s.minutes < 90 ? Math.round(s.minutes) + ' min' : (s.minutes / 60).toFixed(1) + ' h'} of trading. Refreshes every 30 s.</p>`;
    } catch {}
  };
  $('whoOut').innerHTML = '<p class="muted">reading the last 300 swaps…</p>';
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
    else state.sort = b.dataset.sort;
    render();
  });

  $('tfs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    state.tf = { tf: b.dataset.tf, agg: +b.dataset.agg };
    [...$('tfs').children].forEach((c) => c.classList.toggle('on', c === b));
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
