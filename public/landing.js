/* Strak landing. Every number on this page comes from the registry: /api/registry live,
   /data/equities.json when the live route is down. The only dated figure is the case file,
   which is read from /data/cases.json and labelled with its date. */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ── format ───────────────────────────────────────── */
const usd = (n) => {
  if (!Number.isFinite(n) || n === 0) return '$0';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return '$' + n.toFixed(0);
};
const price = (n) => (n >= 1000 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toPrecision(3));
const tx = (t) => t.toFixed(1) + 'x';
const band = (t) => (t > 50 ? 'printed' : t > 12 ? 'hot' : 'organic');
const BAND_WORD = { organic: 'Normal trading', hot: 'Suspiciously hot', printed: 'Volume is painted' };
const ISS = {
  backpack: { name: 'Backpack Securities', short: 'Backpack', sfx: 'no suffix', color: 'var(--dot-backpack)' },
  xstocks: { name: 'xStocks', short: 'xStocks', sfx: 'suffix x', color: 'var(--dot-xstocks)' },
  ondo: { name: 'Ondo Global Markets', short: 'Ondo', sfx: 'suffix on', color: 'var(--dot-ondo)' },
};
const ago = (ms) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return 'just now';
  if (s < 5400) return Math.round(s / 60) + ' min ago';
  if (s < 172800) return Math.round(s / 3600) + ' h ago';
  return new Date(ms).toISOString().slice(0, 10);
};
// How often the whole pool changes hands at this turnover: the plainest way to say what a ratio means.
const every = (t) => {
  const m = 1440 / t;
  if (m < 90) return `${Math.round(m)} minutes`;
  if (m < 1440) return `${(m / 60).toFixed(1)} hours`;
  return `${(m / 1440).toFixed(1)} days`;
};
const appLink = (e) => '/app#' + encodeURIComponent(e.symbol || e.ticker);

/* ── data ─────────────────────────────────────────── */
async function getJson(url, ms = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}
async function registry() {
  const live = await getJson('/api/registry');
  if (live?.equities?.length) return live;
  return getJson('/data/equities.json');
}

/* ── hero: chips ──────────────────────────────────── */
// Slots as on the banner: x/y in % of the hero, s scale, r tilt, d parallax depth, blur for far ones.
const SLOTS_WIDE = [
  { x: 78, y: 25, s: 1.18, r: 7, d: 18 },                 // the hottest one
  { x: 19, y: 25, s: 1, r: -7, d: 14 },
  { x: 86, y: 66, s: 1, r: -6, d: 14 },
  { x: 14, y: 58, s: .88, r: 6, d: 12 },
  { x: 31, y: 83, s: .76, r: 5, d: 10 },
  { x: 68, y: 86, s: .74, r: 4, d: 10 },
  { x: 95, y: 12, s: .78, r: -9, d: 5, blur: 5 },
  { x: 4, y: 13, s: .82, r: 10, d: 5, blur: 6 },
  { x: 3, y: 84, s: 1.25, r: 8, d: 4, blur: 8 },
  { x: 99, y: 44, s: .86, r: -4, d: 4, blur: 6 },
];
const SLOTS_NARROW = [
  { x: 70, y: 86, s: .8, r: 6, d: 0 },
  { x: 26, y: 92, s: .68, r: -5, d: 0 },
  { x: 6, y: 80, s: .7, r: 8, d: 0, blur: 4 },
  { x: 97, y: 96, s: .66, r: -6, d: 0, blur: 4 },
];

function paintChips(list) {
  const narrow = matchMedia('(max-width: 720px)').matches;
  const slots = narrow ? SLOTS_NARROW : SLOTS_WIDE;
  const pick = [...list].sort((a, b) => b.turnover - a.turnover).slice(0, slots.length);
  $('chips').innerHTML = pick.map((e, i) => {
    const sl = slots[i];
    const hot = i === 0 ? ' hot' : '';
    const far = sl.blur ? ' far' : '';
    const style = `--x:${sl.x}%;--y:${sl.y}%;--d:${sl.d};--blur:${sl.blur || 0}px`;
    const cs = `--s:${sl.s};--r:${sl.r}deg;--t:${7 + (i % 4) * 1.3}s;--delay:${-i * 1.7}s`;
    return `<div class="slot${far}" style="${style}"><a class="chip${hot}" style="${cs}" href="${appLink(e)}" tabindex="-1">` +
      `<i class="d ${e.issuer}"></i><b>${esc(e.symbol)}</b><em>${odo('chip-' + e.address, tx(e.turnover))}</em></a></div>`;
  }).join('');
}

function parallax() {
  const hero = $('hero'), chips = $('chips');
  if (!matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let raf = 0, mx = 0, my = 0;
  hero.addEventListener('pointermove', (ev) => {
    const r = hero.getBoundingClientRect();
    mx = ((ev.clientX - r.left) / r.width - .5) * 2;
    my = ((ev.clientY - r.top) / r.height - .5) * 2;
    if (!raf) raf = requestAnimationFrame(() => {
      raf = 0;
      chips.style.setProperty('--mx', (-mx).toFixed(3));
      chips.style.setProperty('--my', (-my).toFixed(3));
    });
  }, { passive: true });
}

/* ── the page answers the cursor ────────────────────
   Three reactions, all of them transform or a single card's own paint, so none of it touches
   scrolling. A light that trails the pointer, a highlight that follows it across whatever card is
   under it, and buttons that lean towards it. Everything reads the pointer once per frame from one
   listener, never per element. Touch screens and reduced-motion get none of it. */
function cursor() {
  if (!matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const glow = document.getElementById('glow');
  const bg = document.getElementById('bg');
  const CARDS = '.feat, .step, .plan, .b-card, .hot-card, .faq details, .r-vis, .dash-promo, .end';

  let px = innerWidth / 2, py = innerHeight / 2;   // where the pointer is
  let gx = px, gy = py;                            // where the light has got to
  let card = null, cRect = null;
  let raf = 0, moved = false;

  addEventListener('pointermove', (e) => {
    px = e.clientX; py = e.clientY;
    moved = true;
    const hit = e.target.closest?.(CARDS) || null;
    if (hit !== card) {
      card?.classList.remove('lit');
      card = hit;
      if (card) { card.classList.add('lit'); cRect = card.getBoundingClientRect(); }
    } else if (card) {
      cRect = card.getBoundingClientRect();
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }, { passive: true });

  addEventListener('pointerleave', () => { card?.classList.remove('lit'); card = null; }, { passive: true });
  addEventListener('scroll', () => { if (card) cRect = card.getBoundingClientRect(); }, { passive: true });

  function tick() {
    raf = 0;
    // the light lags behind on purpose: a glow pinned to the cursor looks like a mouse pointer
    gx += (px - gx) * 0.12;
    gy += (py - gy) * 0.12;
    if (glow) glow.style.transform = `translate3d(${(gx - 260).toFixed(1)}px, ${(gy - 260).toFixed(1)}px, 0)`;

    // the whole light field leans a little, which makes the page feel like it has depth
    if (bg) {
      const dx = (px / innerWidth - .5) * 2, dy = (py / innerHeight - .5) * 2;
      bg.style.setProperty('--lean-x', (-dx * 14).toFixed(2) + 'px');
      bg.style.setProperty('--lean-y', (-dy * 10).toFixed(2) + 'px');
    }

    if (card && cRect) {
      card.style.setProperty('--mx', (((px - cRect.left) / cRect.width) * 100).toFixed(1) + '%');
      card.style.setProperty('--my', (((py - cRect.top) / cRect.height) * 100).toFixed(1) + '%');
    }

    const near = Math.abs(px - gx) + Math.abs(py - gy);
    if (near > 0.5 || moved) { moved = false; raf = requestAnimationFrame(tick); }
  }

  // buttons lean towards the pointer, then spring back
  for (const b of document.querySelectorAll('.btn')) {
    b.addEventListener('pointermove', (e) => {
      const r = b.getBoundingClientRect();
      b.style.setProperty('--pull-x', (((e.clientX - r.left) / r.width - .5) * 7).toFixed(1) + 'px');
      b.style.setProperty('--pull-y', (((e.clientY - r.top) / r.height - .5) * 4).toFixed(1) + 'px');
    }, { passive: true });
    b.addEventListener('pointerleave', () => {
      b.style.setProperty('--pull-x', '0px');
      b.style.setProperty('--pull-y', '0px');
    }, { passive: true });
  }

  tick();
}

/* ── hero: the flow of dots ───────────────────────── */
// Sixteen lanes of dots on a slow wave, violet on the left turning green on the right: the volume.
function flow() {
  const cv = $('flow');
  const ctx = cv.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const C0 = [196, 150, 255], C1 = [90, 250, 190];
  const BUCKETS = 32;
  const colors = Array.from({ length: BUCKETS }, (_, i) => {
    const t = i / (BUCKETS - 1);
    return `rgb(${C0.map((c, k) => Math.round(c + (C1[k] - c) * t)).join(',')})`;
  });
  let W = 0, H = 0, dpr = 1, running = false, visible = true, t0 = performance.now();
  let box = { l: 0, t: 0, r: 0, b: 0 };   // the text block, where the flow goes quiet

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = cv.getBoundingClientRect();
    const kids = [...document.querySelectorAll('.hero-in > *')].map((n) => n.getBoundingClientRect());
    if (kids.length) {
      box = {
        l: Math.min(...kids.map((k) => k.left)) - c.left, t: Math.min(...kids.map((k) => k.top)) - c.top,
        r: Math.max(...kids.map((k) => k.right)) - c.left, b: Math.max(...kids.map((k) => k.bottom)) - c.top,
      };
    }
  }

  function frame(now) {
    const time = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    const narrow = W < 720;
    const lanes = narrow ? 10 : 16, per = narrow ? 70 : 130;
    const feather = narrow ? 36 : 70;
    const base0 = H * (narrow ? .6 : .56);
    const gap = narrow ? 11 : 15;
    for (let lane = 0; lane < lanes; lane++) {
      const phase = lane * .33;
      const amp = (narrow ? 60 : 110) + lane * (narrow ? 5 : 9);
      const baseY = base0 + (lane - lanes / 2) * gap;
      for (let i = 0; i < per; i++) {
        // dots drift left to right; the wave itself breathes slowly
        const u = ((i / per) + time * .012 + lane * .017) % 1;
        const x = u * (W + 160) - 80;
        const t = x / W;
        const env = Math.sin(Math.max(0, Math.min(1, t)) * Math.PI);
        const y = baseY + amp * Math.sin(t * Math.PI * 1.8 + phase + time * .22) * env;
        const depth = .5 + .5 * Math.sin(t * Math.PI * 2 + lane * .5 + time * .15);
        const r = (narrow ? .9 : 1.1) + (narrow ? 1.6 : 2.2) * depth;
        // fade the flow out under the text block, like the banner does under the lockup
        const ox = Math.max(box.l - x, 0, x - box.r), oy = Math.max(box.t - y, 0, y - box.b);
        const hole = .06 + .94 * Math.min(1, Math.hypot(ox, oy) / feather);
        const a = (.14 + .5 * depth * Math.sqrt(Math.max(env, 0))) * hole;
        if (a < .02) continue;
        ctx.globalAlpha = a;
        ctx.fillStyle = colors[Math.max(0, Math.min(BUCKETS - 1, Math.round(t * (BUCKETS - 1))))];
        ctx.beginPath();
        ctx.arc(x, y, r, 0, 6.2832);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (running) requestAnimationFrame(frame);
  }

  function setRun() {
    const want = visible && !document.hidden && !reduce;
    if (want && !running) { running = true; requestAnimationFrame(frame); }
    if (!want) running = false;
  }

  size();
  frame(performance.now());
  new ResizeObserver(() => { size(); if (!running) frame(performance.now()); }).observe(cv);
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; setRun(); }).observe(cv);
  document.addEventListener('visibilitychange', setRun);
  setRun();
}

/* ── hero stats ───────────────────────────────────── */
function paintStats(reg) {
  const L = reg.equities;
  const vol = L.reduce((a, e) => a + e.vol24, 0);
  const hot = L.filter((e) => e.turnover > 12).length;
  $('heroStats').innerHTML =
    `<span><b>${odo('hs-n', L.length)}</b> stocks</span><span><b>${odo('hs-vol', usd(vol))}</b> volume 24h</span>` +
    `<span class="hot"><b>${odo('hs-hot', hot)}</b> above 12x</span><span>updated ${ago(reg.updatedAt)}</span>`;
  odoRun($('heroStats'));
}

/* ── the metric: bands, spread, cases ─────────────── */

const LO = .1, HI = 200;
const pos = (t) => (Math.log10(Math.min(Math.max(t, LO), HI)) - Math.log10(LO)) / (Math.log10(HI) - Math.log10(LO));


/* ── sparklines ───────────────────────────────────── */
// 24 hourly closes per pool, one request for the whole page (see api/sparks.js).
const SPARKS = {};
let sparksLoaded = null;
function loadSparks() {
  sparksLoaded ||= getJson('/api/sparks', 30000).then((j) => {
    Object.assign(SPARKS, j?.sparks || {});
    document.querySelectorAll('[data-spark]').forEach((el) => { el.outerHTML = spark(el.dataset.spark, el.dataset.w, el.dataset.h); });
  });
  return sparksLoaded;
}
// When a pool has no hourly candles (GeckoTerminal rate limits), rebuild four real points from the
// pool's own 24h, 6h and 1h price change: price then = price now / (1 + change).
const COARSE = {};
function coarse(e) {
  if (!e.pc || !e.price) return null;
  const [h24, h6, h1] = e.pc;
  const at = (c) => e.price / (1 + c / 100);
  return { t: [0, 18 / 24, 23 / 24, 1], s: [at(h24), at(h6), at(h1), e.price] };
}
// A smooth line through the points (monotone-ish cubic), so a sparkline reads like a chart, not a zigzag.
function smooth(pts) {
  if (pts.length < 3) return pts.map(([x, y], i) => (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1)).join('');
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
function spark(pool, w = 84, h = 26) {
  let s = SPARKS[pool], t = null;
  if (!s && COARSE[pool]) ({ s, t } = COARSE[pool]);
  if (!s || s.length < 3) return `<svg class="spark none" viewBox="0 0 ${w} ${h}" data-spark="${pool}" data-w="${w}" data-h="${h}"><path d="M0 ${h / 2}H${w}" stroke="rgba(225,215,255,.5)" stroke-dasharray="2 3"/></svg>`;
  const pad = 3;
  const lo = Math.min(...s), hi = Math.max(...s), k = hi > lo ? (h - pad * 2) / (hi - lo) : 0;
  const pts = s.map((v, i) => [(t ? t[i] : i / (s.length - 1)) * (w - pad) , hi > lo ? h - pad - (v - lo) * k : h / 2]);
  const d = smooth(pts);
  const up = s[s.length - 1] >= s[0];
  const c = up ? '#2EBD85' : '#F6465D';
  const [ex, ey] = pts[pts.length - 1];
  const again = t ? ` data-spark="${pool}" data-w="${w}" data-h="${h}"` : '';   // coarse: swap for candles when they land
  return `<svg class="spark" viewBox="0 0 ${w} ${h}"${again}><path class="area" d="${d}L${ex.toFixed(1)} ${h}L0 ${h}Z" fill="${c}" fill-opacity=".1"/>` +
    `<path d="${d}" stroke="${c}"/><circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="2.2" fill="${c}"/></svg>`;
}
const sparkSlot = (e, w, h) => {
  if (!e.pool) return '';
  if (!COARSE[e.pool]) { const c = coarse(e); if (c) COARSE[e.pool] = c; }
  return spark(e.pool, w, h);
};

const icon = (e, cls = '') => (e.icon ? `<img class="${cls}" src="${esc(e.icon)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : `<span class="ph ${cls}"></span>`);
const pct = (n) => (Number.isFinite(n) ? (n >= 0 ? '+' : '') + n.toFixed(2) + '%' : '·');
const tcls = (t) => ({ hot: 'hot-t', printed: 'printed-t' }[band(t)] || '');

/* ── appear motion ────────────────────────────────── */
function splitWords() {
  document.querySelectorAll('.split').forEach((h) => {
    h.innerHTML = h.textContent.trim().split(/\s+/).map((w, i) => `<span class="w" style="--i:${i}">${esc(w)}</span>`).join(' ');
  });
}
function reveal() {
  const els = document.querySelectorAll('[data-r], .split');
  // stagger siblings that share a grid, the way Crypton cascades its cards
  document.querySelectorAll('.steps, .plans, .faq').forEach((g) => {
    [...g.querySelectorAll(':scope > [data-r]')].forEach((el, i) => el.style.setProperty('--d', (i * .08).toFixed(2) + 's'));
  });
  if (!('IntersectionObserver' in window)) { els.forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((ents) => {
    for (const en of ents) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });
  els.forEach((e) => io.observe(e));
}

/* ── the board frame ──────────────────────────────── */
function paintMarquee(L) {
  const list = [...L].sort((a, b) => b.vol24 - a.vol24);
  const html = list.map((e) => `<span>${e.icon ? `<img src="${esc(e.icon)}" alt="" loading="lazy" onerror="this.remove()">` : ''}${esc(e.symbol)}</span>`).join('');
  $('marq').innerHTML = html + html;
  $('marqTitle').textContent = `${L.length} tokenized stocks from three issuers, read live`;
}

const DASH = { sort: 'turnover', L: [] };
function paintDash(reg) {
  const L = reg.equities;
  DASH.L = L;
  const n = (k) => L.filter((e) => e.issuer === k).length;
  $('dashIssuers').innerHTML =
    `<a href="/app" class="on"><svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="4" height="4" rx="1" fill="currentColor"/><rect x="7" y="1" width="4" height="4" rx="1" fill="currentColor"/><rect x="1" y="7" width="4" height="4" rx="1" fill="currentColor"/><rect x="7" y="7" width="4" height="4" rx="1" fill="currentColor"/></svg>All stocks<em>${L.length}</em></a>` +
    Object.keys(ISS).map((k) => `<a href="/app#issuer=${k}"><i class="idot ${k}"></i>${ISS[k].short}<em>${n(k)}</em></a>`).join('') +
    `<a href="/app"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 11V1M1 11h10M3 8l2.5-3 2 1.5L11 3" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>Above 12x<em>${L.filter((e) => e.turnover > 12).length}</em></a>`;
  $('dashCount').textContent = `${L.length} stocks, rebuilt every 5 min`;
  $('dashStamp').textContent = (reg.live ? 'live · ' : 'snapshot · ') + ago(reg.updatedAt);

  const top3 = [...L].sort((a, b) => b.turnover - a.turnover).slice(0, 3);
  $('hotCards').innerHTML = top3.map((e) =>
    `<a class="hot-card" href="${appLink(e)}"><span class="hc-top">${icon(e)}<em>↗</em></span>` +
    `<b>${esc(e.symbol)}<i class="idot ${e.issuer}"></i></b><span class="hc-x ${tcls(e.turnover)}">${odo('hc-' + e.address, tx(e.turnover))}</span>` +
    `<span class="hc-sub">${usd(e.vol24)} volume on ${usd(e.liq)} liquidity. The pool turns over every ${every(e.turnover)}.</span>` +
    `<span class="hc-btn">Open chart</span></a>`).join('');
  odoRun($('hotCards'));
  paintDashRows();
}
function paintDashRows() {
  const s = DASH.sort;
  const key = s === 'move' ? (e) => Math.abs(e.change24) : (e) => e[s];
  const rows = [...DASH.L].sort((a, b) => key(b) - key(a)).slice(0, 7);
  $('dashRows').innerHTML = rows.map((e, i) =>
    `<a class="dt-row" href="${appLink(e)}"><span class="n">${i + 1}.</span>` +
    `<span class="st">${icon(e)}${esc(e.symbol)}</span><span class="nm hide-m">${esc(e.name)}</span>` +
    `<span class="r ${flash(e, 'price')}">${odo('dp-' + e.address, '$' + price(e.price))}</span><span class="r hide-s">${usd(e.vol24)}</span><span class="r hide-m">${usd(e.liq)}</span>` +
    `<span class="r ${tcls(e.turnover)} ${flash(e, 'turnover')}">${odo('dt-' + e.address, tx(e.turnover))}</span>` +
    `<span class="hide-s">${sparkSlot(e, 84, 26)}</span><span class="open">Open</span></a>`).join('');
  odoRun($('dashRows'));
}
function wireDash() {
  $('dashTabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    DASH.sort = b.dataset.sort;
    [...$('dashTabs').querySelectorAll('button')].forEach((x) => x.classList.toggle('on', x === b));
    paintDashRows();
  });
}

/* ── 50/50 rows ───────────────────────────────────── */
// Gauge: log scale from 0.1x to 200x around the dial, so 12x and 50x sit where the eye can find them.
const gpos = (t) => pos(t);   // same log mapping as the spread
function paintGauge(L) {
  const top = [...L].sort((a, b) => b.turnover - a.turnover)[0];
  if (!top) return;
  const C = 2 * Math.PI * 100;
  let ticks = '';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * 2 * Math.PI - Math.PI / 2;
    const x1 = 140 + Math.cos(a) * 124, y1 = 140 + Math.sin(a) * 124;
    const x2 = 140 + Math.cos(a) * 116, y2 = 140 + Math.sin(a) * 116;
    ticks += `<line class="tk" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }
  let labels = '';
  for (const [t, lbl] of [[12, '12x'], [50, '50x']]) {
    const a = gpos(t) * 2 * Math.PI - Math.PI / 2;
    labels += `<line class="tk edge" x1="${(140 + Math.cos(a) * 128).toFixed(1)}" y1="${(140 + Math.sin(a) * 128).toFixed(1)}" x2="${(140 + Math.cos(a) * 84).toFixed(1)}" y2="${(140 + Math.sin(a) * 84).toFixed(1)}"/>`;
    labels += `<text class="tk-l" x="${(140 + Math.cos(a) * 100).toFixed(1)}" y="${(144 + Math.sin(a) * 100).toFixed(1)}" text-anchor="middle">${lbl}</text>`;
  }
  $('gTicks').innerHTML = ticks;
  $('gLabels').innerHTML = labels;
  $('gVal').textContent = tx(top.turnover);
  $('gSym').textContent = top.symbol.toUpperCase();
  $('gNote').textContent = `${top.symbol}: pool turns over every ${every(top.turnover)}`;
  const fill = () => $('gArcFill').setAttribute('stroke-dasharray', `${(gpos(top.turnover) * C).toFixed(1)} ${C.toFixed(1)}`);
  const vis = document.querySelector('.vis-gauge');
  if (vis.classList.contains('in')) fill();
  else new MutationObserver((m, o) => { if (vis.classList.contains('in')) { fill(); o.disconnect(); } }).observe(vis, { attributes: true });
}

function paintTiles(L) {
  const withIcons = [...L].filter((e) => e.icon).sort((a, b) => b.vol24 - a.vol24).slice(0, 20);
  $('tiles').innerHTML = withIcons.map((e, i) => `<span style="--dl:${(-i * .7).toFixed(1)}s"><img src="${esc(e.icon)}" alt="" loading="lazy" onerror="this.remove()"></span>`).join('');
  $('tagCount').textContent = `${L.length} stocks`;
}

function paintPairs(L) {
  const by = new Map();
  for (const e of L) { if (!e.price) continue; (by.get(e.ticker) || by.set(e.ticker, []).get(e.ticker)).push(e); }
  const pairs = [...by.values()].filter((g) => new Set(g.map((e) => e.issuer)).size > 1)
    .map((g) => { const ps = g.map((e) => e.price); return { g: g.sort((a, b) => b.liq - a.liq), gap: (Math.max(...ps) / Math.min(...ps) - 1) * 100 }; })
    .sort((a, b) => b.gap - a.gap).slice(0, 5);
  $('pairRows').innerHTML = pairs.map(({ g, gap }) =>
    `<a class="vl-row" href="${appLink(g[0])}">${icon(g[0], 'ic')}<span><b>${esc(g[0].ticker)}</b><small>${g.map((e) => esc(e.symbol)).join(' · ')}</small></span>` +
    `<span class="g${gap > 1 ? ' wide' : ''}">${gap.toFixed(2)}% gap</span></a>`).join('') ||
    '<p class="vl-row">No company trades under two issuers right now.</p>';
}

/* ── the case file on the board's promo card ──────── */
function paintPromo(cases) {
  const c = cases?.cases?.[0];
  if (!c) return;
  const date = c.date.split('-').reverse().join('.');
  $('promoX').textContent = tx(c.turnover);
  $('promoSub').textContent = `${usd(c.vol24)} volume on ${usd(c.liq)} liquidity. Registry snapshot, ${date}.`;
}

/* ── issuers as plans ─────────────────────────────── */
const ISS_DESC = {
  backpack: 'Backpack Securities lists plain tickers with no suffix: IONQ, LLY, HIMS.',
  xstocks: 'xStocks by Backed adds an x to every ticker: NVDAx, SPYx, GLDx.',
  ondo: 'Ondo Global Markets adds on to every ticker: SPYon and the like.',
};
function paintPlans(L) {
  const order = Object.keys(ISS).map((k) => ({ k, list: L.filter((e) => e.issuer === k) })).sort((a, b) => b.list.length - a.list.length);
  $('plans').innerHTML = order.map(({ k, list }, i) => {
    const vol = list.reduce((a, e) => a + e.vol24, 0), liq = list.reduce((a, e) => a + e.liq, 0);
    const hottest = [...list].sort((a, b) => b.turnover - a.turnover)[0];
    const busiest = [...list].sort((a, b) => b.vol24 - a.vol24)[0];
    const over = list.filter((e) => e.turnover > 12).length;
    const featured = i === 0;
    return `<article class="plan${featured ? ' feat-plan' : ''}" data-r>
      <div class="plan-top"><i class="idot ${k}"></i><h3>${ISS[k].short}</h3>${featured ? '<em>✦ Most listed</em>' : ''}</div>
      <p>${ISS_DESC[k]}</p>
      <div class="plan-n">${odo('pl-' + k, list.length)}<small>${list.length === 1 ? 'stock' : 'stocks'}</small></div>
      <div class="plan-sub">${odo('pv-' + k, usd(vol))} volume in 24 hours</div>
      <ul>
        <li>Liquidity<span>${usd(liq)}</span></li>
        <li>Most traded<span>${busiest ? esc(busiest.symbol) : '·'}</span></li>
        <li>Hottest<span class="${hottest ? band(hottest.turnover) : ''}">${hottest ? esc(hottest.symbol) + ' ' + tx(hottest.turnover) : '·'}</span></li>
        <li>Above 12x<span class="${over ? 'hot' : ''}">${over}</span></li>
      </ul>
      <a class="btn ${featured ? 'btn-violet' : 'btn-gray'}" href="/app#issuer=${k}">Open ${ISS[k].short} stocks <svg viewBox="0 0 16 16"><path d="M4.5 11.5 11.5 4.5M5.5 4.5h6v6" /></svg></a>
    </article>`;
  }).join('');
  document.querySelectorAll('#plans [data-r]').forEach((el, i) => el.style.setProperty('--d', (i * .08).toFixed(2) + 's'));
  odoRun($('plans'));
}

/* ── nav ──────────────────────────────────────────── */
function nav() {
  const n = $('nav');
  const on = () => n.classList.toggle('solid', window.scrollY > 8);
  window.addEventListener('scroll', on, { passive: true });
  on();
}

/* ── live: everything on the page keeps moving ───── */
// Previous values per token, so a repaint can flash whatever changed since the last poll.
const PREV = new Map();
function flash(e, k) {
  const p = PREV.get(e.address);
  if (!p || p[k] == null || p[k] === e[k]) return '';
  return e[k] > p[k] ? 'flash-up' : 'flash-down';
}
function remember(L) { for (const e of L) PREV.set(e.address, { price: e.price, turnover: e.turnover, vol24: e.vol24 }); }

function flashText(el, text, dir) {
  if (!el) return;
  const key = el.id || el.dataset.odo || (el.dataset.odo = 'k' + (++ODO_N));
  if (ODO_PREV.get(key) === text) return;
  el.innerHTML = odo(key, text);
  odoRun(el);
  el.classList.remove('flash-up', 'flash-down');
  void el.offsetWidth;
  if (dir) el.classList.add(dir > 0 ? 'flash-up' : 'flash-down');
}

// Chips keep their places and animation; only the numbers change.
function updateChips(L) {
  const by = new Map(L.map((e) => [e.symbol, e]));
  document.querySelectorAll('#chips .chip').forEach((c) => {
    const e = by.get(c.querySelector('b')?.textContent);
    if (!e) return;
    const em = c.querySelector('em');
    if (ODO_PREV.get('chip-' + e.address) === tx(e.turnover)) return;
    em.innerHTML = odo('chip-' + e.address, tx(e.turnover));
    odoRun(em);
  });
}

let REG = null;
async function refreshAll() {
  if (document.hidden) return;
  const reg = await registry();
  if (!reg?.equities?.length) return;
  const L = reg.equities.filter((e) => Number.isFinite(e.turnover));
  reg.equities = L;
  REG = reg;
  paintStats(reg);
  updateChips(L);
  paintDash(reg);
  paintGauge(L);
  paintPairs(L);
  paintBands(L);
  paintPlans(L);
  document.querySelectorAll('#plans [data-r]').forEach((el) => el.classList.add('in'));
  paintWvTabs(L);
  remember(L);
}

/* ── live swaps ───────────────────────────────────── */
const WV = { e: null, seen: new Set(), stats: null, busy: false };
const shortW = (w) => w.slice(0, 4) + '…' + w.slice(-4);
const wcol = (w) => { let h = 0; for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 85% 66%)`; };
const cash = (n) => (n >= 1000 ? usd(n) : '$' + n.toFixed(2));
const since = (t) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? s + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : Math.floor(s / 3600) + 'h';
};

function paintWvTabs(L) {
  const top = [...L].filter((e) => e.pool).sort((a, b) => b.turnover - a.turnover).slice(0, 4);
  const kept = WV.e && top.find((e) => e.address === WV.e.address);
  WV.e = kept || WV.e && L.find((e) => e.address === WV.e.address) || top[0];
  $('wvTabs').innerHTML = top.map((e) => `<button data-a="${e.address}"${e.address === WV.e?.address ? ' class="on"' : ''}><i class="idot ${e.issuer}"></i><b>${esc(e.symbol)}</b><em>${tx(e.turnover)}</em></button>`).join('');
}

function wvRow(x, top, isNew) {
  const rank = top.get(x.wallet);
  return `<a class="wv-row${isNew ? ' new ' + x.kind : ''}" href="https://solscan.io/tx/${x.tx}" target="_blank" rel="noopener">` +
    `<span class="tm" data-t="${x.t}">${since(x.t)}</span><span class="k ${x.kind}">${x.kind}</span>` +
    `<span class="w"><i style="background:${wcol(x.wallet)}"></i><span>${shortW(x.wallet)}</span>${rank ? `<em>#${rank}</em>` : ''}</span>` +
    `<span class="u">${cash(x.usd)}</span></a>`;
}

async function loadWv(reset) {
  const e = WV.e;
  if (!e?.pool || WV.busy) return;
  WV.busy = true;
  const j = await getJson(`/api/trades?pool=${e.pool}`, 12000);
  WV.busy = false;
  if (WV.e !== e) return;
  if (!j?.trades) { $('wvStamp').textContent = 'GeckoTerminal is busy, retrying in 20s'; return; }
  const st = j.stats;
  const top = new Map(st.top.map((w, i) => [w.wallet, i + 1]));
  const box = $('wvRows');
  if (reset || !box.querySelector('.wv-row')) {
    WV.seen = new Set(j.trades.map((x) => x.tx));
    box.innerHTML = j.trades.slice(0, 14).map((x) => wvRow(x, top, false)).join('');
  } else {
    const fresh = j.trades.filter((x) => !WV.seen.has(x.tx)).slice(0, 14);
    fresh.forEach((x) => WV.seen.add(x.tx));
    if (fresh.length) {
      box.insertAdjacentHTML('afterbegin', fresh.map((x) => wvRow(x, top, true)).join(''));
      while (box.children.length > 14) box.lastElementChild.remove();
    }
  }
  const prev = WV.stats;
  const d = (k) => (prev && prev[k] != null ? Math.sign(st[k] - prev[k]) : 0);
  flashText($('wvPace'), st.perMin == null ? '·' : st.perMin.toFixed(1), d('perMin'));
  flashText($('wvMed'), cash(st.median), d('median'));
  flashText($('wvWallets'), String(st.wallets), d('wallets'));
  $('wvWin').textContent = st.minutes < 90 ? `${Math.round(st.minutes)} min` : `${(st.minutes / 60).toFixed(1)} h`;
  flashText($('wvTop3'), (st.top3Share * 100).toFixed(1) + '%', d('top3Share'));
  flashText($('wvRT'), `${st.roundTripWallets} wallets · ${(st.roundTripShare * 100).toFixed(1)}%`, d('roundTripShare'));
  $('wvTop3Bar').style.width = (st.top3Share * 100).toFixed(1) + '%';
  $('wvRTBar').style.width = (st.roundTripShare * 100).toFixed(1) + '%';
  const max = st.top[0]?.usd || 1;
  $('wvTop').innerHTML = st.top.map((w, i) =>
    `<a class="wv-tw" href="https://solscan.io/account/${w.wallet}" target="_blank" rel="noopener"><i style="background:${wcol(w.wallet)}"></i>` +
    `<span>#${i + 1} ${shortW(w.wallet)}<small>${w.buy} buy · ${w.sell} sell</small></span><b>${cash(w.usd)}</b>` +
    `<span class="wb"><em style="width:${(w.usd / max * 100).toFixed(1)}%;background:${wcol(w.wallet)}"></em></span></a>`).join('');
  $('wvStamp').textContent = `${e.symbol} · last ${st.count} swaps · ${cash(st.usd)} traded · refreshes every 20s`;
  WV.stats = st;
}

function wireWv() {
  $('wvTabs').addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    const e = (REG?.equities || []).find((x) => x.address === b.dataset.a);
    if (!e) return;
    WV.e = e; WV.stats = null;
    [...$('wvTabs').children].forEach((x) => x.classList.toggle('on', x === b));
    $('wvRows').innerHTML = '<p class="wv-empty">Reading the pool…</p>';
    loadWv(true);
  });
  let visible = false;
  new IntersectionObserver(([en]) => { visible = en.isIntersecting; }, { rootMargin: '200px' }).observe($('swaps'));
  setInterval(() => { if (visible && !document.hidden) loadWv(false); }, 20000);
  // ages tick every second, so the feed never looks frozen
  setInterval(() => { if (visible) document.querySelectorAll('#wvRows .tm').forEach((el) => { el.textContent = since(+el.dataset.t); }); }, 1000);
}

/* ── odometer numbers ────────────────────────────────
   A changed number does not blink into place, it rolls there, digit by digit, like a departures
   board. Markup is rendered at the previous value and rolled to the new one on the next frame,
   so it survives the full re-renders the dashboard does every minute. Keyed by what the number
   is (a stock's turnover, a stat), not by which element holds it. */
const ODO_PREV = new Map();
let ODO_N = 0;
const isDigit = (ch) => ch >= '0' && ch <= '9';

function odo(key, text) {
  text = String(text);
  const prev = ODO_PREV.get(key);
  ODO_PREV.set(key, text);
  const from = prev ?? text;
  const n = Math.max(from.length, text.length);
  const a = from.padStart(n, ' '), b = text.padStart(n, ' ');
  let html = `<span class="odo" aria-label="${esc(text)}">`;
  for (let i = 0; i < n; i++) {
    const to = b[i];
    if (to === ' ') continue;
    if (isDigit(to)) {
      const start = isDigit(a[i]) ? a[i] : to;
      html += `<span class="od" aria-hidden="true"><span class="os" style="transform:translateY(-${start}0%)"` +
        (start !== to ? ` data-to="${to}"` : '') + `>` +
        '0123456789'.split('').map((d) => `<span>${d}</span>`).join('') + '</span></span>';
    } else {
      html += `<span class="oc" aria-hidden="true">${esc(to)}</span>`;
    }
  }
  return html + '</span>';
}
// Roll whatever odo() rendered at its old value. Two frames, so the start position is painted first.
function odoRun(root = document) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.querySelectorAll('.os[data-to]').forEach((s) => {
      s.style.transform = `translateY(-${s.dataset.to}0%)`;
      s.removeAttribute('data-to');
    });
  }));
}

/* ── the case, told by scrolling ─────────────────────
   One pool with $107K in it, and $16.5M of volume going through it in a day. The section pins
   while you scroll past it and the numbers climb with your position: nothing hijacks the wheel,
   the page scrolls natively and the script only reads where the section is. Every figure comes
   from /data/cases.json, which carries the date of the run it was taken from. */
function story(cases) {
  const sec = $('case');
  const c = cases?.cases?.[0];
  if (!sec || !c) { if (sec) sec.hidden = true; return; }
  const f = c.followUp;
  const set = (k, v) => sec.querySelectorAll(`[data-s="${k}"]`).forEach((el) => { el.textContent = v; });
  set('date', c.date.split('-').reverse().join('.'));
  set('symbol', c.symbol);
  set('issuer', ISS[c.issuer]?.name || c.issuer);
  set('liq', usd(c.liq));
  set('vol', usd(c.vol24));
  set('every', every(c.turnover));
  if (f) {
    set('after', tx(f.turnover));
    set('less', Math.round(c.vol24 / f.vol24) + 'x less');
  } else {
    sec.querySelector('[data-at=".82"]')?.remove();
  }
  $('stLiq').innerHTML = odo('st-liq', usd(c.liq));

  // one square per full turn of the pool, so the grid itself is the number
  const cells = Math.max(160, Math.ceil(c.turnover / 16) * 16);
  const grid = $('sg');
  grid.innerHTML = Array.from({ length: cells }, () => '<i></i>').join('');
  const sq = [...grid.children];

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let lit = -1, last = '';
  function paint(p) {
    // volume accumulates, so the climb starts slow and speeds up, then holds at the end
    const k = Math.min(1, Math.max(0, p / .78));
    const e = k * k * (3 - 2 * k);
    const t = c.turnover * e;
    const b = band(t);
    const txt = tx(t);
    if (txt !== last) {
      last = txt;
      $('stVol').textContent = usd(c.vol24 * e);
      $('stTurn').textContent = txt;
      $('stTurn').className = b;
      $('stBand').textContent = BAND_WORD[b];
      $('stBand').className = b;
    }
    const n = Math.floor(t);
    if (n !== lit) {
      lit = n;
      for (let i = 0; i < sq.length; i++) {
        // g1..g3, not b1..b3: those names belong to the background lights
        const want = i < n ? (i < 12 ? 'on g1' : i < 50 ? 'on g2' : 'on g3') : '';
        if (sq[i].className !== want) sq[i].className = want;
      }
    }
    sec.querySelectorAll('.sl').forEach((l) => l.classList.toggle('on', p >= +l.dataset.at));
    sec.classList.toggle('done', p >= .8);
  }

  if (reduce) { sec.classList.add('still'); paint(1); return; }

  let raf = 0, active = false;
  const read = () => {
    raf = 0;
    const r = sec.getBoundingClientRect();
    const run = sec.offsetHeight - innerHeight;
    paint(run > 0 ? Math.min(1, Math.max(0, -r.top / run)) : 1);
  };
  const onScroll = () => { if (active && !raf) raf = requestAnimationFrame(read); };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });
  new IntersectionObserver(([en]) => { active = en.isIntersecting; if (active) onScroll(); }).observe(sec);
  paint(0);
}

/* ── the light follows the reading ───────────────────
   Violet at the top of the page, green by the bottom: the same drift as the dots on the banner,
   volume flowing from left to right. Only opacity changes, on layers that already exist. */
function colorShift() {
  const bg = $('bg');
  if (!bg) return;
  let raf = 0;
  const run = () => {
    raf = 0;
    const max = document.documentElement.scrollHeight - innerHeight;
    bg.style.setProperty('--sp', (max > 0 ? Math.min(1, scrollY / max) : 0).toFixed(3));
  };
  addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(run); }, { passive: true });
  addEventListener('resize', run, { passive: true });
  run();
}

/* ── the bands, with the stocks actually in them ─────── */
function bchip(e, cls = '') {
  return `<a class="bchip ${cls}" href="${appLink(e)}"><i class="idot ${e.issuer}"></i><b>${esc(e.symbol)}</b>` +
    `<em>${odo('bc-' + e.address, tx(e.turnover))}</em></a>`;
}
function paintBands(L, cases) {
  const by = { organic: [], hot: [], printed: [] };
  for (const e of L) by[band(e.turnover)].push(e);
  for (const k of Object.keys(by)) by[k].sort((a, b) => b.turnover - a.turnover);

  document.querySelectorAll('[data-band]').forEach((el) => {
    const n = by[el.dataset.band].length;
    el.innerHTML = n ? `${odo('band-' + el.dataset.band, String(n))} ${n === 1 ? 'stock' : 'stocks'} now` : 'none right now';
  });

  const box = (k) => document.querySelector(`[data-bchips="${k}"]`);
  // normal trading holds most of the board, so show the edge of it and count the rest
  const org = by.organic.slice(0, 6);
  box('organic').innerHTML = org.map((e) => bchip(e)).join('') +
    (by.organic.length > org.length ? `<a class="bchip more" href="/app">+${by.organic.length - org.length} more</a>` : '');
  box('hot').innerHTML = by.hot.length ? by.hot.slice(0, 8).map((e) => bchip(e, 'hot')).join('') : '<span class="bnone">Quiet: nothing in this band right now.</span>';

  const c = (cases || window.__cases)?.cases?.[0];
  box('printed').innerHTML = by.printed.length
    ? by.printed.map((e) => bchip(e, 'printed')).join('')
    : (c ? `<span class="bnone">Last seen:</span>` +
          `<a class="bchip printed past" href="#case"><i class="idot ${c.issuer}"></i><b>${esc(c.symbol)}</b><em>${tx(c.turnover)}</em>` +
          `<small>${c.date.split('-').reverse().join('.')}</small></a>`
        : '<span class="bnone">Nothing this high right now.</span>');
  odoRun($('bands'));
}

async function main() {
  nav();
  colorShift();
  cursor();
  flow();
  parallax();
  splitWords();
  reveal();
  wireDash();
  const [reg, cases] = await Promise.all([registry(), getJson('/data/cases.json')]);
  if (!reg?.equities?.length) {
    $('heroStats').textContent = 'Registry unavailable right now';
    return;
  }
  const L = reg.equities.filter((e) => Number.isFinite(e.turnover));
  reg.equities = L;
  paintChips(L);
  paintStats(reg);
  paintMarquee(L);
  paintDash(reg);
  paintGauge(L);
  paintTiles(L);
  paintPairs(L);
  window.__cases = cases;
  paintBands(L, cases);
  paintPromo(cases);
  story(cases);
  paintPlans(L);
  reveal();   // the plan cards were just created
  REG = reg;
  paintWvTabs(L);
  wireWv();
  loadWv(true);
  remember(L);
  setInterval(refreshAll, 60000);   // the registry is CDN-cached for five minutes; a minute is plenty
  setInterval(() => { sparksLoaded = null; loadSparks(); }, 10 * 60000);
  matchMedia('(max-width: 720px)').addEventListener('change', () => paintChips(L));

  loadSparks();   // one cached request for every sparkline on the page
}

main();
