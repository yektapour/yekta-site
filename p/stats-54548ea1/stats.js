/* YEKTA stats: a private view of the site's GoatCounter numbers.
   The API key is never in the page: it is typed once and kept only in this browser. */
(() => {
  'use strict';
  const API = 'https://yektapour.goatcounter.com/api/v0';
  const KEY = 'yekta_stats_key';
  const LAUNCH = '2026-10-31T00:00:00Z';
  const RANGES = [['today', 'Today'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All time']];
  const app = document.getElementById('app');
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => Number(n || 0).toLocaleString('en-US');
  const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

  let lastDays = null, key = get(KEY), range = get('yekta_stats_range') || '30', busy = 0;

  async function api(path, params = {}) {
    const q = new URLSearchParams(params).toString();
    const r = await fetch(`${API}${path}${q ? '?' + q : ''}`, { headers: { Authorization: 'Bearer ' + key }, cache: 'no-store' });
    if (r.status === 401 || r.status === 403) { const e = new Error('auth'); e.auth = 1; throw e; }
    if (r.status === 429) throw new Error('Too many requests. Wait a minute and refresh.');
    if (!r.ok) throw new Error('GoatCounter answered ' + r.status);
    return r.json();
  }

  /* ---------- the key, typed once ---------- */
  function gate(msg = '') {
    app.innerHTML = `<div class="gate"><form autocomplete="off">
      <p class="k">YEKTA · Private</p>
      <h1>Stats<i>.</i></h1>
      <p>Paste your GoatCounter API key. It stays in this browser only.</p>
      <input type="password" name="k" placeholder="API key" spellcheck="false" autocapitalize="off" required>
      <button type="submit">Open</button>
      <div class="err">${esc(msg)}</div>
    </form></div>`;
    const f = $('form');
    f.addEventListener('submit', async e => {
      e.preventDefault();
      key = f.k.value.trim(); if (!key) return;
      $('.err').textContent = '';
      $('button', f).textContent = 'Checking…';
      try { await api('/me'); set(KEY, key); dash(); }
      catch (er) { key = null; $('button', f).textContent = 'Open'; $('.err').textContent = er.auth ? 'That key did not work. Check it has “Read statistics” permission.' : er.message; }
    });
    f.k.focus();
  }

  /* ---------- dates ---------- */
  const hour = d => { d = new Date(d); d.setUTCMinutes(0, 0, 0); return d; };
  function span() {
    const now = new Date(), end = hour(now.getTime() + 3600e3);
    let start;
    if (range === 'today') { start = new Date(now); start.setHours(0, 0, 0, 0); start = hour(start); }
    else if (range === 'all') start = new Date(LAUNCH);
    else start = hour(now.getTime() - (+range) * 864e5);
    if (start < new Date(LAUNCH)) start = new Date(LAUNCH);
    const iso = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    return { start: iso(start), end: iso(end) };
  }

  /* ---------- names ---------- */
  function page(h) {
    const p = h.path || '/';
    let t = String(h.title || '').replace(/^YEKTA,\s*/, '').replace(/\s*\|.*$/, '').trim();
    let kind = '';
    if (p === '/') return { t: 'Home', kind: '' };
    if (/^\/work\//.test(p)) kind = 'Work';
    else if (/^\/articles\/.+/.test(p)) kind = 'Article';
    else if (/^\/interactive\/.+/.test(p)) kind = 'Interactive';
    if (!t) t = p.replace(/^\/|\/$/g, '').split('/').pop().replace(/-/g, ' ');
    if (/^\/(articles|interactive|about)\/?$/.test(p)) t = { articles: 'Articles', interactive: 'Interactive', about: 'About' }[p.split('/')[1]];
    return { t, kind };
  }
  const refName = s => s.name ? s.name : 'Direct or unknown';

  /* ---------- skeleton ---------- */
  function dash() {
    app.innerHTML = `<div class="wrap">
      <header>
        <div><p class="k">YEKTA · yektapour.com</p><h1>Stats<i>.</i></h1></div>
        <nav class="ranges">${RANGES.map(([v, l]) => `<button type="button" data-r="${v}" aria-pressed="${v === range}">${l}</button>`).join('')}</nav>
      </header>
      <section class="kpis" id="kpis"></section>
      <section class="chart"><p class="k" id="ck">Visitors</p><div id="chart"></div><div class="tip" id="tip"></div></section>
      <div class="grid">
        <section class="panel wide" id="p-pages"></section>
        <section class="panel" id="p-refs"></section>
        <section class="panel" id="p-loc"></section>
        <section class="panel" id="p-size"></section>
        <section class="panel" id="p-br"></section>
        <section class="panel" id="p-sys"></section>
        <section class="panel" id="p-lang"></section>
      </div>
      <footer><span id="upd"></span><span><button type="button" id="rf">Refresh</button> · <button type="button" id="out">Forget key on this device</button></span></footer>
    </div>`;
    $('.ranges').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b || b.dataset.r === range) return; range = b.dataset.r; set('yekta_stats_range', range); $$('.ranges button').forEach(x => x.setAttribute('aria-pressed', x === b)); load(); });
    $('#rf').addEventListener('click', load);
    $('#out').addEventListener('click', () => { set(KEY, null); key = null; gate(); });
    load();
  }
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* ---------- data ---------- */
  async function load() {
    const id = ++busy, sp = span();
    $('.wrap').classList.add('load');
    try {
      const [tot, hits, refs, loc, size, br, sys, lang] = await Promise.all([
        api('/stats/total', sp),
        api('/stats/hits', { ...sp, limit: 100 }),
        api('/stats/toprefs', { ...sp, limit: 50 }),
        api('/stats/locations', { ...sp, limit: 50 }),
        api('/stats/sizes', { ...sp, limit: 20 }),
        api('/stats/browsers', { ...sp, limit: 20 }),
        api('/stats/systems', { ...sp, limit: 20 }),
        api('/stats/languages', { ...sp, limit: 20 }).catch(() => ({ stats: [] }))
      ]);
      if (id !== busy) return;
      const total = tot.total || 0;
      const pages = (hits.hits || []).filter(h => !h.event);
      const refList = (refs.stats || []);
      kpis(total, tot.stats || [], pages, refList);
      lastDays = tot.stats || []; chart(lastDays);
      list('#p-pages', 'Pages', pages.map(h => { const p = page(h); return { n: p.t, tag: p.kind, c: h.count }; }), total, 12);
      list('#p-refs', 'Where visitors came from', refList.map(s => ({ n: refName(s), c: s.count })), total, 8);
      list('#p-loc', 'Countries', (loc.stats || []).map(s => ({ n: s.name || 'Unknown', c: s.count })), total, 8);
      list('#p-size', 'Devices', (size.stats || []).map(s => ({ n: s.name || 'Unknown', c: s.count })), total, 8);
      list('#p-br', 'Browsers', (br.stats || []).map(s => ({ n: s.name || 'Unknown', c: s.count })), total, 8);
      list('#p-sys', 'Systems', (sys.stats || []).map(s => ({ n: s.name || 'Unknown', c: s.count })), total, 8);
      list('#p-lang', 'Languages', (lang.stats || []).map(s => ({ n: s.name || 'Unknown', c: s.count })), total, 8);
      $('#upd').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + ' · Counts are unique visitors';
    } catch (er) {
      if (er.auth) { set(KEY, null); key = null; return gate('The key was not accepted. Paste it again.'); }
      $('#upd').textContent = er.message || 'Could not load the stats.';
    } finally { if (id === busy) $('.wrap').classList.remove('load'); }
  }

  function kpis(total, days, pages, refs) {
    const today = days.length ? days[days.length - 1].daily || 0 : 0;
    const top = pages.filter(h => h.path !== '/')[0];
    const ref = refs.filter(s => s.name)[0];
    const label = RANGES.find(r => r[0] === range)[1].toLowerCase();
    $('#kpis').innerHTML = `
      <div class="kpi"><p class="k">Visitors</p><b data-n="${total}">0</b><small>${range === 'all' ? 'since launch' : range === 'today' ? 'today' : 'last ' + label}</small></div>
      <div class="kpi"><p class="k">Today</p><b data-n="${today}">0</b><small>${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</small></div>
      <div class="kpi"><p class="k">Most viewed</p><b class="s">${top ? esc(page(top).t) : '—'}</b><small>${top ? fmt(top.count) + ' visitors' : 'no visits yet'}</small></div>
      <div class="kpi"><p class="k">Top source</p><b class="s">${ref ? esc(ref.name) : '—'}</b><small>${ref ? fmt(ref.count) + ' visitors' : 'no referrals yet'}</small></div>`;
    $$('#kpis b[data-n]').forEach(b => countUp(b, +b.dataset.n));
  }
  function countUp(el, to) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || to < 2) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), d = 1100;
    const f = t => { const k = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(Math.round(to * e)); if (k < 1) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }

  /* ---------- the red thread chart ---------- */
  function chart(days) {
    const box = $('#chart'), tip = $('#tip');
    let pts;
    if (range === 'today' || days.length < 2) {
      const d = days[days.length - 1], h = (d && d.hourly) || [];
      const now = range === 'today' || (d && d.day === new Date().toISOString().slice(0, 10)) ? new Date().getHours() : 23;
      pts = Array.from({ length: 24 }, (_, i) => ({ v: h[i] || 0, l: String(i).padStart(2, '0') + ':00', s: String(i).padStart(2, '0') })).slice(0, Math.max(now + 1, 2));
      $('#ck').textContent = 'Visitors per hour';
    } else {
      pts = days.map(d => { const dt = new Date(d.day + 'T12:00:00'); return { v: d.daily || 0, l: dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }), s: dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) }; });
      $('#ck').textContent = 'Visitors per day';
    }
    if (pts.length < 2) pts = [...pts, ...pts].slice(0, 2).map((p, i) => ({ ...(p || { v: 0, l: '', s: '' }) }));
    const W = Math.max(320, box.clientWidth || 900), H = innerWidth <= 520 ? 200 : 260, pl = 34, pr = 8, pt = 14, pb = 26;
    const max = Math.max(4, ...pts.map(p => p.v)), nice = niceMax(max);
    const x = i => pl + (W - pl - pr) * (i / (pts.length - 1)), y = v => pt + (H - pt - pb) * (1 - v / nice);
    const P = pts.map((p, i) => [x(i), y(p.v)]);
    const line = smooth(P), area = line + ` L${P[P.length - 1][0]},${H - pb} L${P[0][0]},${H - pb} Z`;
    const ticks = [0, nice / 2, nice];
    const every = Math.max(1, Math.ceil(pts.length / (W < 600 ? 5 : 9)));
    box.innerHTML = `<svg class="c" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Visitors chart">
      <defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3141f" stop-opacity=".22"/><stop offset="1" stop-color="#e3141f" stop-opacity="0"/></linearGradient></defs>
      ${ticks.map(t => `<line class="g" x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}"/><text class="ax" x="${pl - 10}" y="${y(t) + 4}" text-anchor="end">${fmt(t)}</text>`).join('')}
      ${pts.map((p, i) => i % every === 0 || i === pts.length - 1 ? `<text class="ax" x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'}">${esc(p.s)}</text>` : '').join('')}
      <path class="ar" d="${area}"/>
      <path class="th" d="${line}"/>
      <circle class="dt" r="5" cx="0" cy="0"/>
    </svg>`;
    const svg = $('svg', box), th = $('.th', svg), dt = $('.dt', svg);
    th.style.setProperty('--len', Math.ceil(th.getTotalLength() + 2));
    const move = e => {
      const r = svg.getBoundingClientRect(), mx = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) * (W / r.width);
      let i = Math.round((mx - pl) / ((W - pl - pr) / (pts.length - 1))); i = Math.max(0, Math.min(pts.length - 1, i));
      dt.setAttribute('cx', P[i][0]); dt.setAttribute('cy', P[i][1]); dt.style.opacity = 1;
      tip.innerHTML = `${esc(pts[i].l)} · <b>${fmt(pts[i].v)}</b>`;
      tip.style.left = (P[i][0] * r.width / W) + 'px'; tip.style.top = (36 + 18 + 15 + P[i][1] * r.height / H) + 'px'; tip.style.opacity = 1;
    };
    const leave = () => { dt.style.opacity = 0; tip.style.opacity = 0; };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerleave', leave);
    svg.addEventListener('touchstart', move, { passive: true }); svg.addEventListener('touchmove', move, { passive: true });
  }
  function niceMax(m) { const p = Math.pow(10, Math.floor(Math.log10(m))), f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  function smooth(P) { /* monotone cubic: no overshoot below zero */
    const n = P.length; if (n < 2) return '';
    const dx = [], dy = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = P[i + 1][0] - P[i][0]; dy[i] = P[i + 1][1] - P[i][1]; m[i] = dy[i] / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) { if (m[i] === 0) { t[i] = t[i + 1] = 0; continue; } const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b; if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; } }
    let d = `M${P[0][0].toFixed(1)},${P[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) { const h = dx[i] / 3; d += ` C${(P[i][0] + h).toFixed(1)},${(P[i][1] + t[i] * h).toFixed(1)} ${(P[i + 1][0] - h).toFixed(1)},${(P[i + 1][1] - t[i + 1] * h).toFixed(1)} ${P[i + 1][0].toFixed(1)},${P[i + 1][1].toFixed(1)}`; }
    return d;
  }

  /* ---------- lists with a thin red thread per row ---------- */
  function list(sel, title, rows, total, show) {
    const el = $(sel);
    const max = Math.max(1, ...rows.map(r => r.c));
    const all = Math.max(total, 1);
    const row = r => `<li class="r" style="--w:${(r.c / max * 100).toFixed(1)}%"><span class="n">${esc(r.n)}${r.tag ? `<em>${esc(r.tag)}</em>` : ''}</span><span class="v">${fmt(r.c)}<i>${Math.round(r.c / all * 100)}%</i></span></li>`;
    el.innerHTML = `<p class="k">${esc(title)}<span>${rows.length ? fmt(rows.length) : ''}</span></p>` +
      (rows.length ? `<ol>${rows.slice(0, show).map(row).join('')}</ol>${rows.length > show ? `<button type="button" class="more">Show all ${rows.length}</button>` : ''}` : `<p class="empty">Nothing yet in this range.</p>`);
    const b = $('.more', el);
    if (b) b.addEventListener('click', () => { $('ol', el).insertAdjacentHTML('beforeend', rows.slice(show).map(row).join('')); b.remove(); grow(el); });
    grow(el);
  }
  function grow(el) { requestAnimationFrame(() => requestAnimationFrame(() => $$('li.r:not(.on)', el).forEach((li, i) => setTimeout(() => li.classList.add('on'), i * 40)))); }

  let rz, lw = innerWidth; addEventListener('resize', () => { if (innerWidth === lw) return; lw = innerWidth; clearTimeout(rz); rz = setTimeout(() => { if (lastDays && $('#chart')) chart(lastDays); }, 250); });

  if (key) dash(); else gate();
})();
