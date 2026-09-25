/* Strak docs: live numbers from the registry, navigation state, search, copy buttons. */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const usd = (n) => {
  if (!Number.isFinite(n) || n === 0) return '$0';
  const a = Math.abs(n);
  if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return '$' + (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return '$' + n.toFixed(0);
};
const tx = (t) => t.toFixed(1) + 'x';
const band = (t) => (t > 50 ? 'printed' : t > 12 ? 'hot' : 'organic');
const WORD = { organic: 'normal trading', hot: 'suspiciously hot', printed: 'volume is painted' };
const ISS = { backpack: 'Backpack Securities', xstocks: 'xStocks', ondo: 'Ondo Global Markets' };
const every = (t) => {
  const m = 1440 / t;
  if (m < 90) return `${Math.round(m)} minutes`;
  if (m < 1440) return `${(m / 60).toFixed(1)} hours`;
  return `${(m / 1440).toFixed(1)} days`;
};

async function getJson(url, ms = 12000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal }); return r.ok ? await r.json() : null; }
  catch { return null; } finally { clearTimeout(t); }
}

/* ── live numbers ─────────────────────────────── */
async function live() {
  const reg = (await getJson('/api/registry')) || (await getJson('/data/equities.json'));
  if (!reg?.equities?.length) return;
  const L = reg.equities;
  const set = (k, v, cls) => document.querySelectorAll(`[data-live="${k}"]`).forEach((el) => { el.textContent = v; if (cls) el.classList.add(cls); });
  const top = [...L].sort((a, b) => b.turnover - a.turnover)[0];
  set('count', L.length);
  set('vol', usd(L.reduce((a, e) => a + e.vol24, 0)));
  set('hot', L.filter((e) => e.turnover > 12).length, 'hot');
  if (top) set('top', `${top.symbol} ${tx(top.turnover)}`, band(top.turnover));
  for (const k of Object.keys(ISS)) set('n-' + k, L.filter((e) => e.issuer === k).length);

  const c = { organic: 0, hot: 0, printed: 0 };
  for (const e of L) c[band(e.turnover)]++;
  document.querySelectorAll('[data-band]').forEach((el) => { const n = c[el.dataset.band]; el.textContent = `${n} ${n === 1 ? 'stock' : 'stocks'} now`; });

  if (top) {
    const b = band(top.turnover);
    $('liveExample').innerHTML = `
      <p class="ex-k">Live, from the registry · ${new Date(reg.updatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
      <p><b>${esc(top.symbol)}</b> from ${ISS[top.issuer] || top.issuer} is the hottest stock on the board right now.</p>
      <div class="ex-row">
        <div><i>Volume 24h</i><b>${usd(top.vol24)}</b></div>
        <div><i>Liquidity</i><b>${usd(top.liq)}</b></div>
        <div><i>Turnover</i><b style="color:${b === 'printed' ? 'var(--mint)' : b === 'hot' ? 'var(--hot)' : '#fff'}">${tx(top.turnover)}</b></div>
        <div><i>Turns every</i><b>${every(top.turnover).replace(' minutes', ' min')}</b></div>
      </div>
      <p><code>${usd(top.vol24)} ÷ ${usd(top.liq)} = ${tx(top.turnover)}</code>. That puts it in the <b>${WORD[b]}</b> band: at this pace the whole pool changes hands every ${every(top.turnover)}.</p>`;
  }
  const withPool = L.find((e) => e.pool);
  if (withPool) {
    $('candlesCurl').textContent = `curl -s "https://strak-six.vercel.app/api/candles?pool=${withPool.pool}&token=${withPool.address}&tf=hour&agg=4&limit=100"`;
    const busiest = top || withPool;
    if (busiest.pool) $('tradesCurl').textContent = `curl -s "https://strak-six.vercel.app/api/trades?pool=${busiest.pool}" | jq .stats`;
  }
}

/* ── headings: anchors, this-page list, active state ── */
const sections = [...document.querySelectorAll('.doc section')];
function anchors() {
  document.querySelectorAll('.doc h2, .doc h3').forEach((h) => {
    const id = h.id || h.closest('section')?.id;
    if (!id) return;
    const a = document.createElement('a');
    a.className = 'anchor'; a.href = '#' + id; a.textContent = '#'; a.setAttribute('aria-hidden', 'true');
    h.prepend(a);
  });
}
function paintToc(sec) {
  const hs = [...sec.querySelectorAll('h3[id]')];
  const title = sec.querySelector('h1, h2');
  $('tocNav').innerHTML = `<a href="#${sec.id}">${esc(title?.textContent.replace(/^#/, '') || '')}</a>` +
    hs.map((h) => `<a href="#${h.id}" data-h="${h.id}">${esc(h.textContent.replace(/^#/, ''))}</a>`).join('');
}
function pager(sec) {
  const i = sections.indexOf(sec);
  const link = (s, cls, lbl) => (s ? `<a class="${cls}" href="#${s.id}"><span>${lbl}</span>${esc(s.querySelector('h1, h2').textContent.replace(/^#/, ''))}</a>` : '');
  $('pager').innerHTML = link(sections[i - 1], 'prev', 'Previous') + link(sections[i + 1], 'next', 'Next');
}
let current = null;
function setActive(sec) {
  if (!sec || sec === current) return;
  current = sec;
  document.querySelectorAll('#sideNav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + sec.id));
  paintToc(sec);
  pager(sec);
}
function track() {
  // the section whose top most recently passed under the header is the one being read
  const io = new IntersectionObserver(() => {
    const y = 120;
    let best = sections[0];
    for (const s of sections) if (s.getBoundingClientRect().top <= y) best = s;
    setActive(best);
    const hs = [...(best.querySelectorAll('h3[id]'))];
    let h = null;
    for (const x of hs) if (x.getBoundingClientRect().top <= y + 40) h = x;
    document.querySelectorAll('#tocNav a[data-h]').forEach((a) => a.classList.toggle('on', h && a.dataset.h === h.id));
  }, { rootMargin: '-60px 0px -60% 0px', threshold: [0, 1] });
  document.querySelectorAll('.doc section, .doc h3[id]').forEach((el) => io.observe(el));
  setActive(sections[0]);
}

/* ── search: filters the navigation by titles and section text ── */
function search() {
  const input = $('q');
  const links = [...document.querySelectorAll('#sideNav a')];
  const text = new Map(links.map((a) => {
    const sec = document.querySelector(a.getAttribute('href'));
    return [a, (a.textContent + ' ' + (sec?.textContent || '')).toLowerCase()];
  }));
  const label = new Map(links.map((a) => [a, a.textContent]));
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    let shown = 0;
    for (const a of links) {
      const hit = !q || text.get(a).includes(q);
      a.classList.toggle('hide', !hit);
      const t = label.get(a);
      const i = q ? t.toLowerCase().indexOf(q) : -1;
      a.innerHTML = i >= 0 ? esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length)) : esc(t);
      if (hit) shown++;
    }
    document.querySelectorAll('#sideNav .grp').forEach((g) => {
      let n = g.nextElementSibling, any = false;
      while (n && n.tagName === 'A') { if (!n.classList.contains('hide')) any = true; n = n.nextElementSibling; }
      g.classList.toggle('hide', !any);
    });
    $('sideEmpty').hidden = shown > 0;
    if (q) document.body.classList.add('nav-open');
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const a = links.find((x) => !x.classList.contains('hide')); if (a) { location.hash = a.getAttribute('href'); document.body.classList.remove('nav-open'); input.blur(); } }
    if (e.key === 'Escape') { input.value = ''; input.dispatchEvent(new Event('input')); input.blur(); document.body.classList.remove('nav-open'); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== input && !e.metaKey && !e.ctrlKey) { e.preventDefault(); input.focus(); }
  });
}

/* ── small things ─────────────────────────────── */
function copyButtons() {
  document.querySelectorAll('.code').forEach((box) => {
    const btn = box.querySelector('.copy');
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(box.querySelector('pre').innerText.trim()); btn.textContent = 'Copied'; btn.classList.add('done'); }
      catch { btn.textContent = 'Select and copy'; }
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1600);
    });
  });
}
function mobileNav() {
  $('menu').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('side').addEventListener('click', (e) => { if (e.target.closest('a')) document.body.classList.remove('nav-open'); });
}

anchors();
track();
search();
copyButtons();
mobileNav();
live();
