/* Yekta Light — panel UI */
(function (L) {
  'use strict';
  const C = L.color, R = L.render, PNG = L.png, host = L.host;
  const KEY = 'yektalight.state.v2', OLDKEY = 'yektalight.state.v1', PKEY = 'yektalight.presets.v1';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  function fill(t, d) {
    if (Array.isArray(d)) return Array.isArray(t) && (d.length === 0 || t.length === d.length) ? t : clone(d);
    if (d && typeof d === 'object') { const o = {}; for (const k in d) o[k] = fill(t && typeof t === 'object' ? t[k] : undefined, d[k]); return o; }
    return typeof t === typeof d ? t : d;
  }

  const DEF = R.defaultState();
  const S = fill(store.get(KEY, null) || store.get(OLDKEY, null), DEF);
  if (R.models.indexOf(S.model) < 0) S.model = 'sphere';
  let userPresets = store.get(PKEY, []);

  // ---------- undo / redo (snapshots of the look, not UI state) ----------
  const LOOK = ['model', 'lens', 'rot', 'light', 'light2', 'ambient', 'bounce', 'rim', 'matA', 'matB', 'compare', 'shadows', 'planes', 'ground', 'groundColor', 'grid', 'gridN', 'pick', 'shadowTint', 'envCustom', 'envColor', 'backdrop', 'backdropColor', 'pins'];
  const snap = () => { const o = {}; LOOK.forEach((k) => { o[k] = clone(S[k]); }); return o; };
  let undoStack = [JSON.stringify(snap())], redoStack = [];
  let saveT = null;
  function saveSoon() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      store.set(KEY, S);
      const s = JSON.stringify(snap());
      if (s !== undoStack[undoStack.length - 1]) { undoStack.push(s); if (undoStack.length > 60) undoStack.shift(); redoStack = []; refreshUndo(); }
    }, 300);
  }
  function applySnap(str) { const o = JSON.parse(str); LOOK.forEach((k) => { S[k] = o[k]; }); applyBackdrop(); famSig = ''; syncEditor(); refreshAll(); renderGrid(); requestRender(); store.set(KEY, S); }
  function undo() { if (undoStack.length < 2) return; redoStack.push(undoStack.pop()); applySnap(undoStack[undoStack.length - 1]); refreshUndo(); }
  function redo() { if (!redoStack.length) return; const s = redoStack.pop(); undoStack.push(s); applySnap(s); refreshUndo(); }

  // ---------- DOM helpers ----------
  function el(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function setCls(e, c, on) {
    const list = (e.className || '').split(/\s+/).filter((x) => x && x !== c);
    if (on) list.push(c);
    e.className = list.join(' ');
  }
  const css = (c) => 'rgb(' + C.to255(c).join(',') + ')';
  const EV = typeof window.PointerEvent === 'function' ? ['pointerdown', 'pointermove', 'pointerup'] : ['mousedown', 'mousemove', 'mouseup'];
  function onDrag(node, h) {
    node.addEventListener(EV[0], (e) => {
      if (e.button != null && e.button !== 0) return;
      const rect = node.getBoundingClientRect();
      if (h.start && h.start(e, rect) === false) return;
      e.preventDefault(); e.stopPropagation();
      const mv = (ev) => { h.move && h.move(ev, node.getBoundingClientRect()); };
      const up = (ev) => { document.removeEventListener(EV[1], mv); document.removeEventListener(EV[2], up); h.end && h.end(ev); };
      document.addEventListener(EV[1], mv); document.addEventListener(EV[2], up);
    });
  }
  const refreshers = [];
  const refreshAll = () => refreshers.forEach((f) => f());
  function btn(parent, label, title, onClick, cls) {
    const b = el('div', 'btn ' + (cls || ''), parent, label);
    if (title) b.title = title;
    b.addEventListener('click', onClick);
    return b;
  }
  function seg(parent, items, get, set, cls) {
    const w = el('div', 'seg ' + (cls || ''), parent);
    const bs = items.map((it) => [btn(w, it.label, it.title, () => { set(it.value); refreshAll(); }), it]);
    const r = () => bs.forEach(([b, it]) => setCls(b, 'on', get() === it.value));
    refreshers.push(r); r();
    return w;
  }
  function toggle(parent, label, title, get, set, cls) {
    const b = btn(parent, label, title, () => { set(!get()); refreshAll(); }, cls);
    const r = () => setCls(b, 'on', !!get());
    refreshers.push(r); r();
    return b;
  }
  function section(parent, id, title, extra) {
    const s = el('div', 'sec', parent), hd = el('div', 'sechd', s), arrow = el('span', 'arrow', hd);
    const t = el('span', 'sect', hd, title);
    const right = el('div', 'secx', hd);
    if (extra) extra(right);
    const body = el('div', 'secbody', s);
    const r = () => { const c = !!S.collapsed[id]; body.style.display = c ? 'none' : 'block'; arrow.textContent = c ? '▸' : '▾'; };
    hd.addEventListener('click', (e) => { if (e.target !== hd && e.target !== arrow && e.target !== t) return; S.collapsed[id] = !S.collapsed[id]; r(); saveSoon(); });
    refreshers.push(r); r();
    return body;
  }
  function ref(path) {
    const parts = path.split('.');
    let o = parts[0] === 'mat' ? S['mat' + S.active] : S[parts[0]];
    for (let i = 1; i < parts.length - 1; i++) o = o[parts[i]];
    return [o, parts[parts.length - 1]];
  }
  const getP = (p) => { const [o, k] = ref(p); return o[k]; };
  const setP = (p, v) => { const [o, k] = ref(p); o[k] = v; };
  function defP(p) {
    const parts = p.split('.');
    let o = parts[0] === 'mat' ? DEF.matA : DEF[parts[0]];
    for (let i = 1; i < parts.length; i++) o = o[parts[i]];
    return o;
  }
  let toastEl, toastT;
  function toast(msg) { toastEl.textContent = msg; toastEl.style.opacity = '1'; clearTimeout(toastT); toastT = setTimeout(() => { toastEl.style.opacity = '0'; }, 1300); }

  // ---------- idle queue (low-priority work runs only when nothing renders) ----------
  const idleQ = [];
  function idle(f) { idleQ.push(f); pumpIdle(); }
  let idleT = null;
  function pumpIdle() {
    if (idleT || !idleQ.length) return;
    idleT = setTimeout(() => { idleT = null; if (job) { pumpIdle(); return; } const f = idleQ.shift(); try { f(); } catch (e) { /* ignore */ } pumpIdle(); }, 40);
  }

  // ---------- time-sliced, cancellable rendering ----------
  // Renders run in ~8ms slices so Photoshop / Clip Studio stay responsive; drafts during drags, a refined frame after.
  let vpSize = 240, job = null, dirtyDraft = false, dirtyFinal = false, finalT = null, costPx = 0;
  // ================= BUILD =================
  const app = document.getElementById('app');
  const isPS = host.kind === 'photoshop';

  // header
  const head = el('div', 'head', app);
  const logo = el('div', 'logo', head);
  el('span', 'logo-dot', logo); el('span', 'logo-a', logo, 'YEKTA'); el('span', 'logo-b', logo, 'light');
  el('div', 'grow', head);
  const bUndo = btn(head, '↶', 'Undo (Ctrl+Z)', undo, 'icon');
  const bRedo = btn(head, '↷', 'Redo (Ctrl+Shift+Z)', redo, 'icon');
  function refreshUndo() { setCls(bUndo, 'off', undoStack.length < 2); setCls(bRedo, 'off', !redoStack.length); }
  toggle(head, 'Live', 'Live: send the color to ' + host.name + ' while you drag', () => S.live, (v) => { S.live = v; saveSoon(); });
  if (host.canPin) {
    let pinned = true;
    const pb = btn(head, 'Pin', 'Keep window on top of Clip Studio', async () => { pinned = !pinned; await host.setPin(pinned); setCls(pb, 'on', pinned); });
    Promise.resolve(host.getPin()).then((v) => { pinned = !!v; setCls(pb, 'on', pinned); });
  }

  // viewport
  const vpWrap = el('div', 'vpwrap', app);
  const vp = el('div', 'vp', vpWrap);
  const canDirect = (() => {
    try { const c = document.createElement('canvas'), x = c.getContext && c.getContext('2d'); return !!(x && typeof x.putImageData === 'function' && typeof ImageData === 'function'); } catch (e) { return false; }
  })();
  const vpImg = canDirect ? el('canvas', 'vpimg', vp) : el('img', 'vpimg', vp);
  if (!canDirect) { vpImg.draggable = false; vpImg.alt = ''; }
  const horizon = el('div', 'horizon', vp);
  const sun = el('div', 'sun', vp); sun.title = 'Key light — drag (outside the ring = back light)'; el('div', 'sun-core', sun);
  const sun2 = el('div', 'sun sun2', vp); sun2.title = 'Second light — drag'; el('div', 'sun-core', sun2);
  const marker = el('div', 'marker', vp);
  const vpHint = el('div', 'vphint', vp, '');
  const busy = el('div', 'busy', vp);
  const quick = el('div', 'quick', vpWrap);
  quickSlider(quick, 'Intensity', 'light.intensity', 0, 3);
  quickSlider(quick, 'Wrap', 'light.wrap', 0, 1);

  // mode + toggles
  const tb1 = el('div', 'toolbar', app);
  seg(tb1, [
    { label: 'Pick', value: 'pick', title: 'Click/drag on the form to pick (Alt = light, Shift = rotate) [P]' },
    { label: 'Light', value: 'light', title: 'Drag to move the key light [L]' },
    { label: 'Light 2', value: 'light2', title: 'Drag to move the second light (turns it on)' },
    { label: 'Rotate', value: 'rotate', title: 'Drag to rotate the form [R]' },
  ], () => S.mode, (v) => { S.mode = v; if (v === 'light2' && !S.light2.on) { S.light2.on = true; requestRender(); } saveSoon(); });
  el('div', 'grow', tb1);
  toggle(tb1, 'Planes', 'Faceted planes (block-in)', () => S.planes, (v) => { S.planes = v; requestRender(); saveSoon(); });
  toggle(tb1, 'Ground', 'Ground plane with cast + contact shadow', () => S.ground, (v) => { S.ground = v; requestRender(); saveSoon(); });

  // models
  const MODEL_NAMES = {
    sphere: 'Sphere', head: 'Male head — scan "Lee Perry-Smith" by Infinite-Realities (CC BY 3.0)',
    headF: 'Female head — "Woman\'s Head", Artur Loewental, Three D Scans (no copyright restrictions)',
    skull: 'Skull — Vladimir Petkovic, Khronos glTF samples (CC0)', egg: 'Egg — basic head mass', cube: 'Cube', cylinder: 'Cylinder',
    cone: 'Cone', torus: 'Torus', drape: 'Drapery — cloth folds', blob: 'Organic form',
  };
  const modelStrip = el('div', 'models', app);
  const modelEls = R.models.map((m) => {
    const d = el('div', 'model', modelStrip);
    const im = el('img', '', d); im.draggable = false;
    const t = L.thumbs && L.thumbs.models && L.thumbs.models[m];
    if (t) im.src = t; else idle(() => { im.src = PNG.dataURL(48, 48, modelIconBuf(m)); });
    d.title = MODEL_NAMES[m] || m;
    d.addEventListener('click', () => {
      if (S.model === m) return;
      S.model = m; S.rot = clone(R.modelRot[m] || DEF.rot); costPx = 0;
      refreshAll(); requestRender(); saveSoon();
    });
    return [d, m];
  });
  refreshers.push(() => modelEls.forEach(([d, m]) => setCls(d, 'on', S.model === m)));

  // camera row
  const camRow = el('div', 'toolbar small', app);
  Object.keys(R.views).forEach((k) => btn(camRow, k, 'Camera: ' + k, () => {
    if (S.model === 'sphere') { toast('Pick a form to change the view'); return; }
    S.rot = clone(R.views[k]); requestRender(); saveSoon();
  }));
  el('div', 'grow', camRow);
  seg(camRow, [{ label: 'Ortho', value: 'ortho', title: 'Orthographic' }, { label: '85', value: '85', title: '85mm lens' }, { label: '50', value: '50', title: '50mm lens' }, { label: '35', value: '35', title: '35mm lens (strong perspective)' }],
    () => S.lens, (v) => { S.lens = v; costPx = 0; requestRender(); saveSoon(); });

  // backdrop behind the form (judge values against your canvas tone)
  const bdRow = el('div', 'toolbar small', app);
  el('span', 'rowlbl', bdRow, 'BACKDROP');
  el('div', 'grow', bdRow);
  seg(bdRow, [
    { label: 'Dark', value: 'dark', title: 'Dark backdrop' }, { label: 'Mid', value: 'mid', title: 'Mid-gray backdrop' },
    { label: 'Light', value: 'light', title: 'Light backdrop' }, { label: 'Custom', value: 'custom', title: 'Your own color (edit "Backdrop" in 03 Color)' },
  ], () => S.backdrop, (v) => { S.backdrop = v; applyBackdrop(); saveSoon(); });
  // material A/B + value row
  const tb2 = el('div', 'toolbar small', app);
  seg(tb2, [{ label: 'A', value: 'A', title: 'Edit material A (main form)' }, { label: 'B', value: 'B', title: 'Edit material B (small sphere)' }],
    () => S.active, (v) => { S.active = v; if (/^(base|spec|sss)$/.test(S.target)) syncEditor(); requestRender(); saveSoon(); });
  toggle(tb2, 'A|B', 'Show material B sphere', () => S.compare, (v) => { S.compare = v; requestRender(); saveSoon(); });
  btn(tb2, '⇄', 'Swap materials A / B', () => { const t = S.matA; S.matA = S.matB; S.matB = t; syncEditor(); refreshAll(); requestRender(); saveSoon(); });
  el('div', 'grow', tb2);
  seg(tb2, [
    { label: 'Color', value: 'off', title: 'Full color' }, { label: 'Gray', value: 'gray', title: 'Grayscale value check [V]' },
    { label: 'Notan', value: 'notan', title: 'Two values (light / shadow)' }, { label: '3', value: 'v3', title: 'Three values' }, { label: '5', value: 'v5', title: 'Five values' },
  ], () => S.valueMode, (v) => { S.valueMode = v; requestRender(); saveSoon(); });
  const isoBtn = toggle(tb2, '≡', 'Highlight every area with the same value as the picked color', () => S.iso, (v) => { S.iso = v; S.isoLuma = C.luma(S.pick); requestRender(); saveSoon(); });
  void isoBtn;

  // ramp + families
  const rampRow = el('div', 'ramp', app);
  rampRow.title = 'Value ramp across the form — click to pick';
  const rampCells = [];
  for (let i = 0; i < 11; i++) { const c = el('div', 'rc', rampRow); c.addEventListener('click', () => { if (c._c) setPick(c._c, true); }); rampCells.push(c); }
  const famHead = el('div', 'famhead', app);
  el('span', 'fht', famHead, 'LIGHT FAMILIES');
  el('div', 'grow', famHead);
  btn(famHead, isPS ? '+ Swatches' : 'Copy HEX', isPS ? 'Add these colors to Photoshop Swatches' : 'Copy all family colors as HEX', async () => {
    const fams = R.families(S);
    if (host.addSwatches) { await host.addSwatches(fams.map((f) => ({ name: 'Yekta ' + f.label, color: f.color }))); toast('Added to Swatches'); }
    else { await host.copyText(fams.map((f) => f.label + ' ' + C.toHex(f.color).toUpperCase()).join('\n')); toast('Copied ' + fams.length + ' colors'); }
  }, 'small');
  let pinMode = false;
  toggle(famHead, 'Pin', 'Pin mode: click a color to lock it (it will not change with the light). Click again to unpin.', () => pinMode, (v) => { pinMode = v; famSig = ''; updateFamilies(); }, 'small');
  toggle(famHead, 'Big', 'Large palette (easy to eyedrop from Clip Studio)', () => S.bigPalette, (v) => { S.bigPalette = v; updateFamilies(); saveSoon(); }, 'small');
  const famRow = el('div', 'fams', app);

  // pick bar
  const pickBar = el('div', 'pickbar', app);
  const bigSw = el('div', 'bigsw', pickBar);
  bigSw.title = 'Picked color' + (!isPS ? ' — in Clip Studio use "Obtain screen color" on this swatch' : '');
  const pickInfo = el('div', 'pickinfo', pickBar);
  const hexIn = el('input', 'hex', pickInfo); hexIn.type = 'text'; hexIn.spellcheck = false;
  const pickSub = el('div', 'picksub', pickInfo, '');
  const warnRow = el('div', 'warn', pickInfo);
  const warnTxt = el('span', '', warnRow, 'Low chroma — may read muddy');
  btn(warnRow, 'Fix', 'Restore chroma (keeps value and hue)', () => { setPick(fixMuddy(S.pick), true); }, 'small');
  void warnTxt;
  const pbtns = el('div', 'pbtns', pickBar);
  btn(pbtns, host.sendLabel, isPS ? 'Set as Photoshop foreground color' : 'Copy HEX to clipboard', () => sendPick(true), 'acc');
  const pb2 = el('div', 'prow', pbtns);
  if (isPS) btn(pb2, 'BG', 'Set as Photoshop background color', () => { host.setBG(S.pick); toast('Background ' + C.toHex(S.pick).toUpperCase()); }, 'small');
  btn(pb2, 'Get', isPS ? 'Load Photoshop foreground into the selected target' : 'Load HEX from clipboard into the selected target', async () => {
    const c = await host.getColor();
    if (!c) { toast('No color found'); return; }
    targetSet(c); syncEditor(); saveSoon(); toast('Loaded ' + C.toHex(c).toUpperCase());
  }, 'small');
  if (host.onColorChange) toggle(pbtns, 'Follow FG', 'Preview Photoshop’s foreground color as the base (local) color of the form', () => S.followFG, (v) => { S.followFG = v; saveSoon(); }, 'small');
  hexIn.addEventListener('change', () => { const c = C.fromHex(hexIn.value); if (c) setPick(c, true); else refreshPick(); });
  hexIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') hexIn.blur(); e.stopPropagation(); });
  const histRow = el('div', 'hist', app);

  // 01 light
  const lBody = section(app, 'light', '01  Light');
  const setRow = el('div', 'setups', lBody);
  Object.keys(R.setups).forEach((k) => btn(setRow, k, k + ' lighting', () => {
    const s = R.setups[k];
    S.light.dir = s.key.slice();
    if (s.l2) { S.light2.on = true; S.light2.dir = s.l2.dir.slice(); S.light2.intensity = s.l2.intensity; } else if (k !== 'Rim') S.light2.on = false;
    refreshAll(); requestRender(); saveSoon(); toast(k);
  }, 'small'));
  const lc = el('div', 'cols', lBody), l1 = el('div', 'col', lc), l2c = el('div', 'col', lc);
  el('div', 'colt', l1, 'Key & sky');
  pslider(l1, 'Key temp', 'light.kelvin', 2000, 10000, 100, (v) => Math.round(v) + 'K', (v) => { S.light.color = R.kelvin(v); });
  pslider(l1, 'Sky', 'ambient.intensity', 0, 1.5, 0.01);
  pslider(l1, 'Sky temp', 'ambient.temp', 0, 1, 0.01, (v) => (v < 0.4 ? 'cool' : v > 0.6 ? 'warm' : 'neutral'), (v) => { S.ambient.color = R.shadowTemp(v); });
  pslider(l1, 'Bounce', 'bounce.intensity', 0, 1.5, 0.01);
  pslider(l1, 'Shadow tint', 'shadowTint.amount', 0, 1, 0.01);
  el('div', 'colt', l2c, 'Rim & light 2');
  pslider(l2c, 'Rim', 'rim.intensity', 0, 2, 0.01);
  pslider(l2c, 'Rim width', 'rim.width', 0, 1, 0.01);
  pslider(l2c, 'Light 2', 'light2.intensity', 0, 2, 0.01, null, (v) => { S.light2.on = v > 0.001; });
  pslider(l2c, 'L2 temp', 'light2.kelvin', 2000, 12000, 100, (v) => Math.round(v) + 'K', (v) => { S.light2.color = R.kelvin(v); S.light2.on = true; });
  pslider(l2c, 'Toon bands', 'light.bands', 0, 6, 1, (v) => (v < 2 ? 'off' : String(v)));
  pslider(l2c, 'Band edge', 'light.soft', 0, 1, 0.01);

  // 02 material
  const mBody = section(app, 'mat', '02  Material');
  const mc = el('div', 'cols', mBody), m1 = el('div', 'col', mc), m2 = el('div', 'col', mc);
  pslider(m1, 'Specular', 'mat.specInt', 0, 1.5, 0.01);
  pslider(m1, 'Gloss', 'mat.gloss', 0, 1, 0.01);
  pslider(m2, 'Metal', 'mat.metal', 0, 1, 0.01);
  pslider(m2, 'Skin SSS', 'mat.sss', 0, 1, 0.01);
  const mRow = el('div', 'row', mBody);
  toggle(mRow, 'Custom env', 'Use your own environment color for metal / gloss reflections (edit "Env" in 03 Color)', () => S.envCustom, (v) => { S.envCustom = v; requestRender(); saveSoon(); });
  toggle(mRow, 'Shadows + AO', 'Self-shadowing on heads, skull, torus, drapery', () => S.shadows, (v) => { S.shadows = v; requestRender(); saveSoon(); });

  // 03 color editor
  const ceBody = section(app, 'ce', '03  Color');
  const chips = el('div', 'chips', ceBody);
  const TARGETS = [
    { id: 'pick', label: 'Picked' }, { id: 'base', label: 'Base' }, { id: 'spec', label: 'Spec' }, { id: 'sss', label: 'SSS' },
    { id: 'light', label: 'Key' }, { id: 'light2', label: 'Light 2' }, { id: 'ambient', label: 'Sky' }, { id: 'bounce', label: 'Bounce' },
    { id: 'rim', label: 'Rim' }, { id: 'ground', label: 'Ground' }, { id: 'shadow', label: 'Shadow' }, { id: 'env', label: 'Env' },
    { id: 'backdrop', label: 'Backdrop' },
  ];
  const chipEls = TARGETS.map((t) => {
    const c = el('div', 'chip', chips), sw = el('span', 'csw', c); el('span', '', c, t.label);
    c.addEventListener('click', () => { S.target = t.id; syncEditor(); refreshChips(); saveSoon(); });
    return [c, sw, t];
  });
  const ceRow = el('div', 'cerow', ceBody);
  const wheel = el('div', 'wheel', ceRow);
  const ringImg = el('img', 'ring', wheel); ringImg.draggable = false;
  const svImg = el('img', 'sv', wheel); svImg.draggable = false;
  const hueMk = el('div', 'mk', wheel), svMk = el('div', 'mk', wheel);
  const sliders = el('div', 'csliders', ceRow);
  const CS = [{ k: 'H' }, { k: 'S' }, { k: 'V' }, { k: 'R' }, { k: 'G' }, { k: 'B' }].map((d) => {
    const row = el('div', 'cs', sliders);
    el('div', 'csl', row, d.k);
    const tr = el('div', 'cst', row), img = el('img', 'csimg', tr); img.draggable = false;
    const th = el('div', 'csth', tr), val = el('div', 'csv', row);
    onDrag(tr, { start: (e, r) => applyCS(d.k, (e.clientX - r.left) / r.width), move: (e, r) => applyCS(d.k, (e.clientX - r.left) / r.width), end: () => commitEdit() });
    return { d, img, th, val };
  });

  // 04 grid
  const gBody = section(app, 'grid', '04  Color grid', (x) => {
    btn(x, 'Auto', 'Fill corners from the light families', () => {
      const f = R.families(S);
      S.grid = [f[0].color, f[2].color, f[f.length - 4].color, f[4].color].map((c) => c.slice());
      renderGrid(); refreshChips(); saveSoon();
    }, 'small');
    seg(x, [{ label: '5', value: 5 }, { label: '7', value: 7 }, { label: '9', value: 9 }], () => S.gridN, (v) => { S.gridN = v; renderGrid(); saveSoon(); }, 'small');
  });
  const gridWrap = el('div', 'gridwrap', gBody);
  const gridImg = el('img', 'gridimg', gridWrap); gridImg.draggable = false;
  const cornerEls = [0, 1, 2, 3].map((i) => {
    const c = el('div', 'corner c' + i, gridWrap);
    c.title = 'Corner ' + (i + 1) + ': click to edit with the color wheel';
    c.addEventListener(EV[0], (e) => { e.stopPropagation(); S.target = 'g' + i; syncEditor(); refreshChips(); });
    return c;
  });

  // 05 presets
  const prBody = section(app, 'pr', '05  Presets', (x) => {
    btn(x, '+ Save', 'Save light + active material', () => {
      userPresets.push({ name: 'My look ' + (userPresets.length + 1), light: clone(S.light), light2: clone(S.light2), ambient: clone(S.ambient), bounce: clone(S.bounce), rim: clone(S.rim), mat: clone(S['mat' + S.active]) });
      store.set(PKEY, userPresets); renderPresets(); toast('Preset saved');
    }, 'small');
  });
  const prGrid = el('div', 'presets', prBody);
  el('div', 'note', prBody, 'Click: light + material • Shift: material only • Alt: light only');
  const credits = el('div', 'credits', app, 'Heads: Lee Perry-Smith scan © Infinite-Realities (CC BY 3.0) • “Woman’s Head”, A. Loewental, Three D Scans • Skull: V. Petkovic (CC0)');
  void credits;
  toastEl = el('div', 'toast', document.body);

  // ================= LOGIC =================
  function quickSlider(parent, label, path, min, max) {
    const row = el('div', 'qs', parent);
    el('div', 'ql', row, label);
    const tr = el('div', 'qt', row), fillEl = el('div', 'qf', tr), th = el('div', 'qth', tr);
    const r = () => { const p = ((getP(path) - min) / (max - min)) * 100; fillEl.style.width = p + '%'; th.style.left = p + '%'; };
    const ap = (e, rc) => { setP(path, min + clamp((e.clientX - rc.left) / rc.width, 0, 1) * (max - min)); r(); requestRender(true); };
    onDrag(tr, { start: ap, move: ap, end: () => { requestRender(); saveSoon(); refreshAll(); } });
    tr.addEventListener('dblclick', () => { setP(path, defP(path)); refreshAll(); requestRender(); saveSoon(); });
    refreshers.push(r);
  }
  function pslider(parent, label, path, min, max, step, fmt, side) {
    const row = el('div', 'ps', parent), top = el('div', 'pstop', row);
    el('div', 'pl', top, label);
    const val = el('div', 'pv', top);
    const tr = el('div', 'pt', row), fillEl = el('div', 'pf', tr), th = el('div', 'pth', tr);
    tr.title = 'Double-click to reset';
    const r = () => {
      const v = getP(path), p = ((v - min) / (max - min)) * 100;
      fillEl.style.width = p + '%'; th.style.left = p + '%';
      val.textContent = fmt ? fmt(v) : (Math.round(v * 100) / 100).toFixed(2);
    };
    const setV = (v) => { setP(path, v); if (side) side(v); r(); refreshChips(); requestRender(true); };
    const ap = (e, rc) => { let v = min + clamp((e.clientX - rc.left) / rc.width, 0, 1) * (max - min); setV(Math.round(v / step) * step); };
    onDrag(tr, { start: ap, move: ap, end: () => { requestRender(); saveSoon(); refreshAll(); if (/^(light|ambient)\./.test(path)) syncEditorIf(['light', 'ambient']); } });
    tr.addEventListener('dblclick', () => { setV(defP(path)); refreshAll(); requestRender(); saveSoon(); });
    refreshers.push(r);
  }
  function syncEditorIf(ids) { if (ids.indexOf(S.target) >= 0) syncEditor(); }

  const SLICE = 8;
  // automation hook (used only by the promo recorder): wait-for-idle + always-final frames
  L.debug = {
    forceFinal: false, busy: () => !!job || dirtyDraft || dirtyFinal || !!finalT, S,
    update() { applyBackdrop(); famSig = ''; syncEditor(); refreshAll(); renderGrid(); requestRender(); },
  };
  function requestRender(draft) {
    if (draft && L.debug.forceFinal) draft = false;
    if (draft) { dirtyDraft = true; clearTimeout(finalT); finalT = setTimeout(() => { finalT = null; requestRender(false); }, 200); }
    else dirtyFinal = true;
    kick();
  }
  function kick() {
    if (job) {
      if (!job.draft && (dirtyDraft || dirtyFinal)) { job.cancelled = true; job = null; } else return;
    }
    if (dirtyDraft) { dirtyDraft = false; start(true); } else if (dirtyFinal) { dirtyFinal = false; start(false); }
  }
  function start(draft) {
    const dpr = Math.min(2, window.devicePixelRatio || 1), k = draft ? 1 : 1.6, budget = draft ? 35 : 900;
    let scale = draft ? 1 : canDirect ? dpr : Math.min(dpr, 1.5);
    if (costPx > 0 && !L.debug.forceFinal) { const est = costPx * k * Math.pow(vpSize * scale, 2); if (est > budget) scale *= Math.sqrt(budget / est); }
    scale = Math.max(scale, 0.35);
    const px = Math.max(48, Math.round(vpSize * scale));
    const snapS = clone(S);
    const gen = R.renderGen(snapS, px, px, { ss: draft ? 1 : 3 });
    const j = { draft, cancelled: false, work: 0 };
    job = j;
    if (!draft) setCls(busy, 'on', true);
    const step = () => {
      if (j.cancelled) return;
      const t0 = Date.now();
      let r;
      do { r = gen.next(); } while (!r.done && Date.now() - t0 < SLICE);
      j.work += Date.now() - t0;
      if (!r.done) { setTimeout(step, 0); return; }
      const c = j.work / (px * px * k);
      costPx = costPx ? costPx * 0.6 + c * 0.4 : c;
      draw(r.value, px);
      if (!draft) setCls(busy, 'on', false);
      job = null;
      afterFrame();
      kick();
      pumpIdle();
    };
    step();
  }
  function draw(buf, px) {
    if (canDirect) {
      if (vpImg.width !== px) { vpImg.width = px; vpImg.height = px; }
      vpImg.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length), px, px), 0, 0);
    } else vpImg.src = PNG.dataURL(px, px, buf);
  }
  function afterFrame() { updateOverlays(); updateRamp(); updateFamilies(); refreshChips(); }

  const toPct = (v) => ((v / R.VIEW + 1) / 2) * 100;
  function updateOverlays() {
    const hd = R.handleFromLight(S.light.dir);
    sun.style.left = toPct(hd[0]) + '%'; sun.style.top = toPct(-hd[1]) + '%';
    setCls(sun, 'back', S.light.dir[2] < 0);
    const h2 = R.handleFromLight(S.light2.dir);
    sun2.style.display = S.light2.on ? 'flex' : 'none';
    sun2.style.left = toPct(h2[0]) + '%'; sun2.style.top = toPct(-h2[1]) + '%';
    const hr = (R.RS / R.VIEW) * 50;
    horizon.style.left = 50 - hr + '%'; horizon.style.top = 50 - hr + '%'; horizon.style.width = 2 * hr + '%'; horizon.style.height = 2 * hr + '%';
    vp.style.cursor = S.mode === 'pick' ? 'crosshair' : S.mode === 'rotate' ? 'grab' : 'move';
  }
  function updateRamp() {
    R.ramp(S, rampCells.length).forEach((c, i) => { rampCells[i]._c = c; rampCells[i].style.backgroundColor = css(S.valueMode !== 'off' ? [C.luma(c), C.luma(c), C.luma(c)] : c); });
  }
  let famSig = '';
  function updateFamilies() {
    const fams = R.families(S).map((f) => (S.pins[f.id] ? Object.assign({}, f, { color: S.pins[f.id], pinned: true }) : f));
    const sig = JSON.stringify(fams) + S.bigPalette + pinMode;
    if (sig === famSig) return;
    famSig = sig;
    famRow.innerHTML = '';
    setCls(famRow, 'big', !!S.bigPalette);
    setCls(famRow, 'pinmode', pinMode);
    fams.forEach((f) => {
      const d = el('div', 'fam' + (f.pinned ? ' pinned' : ''), famRow), sw = el('div', 'fsw', d);
      sw.style.backgroundColor = css(f.color);
      if (f.pinned) el('div', 'pin', sw);
      el('div', 'fl', d, S.bigPalette ? f.label : f.short);
      d.title = f.label + ' ' + C.toHex(f.color).toUpperCase();
      d.addEventListener('click', (e) => {
        if (pinMode || e.altKey) {
          if (S.pins[f.id]) delete S.pins[f.id]; else S.pins[f.id] = f.color.slice();
          famSig = ''; updateFamilies(); saveSoon(); toast(S.pins[f.id] ? f.label + ' pinned' : f.label + ' unpinned');
          return;
        }
        setPick(f.color, true);
      });
    });
  }
  function backdropColor() { return S.backdrop === 'mid' ? [0.42, 0.42, 0.42] : S.backdrop === 'light' ? [0.82, 0.81, 0.79] : S.backdrop === 'custom' ? S.backdropColor : [0.1, 0.1, 0.11]; }
  function applyBackdrop() {
    if (S.backdrop === 'dark') { vp.style.background = ''; vp.style.borderRadius = ''; }
    else { vp.style.background = css(backdropColor()); vp.style.borderRadius = '12px'; }
    refreshChips();
  }

  // ---------- viewport interaction ----------
  let dragMode = null, last = null, pickedDuringDrag = false;
  onDrag(vp, {
    start(e, r) {
      const onSun = (n) => e.target === n || (e.target && e.target.parentNode === n);
      dragMode = onSun(sun) ? 'light' : onSun(sun2) ? 'light2' : e.altKey ? 'light' : e.shiftKey ? 'rotate' : S.mode;
      last = [e.clientX, e.clientY];
      vpHandle(e, r, true);
    },
    move(e, r) { vpHandle(e, r, false); },
    end() {
      if (dragMode === 'pick') { if (pickedDuringDrag) setPick(S.pick, true); }
      else { requestRender(); saveSoon(); }
      dragMode = null; vpHint.textContent = '';
    },
  });
  function vpHandle(e, r, first) {
    const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    const vx = (u * 2 - 1) * R.VIEW, vy = -(v * 2 - 1) * R.VIEW;
    if (dragMode === 'pick') {
      if (first) pickedDuringDrag = false;
      const p = R.pick(S, vx, vy);
      if (p) { pickedDuringDrag = true; marker.style.display = 'block'; marker.style.left = u * 100 + '%'; marker.style.top = v * 100 + '%'; setPick(p.color, false); }
    } else if (dragMode === 'light' || dragMode === 'light2') {
      const d = R.lightFromHandle(vx, vy);
      if (dragMode === 'light') S.light.dir = d; else { S.light2.dir = d; S.light2.on = true; }
      vpHint.textContent = d[2] < 0 ? 'Back light' : '';
      updateOverlays(); requestRender(true);
    } else if (dragMode === 'rotate') {
      if (S.model === 'sphere') { vpHint.textContent = 'Pick a form to rotate'; return; }
      S.rot.yaw += (e.clientX - last[0]) * 0.012;
      S.rot.pitch = clamp(S.rot.pitch + (e.clientY - last[1]) * 0.012, -1.55, 1.55);
      last = [e.clientX, e.clientY];
      marker.style.display = 'none';
      requestRender(true);
    }
  }

  // ---------- picked color ----------
  let lastSent = 0;
  function setPick(c, final) {
    S.pick = c.slice();
    if (S.iso) { S.isoLuma = C.luma(S.pick); if (final) requestRender(); }
    if (S.target === 'pick') syncEditor(); else refreshPick();
    if (final) { sendPick(false); addHistory(c); saveSoon(); }
    else if (S.live) { const now = Date.now(); if (now - lastSent > 70) { lastSent = now; host.setColor(S.pick); } }
  }
  function sendPick(explicit) {
    host.setColor(S.pick);
    if (explicit || !isPS) toast((isPS ? 'Foreground ' : 'Copied ') + C.toHex(S.pick).toUpperCase());
  }
  const chroma = (c) => { const o = C.srgbToOklab(c); return [o[0], Math.sqrt(o[1] * o[1] + o[2] * o[2]), o]; };
  function isMuddy(c) {
    const base = S['mat' + S.active].base, [l, ch] = chroma(c), bc = chroma(base)[1];
    return bc > 0.05 && ch < bc * 0.35 && l > 0.3 && l < 0.85 && S.valueMode === 'off';
  }
  function fixMuddy(c) {
    const [, ch, o] = chroma(c), bc = chroma(S['mat' + S.active].base)[1];
    let k = ch > 1e-4 ? (bc * 0.6) / ch : 1;
    let h = Math.atan2(o[2], o[1]);
    if (ch < 1e-4) { const bo = C.srgbToOklab(S['mat' + S.active].base); h = Math.atan2(bo[2], bo[1]); }
    const target = bc * 0.6;
    for (let i = 0; i < 24; i++) {
      const cc = target * (1 - i / 24), lab = [o[0], Math.cos(h) * cc, Math.sin(h) * cc];
      const lin = C.oklabToLin(lab);
      if (lin.every((v) => v >= -0.001 && v <= 1.001)) return C.oklabToSrgb(lab);
    }
    void k;
    return c;
  }
  function refreshPick() {
    bigSw.style.backgroundColor = css(S.pick);
    if (document.activeElement !== hexIn) hexIn.value = C.toHex(S.pick).toUpperCase();
    const hsv = C.rgbToHsv(S.pick[0], S.pick[1], S.pick[2]);
    pickSub.textContent = 'H' + Math.round(hsv[0]) + ' S' + Math.round(hsv[1] * 100) + ' V' + Math.round(hsv[2] * 100) + '  •  L' + Math.round(C.luma(S.pick) * 100);
    warnRow.style.display = isMuddy(S.pick) ? 'flex' : 'none';
  }
  function addHistory(c) {
    const hx = C.toHex(c);
    S.history = [hx].concat(S.history.filter((x) => x !== hx)).slice(0, 24);
    renderHistory();
  }
  function renderHistory() {
    histRow.innerHTML = '';
    if (!S.history.length) { el('div', 'note', histRow, 'Picked colors appear here'); return; }
    S.history.forEach((hx) => { const d = el('div', 'hsw', histRow); d.style.backgroundColor = hx; d.title = hx.toUpperCase(); d.addEventListener('click', () => setPick(C.fromHex(hx), true)); });
  }

  // Photoshop: follow the foreground colour (event driven, no polling)
  if (host.onColorChange) host.onColorChange((c) => {
    if (!S.followFG || !c) return;
    if (C.toHex(c) === C.toHex(S.pick)) return; // our own echo
    S['mat' + S.active].base = c; if (S.target === 'base') syncEditor();
    requestRender(); saveSoon();
  });

  // ---------- targets & editor ----------
  function targetGet() {
    const m = S['mat' + S.active];
    switch (S.target) {
      case 'base': return m.base; case 'spec': return m.spec; case 'sss': return m.sssColor;
      case 'light': return S.light.color; case 'light2': return S.light2.color; case 'ambient': return S.ambient.color;
      case 'bounce': return S.bounce.color; case 'rim': return S.rim.color; case 'ground': return S.groundColor;
      case 'shadow': return S.shadowTint.color; case 'env': return S.envColor; case 'backdrop': return backdropColor();
      default: if (S.target[0] === 'g') return S.grid[+S.target[1]]; return S.pick;
    }
  }
  function targetSet(c) {
    c = c.map((x) => clamp(x, 0, 1));
    const m = S['mat' + S.active];
    switch (S.target) {
      case 'base': m.base = c; break; case 'spec': m.spec = c; break; case 'sss': m.sssColor = c; break;
      case 'light': S.light.color = c; break; case 'light2': S.light2.color = c; S.light2.on = true; break;
      case 'ambient': S.ambient.color = c; break; case 'bounce': S.bounce.color = c; break;
      case 'rim': S.rim.color = c; break; case 'ground': S.groundColor = c; break;
      case 'shadow': S.shadowTint.color = c; if (S.shadowTint.amount < 0.05) S.shadowTint.amount = 0.4; break;
      case 'env': S.envColor = c; S.envCustom = true; break;
      case 'backdrop': S.backdropColor = c; S.backdrop = 'custom'; applyBackdrop(); refreshAll(); break;
      default:
        if (S.target[0] === 'g') { S.grid[+S.target[1]] = c; renderGrid(); }
        else { S.pick = c; refreshPick(); if (S.live) host.setColor(c); }
    }
    if (S.target !== 'pick' && S.target[0] !== 'g' && S.target !== 'backdrop') requestRender(true);
    refreshChips();
  }
  function refreshChips() {
    const m = S['mat' + S.active];
    const col = { pick: S.pick, base: m.base, spec: m.spec, sss: m.sssColor, light: S.light.color, light2: S.light2.color, ambient: S.ambient.color, bounce: S.bounce.color, rim: S.rim.color, ground: S.groundColor, shadow: S.shadowTint.color, env: S.envColor, backdrop: backdropColor() };
    chipEls.forEach(([c, sw, t]) => { sw.style.backgroundColor = css(col[t.id]); setCls(c, 'on', S.target === t.id); });
    cornerEls.forEach((c, i) => { c.style.backgroundColor = css(S.grid[i]); setCls(c, 'on', S.target === 'g' + i); });
  }
  const ed = { h: 0, s: 0, v: 0 };
  function syncEditor() {
    const c = targetGet(), hsv = C.rgbToHsv(c[0], c[1], c[2]);
    if (hsv[1] > 0.002 && hsv[2] > 0.002) ed.h = hsv[0];
    if (hsv[2] > 0.002) ed.s = hsv[1];
    ed.v = hsv[2];
    refreshEditor(); refreshPick();
  }
  function editHSV() { targetSet(C.hsvToRgb(ed.h, ed.s, ed.v)); refreshEditor(); }
  function commitEdit() {
    if (S.target === 'pick') { addHistory(S.pick); host.setColor(S.pick); }
    else if (S.target[0] !== 'g') requestRender();
    saveSoon();
  }
  function applyCS(k, t) {
    t = clamp(t, 0, 1);
    if (k === 'H') { ed.h = t * 360; editHSV(); return; }
    if (k === 'S') { ed.s = t; editHSV(); return; }
    if (k === 'V') { ed.v = t; editHSV(); return; }
    const c = targetGet().slice();
    c['RGB'.indexOf(k)] = t;
    targetSet(c);
    const hsv = C.rgbToHsv(c[0], c[1], c[2]);
    if (hsv[1] > 0.002 && hsv[2] > 0.002) ed.h = hsv[0];
    ed.s = hsv[1]; ed.v = hsv[2];
    refreshEditor();
  }
  const WS = 128, RING = 13;
  let svHue = -1;
  function makeRing() {
    const n = WS * 2, buf = new Uint8Array(n * n * 4), ro = n / 2, ri = ro - RING * 2;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - ro, dy = y + 0.5 - ro, r = Math.sqrt(dx * dx + dy * dy), a = clamp(Math.min(r - ri, ro - r) + 0.5, 0, 1);
      if (a <= 0) continue;
      const c = C.hsvToRgb(((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360, 1, 1), i = (y * n + x) * 4;
      buf[i] = c[0] * 255; buf[i + 1] = c[1] * 255; buf[i + 2] = c[2] * 255; buf[i + 3] = a * 255;
    }
    ringImg.src = PNG.dataURL(n, n, buf);
  }
  const sqGeom = () => { const side = Math.floor((WS / 2 - RING - 3) * Math.SQRT2); return { side, off: (WS - side) / 2 }; };
  function makeSV() {
    const g = sqGeom(), n = 48, buf = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const c = C.hsvToRgb(ed.h, x / (n - 1), 1 - y / (n - 1)), i = (y * n + x) * 4;
      buf[i] = c[0] * 255; buf[i + 1] = c[1] * 255; buf[i + 2] = c[2] * 255; buf[i + 3] = 255;
    }
    svImg.src = PNG.dataURL(n, n, buf);
    svImg.style.left = g.off + 'px'; svImg.style.top = g.off + 'px'; svImg.style.width = g.side + 'px'; svImg.style.height = g.side + 'px';
    svHue = ed.h;
  }
  let wheelMode = null;
  onDrag(wheel, {
    start(e, r) {
      const x = ((e.clientX - r.left) / r.width) * WS - WS / 2, y = ((e.clientY - r.top) / r.height) * WS - WS / 2;
      wheelMode = Math.sqrt(x * x + y * y) > WS / 2 - RING - 2 ? 'hue' : 'sv';
      wheelAt(x, y);
    },
    move(e, r) { wheelAt(((e.clientX - r.left) / r.width) * WS - WS / 2, ((e.clientY - r.top) / r.height) * WS - WS / 2); },
    end: () => commitEdit(),
  });
  function wheelAt(x, y) {
    if (wheelMode === 'hue') ed.h = ((Math.atan2(-y, x) * 180) / Math.PI + 360) % 360;
    else { const g = sqGeom(); ed.s = clamp((x + WS / 2 - g.off) / g.side, 0, 1); ed.v = clamp(1 - (y + WS / 2 - g.off) / g.side, 0, 1); }
    editHSV();
  }
  const trackCache = {};
  function track(key, fn) {
    if (trackCache[key]) return trackCache[key];
    const n = 48, buf = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { const c = fn(i / (n - 1)); buf[i * 4] = c[0] * 255; buf[i * 4 + 1] = c[1] * 255; buf[i * 4 + 2] = c[2] * 255; buf[i * 4 + 3] = 255; }
    const keys = Object.keys(trackCache); if (keys.length > 60) keys.forEach((k) => delete trackCache[k]);
    return (trackCache[key] = PNG.dataURL(n, 1, buf));
  }
  function refreshEditor() {
    if (Math.abs(svHue - ed.h) > 0.5) makeSV();
    const a = (ed.h * Math.PI) / 180, rr = WS / 2 - RING / 2 - 0.5, g = sqGeom(), c = targetGet();
    hueMk.style.left = WS / 2 + Math.cos(a) * rr + 'px'; hueMk.style.top = WS / 2 - Math.sin(a) * rr + 'px';
    svMk.style.left = g.off + ed.s * g.side + 'px'; svMk.style.top = g.off + (1 - ed.v) * g.side + 'px';
    svMk.style.backgroundColor = css(c); hueMk.style.backgroundColor = css(C.hsvToRgb(ed.h, 1, 1));
    const q = (x) => Math.round(x * 40);
    const fns = {
      H: ['H' + q(ed.s) + q(ed.v), (t) => C.hsvToRgb(t * 360, Math.max(ed.s, 0.35), Math.max(ed.v, 0.6)), ed.h / 360, Math.round(ed.h)],
      S: ['S' + Math.round(ed.h) + q(ed.v), (t) => C.hsvToRgb(ed.h, t, ed.v), ed.s, Math.round(ed.s * 100)],
      V: ['V' + Math.round(ed.h) + q(ed.s), (t) => C.hsvToRgb(ed.h, ed.s, t), ed.v, Math.round(ed.v * 100)],
      R: ['R' + q(c[1]) + q(c[2]), (t) => [t, c[1], c[2]], c[0], Math.round(c[0] * 255)],
      G: ['G' + q(c[0]) + q(c[2]), (t) => [c[0], t, c[2]], c[1], Math.round(c[1] * 255)],
      B: ['B' + q(c[0]) + q(c[1]), (t) => [c[0], c[1], t], c[2], Math.round(c[2] * 255)],
    };
    CS.forEach((s) => { const f = fns[s.d.k], src = track(f[0], f[1]); if (s.img._src !== src) { s.img.src = src; s.img._src = src; } s.th.style.left = f[2] * 100 + '%'; s.val.textContent = f[3]; });
    refreshChips();
  }

  // ---------- grid ----------
  function gridColor(i, j, n) {
    const u = n > 1 ? j / (n - 1) : 0, v = n > 1 ? i / (n - 1) : 0, g = S.grid.map(C.srgbToOklab);
    const mix = (a, b, t) => a.map((x, k) => x + (b[k] - x) * t);
    return C.oklabToSrgb(mix(mix(g[0], g[1], u), mix(g[2], g[3], u), v));
  }
  function renderGrid() {
    const n = S.gridN, cell = 20, gap = 4, size = n * cell + (n - 1) * gap, rad = cell / 2;
    const buf = new Uint8Array(size * size * 4);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const c = gridColor(i, j, n);
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
        const a = clamp(rad - Math.sqrt((x + 0.5 - rad) * (x + 0.5 - rad) + (y + 0.5 - rad) * (y + 0.5 - rad)) + 0.5, 0, 1);
        if (a <= 0) continue;
        const k = ((i * (cell + gap) + y) * size + j * (cell + gap) + x) * 4;
        buf[k] = c[0] * 255; buf[k + 1] = c[1] * 255; buf[k + 2] = c[2] * 255; buf[k + 3] = a * 255;
      }
    }
    gridImg.src = PNG.dataURL(size, size, buf);
    refreshChips();
  }
  onDrag(gridImg, { start: (e, r) => gridPick(e, r), move: (e, r) => gridPick(e, r), end: () => setPick(S.pick, true) });
  function gridPick(e, r) {
    const n = S.gridN;
    setPick(gridColor(clamp(Math.floor(((e.clientY - r.top) / r.height) * n), 0, n - 1), clamp(Math.floor(((e.clientX - r.left) / r.width) * n), 0, n - 1), n), false);
  }

  // ---------- presets & icons ----------
  function modelIconBuf(m) {
    const st = R.defaultState();
    Object.assign(st, { model: m, rot: R.modelRot[m] || st.rot, compare: false, shadows: true });
    st.matA = Object.assign({}, st.matA, { base: [0.82, 0.8, 0.77], specInt: 0.2, gloss: 0.4 });
    st.ambient = { color: [0.55, 0.55, 0.6], intensity: 0.45, temp: 0.5 };
    return R.render(st, 48, 48, { ss: 2 });
  }
  function presetState(p) {
    const st = R.defaultState();
    Object.assign(st, { light: p.light, ambient: p.ambient, rim: p.rim, matA: Object.assign({}, st.matA, p.mat), compare: false, model: 'sphere' });
    if (p.bounce) st.bounce = p.bounce;
    if (p.light2) st.light2 = p.light2;
    return st;
  }
  function applyPreset(p, e) {
    const matOnly = e.shiftKey, lightOnly = e.altKey;
    if (!matOnly) {
      S.light = Object.assign({}, DEF.light, clone(p.light)); S.ambient = Object.assign({}, DEF.ambient, clone(p.ambient)); S.rim = clone(p.rim);
      S.bounce = clone(p.bounce || DEF.bounce); S.light2 = clone(p.light2 || Object.assign({}, S.light2, { on: false }));
    }
    if (!lightOnly) S['mat' + S.active] = Object.assign({}, DEF.matA, clone(p.mat));
    syncEditor(); refreshAll(); requestRender(); saveSoon();
    toast(p.name + (matOnly ? ' (material)' : lightOnly ? ' (light)' : ''));
  }
  function renderPresets() {
    prGrid.innerHTML = '';
    const all = R.presets.concat(userPresets.map((p, i) => Object.assign({}, p, { idx: i })));
    all.forEach((p) => {
      const d = el('div', 'preset', prGrid), im = el('img', '', d); im.draggable = false;
      const t = p.builtin && L.thumbs && L.thumbs.presets && L.thumbs.presets[p.name];
      if (t) im.src = t; else idle(() => { im.src = PNG.dataURL(48, 48, R.render(presetState(p), 48, 48, { ss: 2 })); });
      el('div', 'pname', d, p.name);
      d.title = p.name;
      d.addEventListener('click', (e) => applyPreset(p, e));
      if (!p.builtin) {
        const x = el('div', 'pdel', d, '×'); x.title = 'Delete preset';
        x.addEventListener('click', (e) => { e.stopPropagation(); userPresets.splice(p.idx, 1); store.set(PKEY, userPresets); renderPresets(); });
      }
    });
  }

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    if (document.activeElement === hexIn) return;
    const k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const modes = { p: 'pick', l: 'light', r: 'rotate' };
    if (modes[k]) { S.mode = modes[k]; refreshAll(); saveSoon(); }
    else if (k === 'v') { const vm = ['off', 'gray', 'notan', 'v3', 'v5']; S.valueMode = vm[(vm.indexOf(S.valueMode) + 1) % vm.length]; refreshAll(); requestRender(); saveSoon(); }
  });

  // ---------- layout ----------
  // fixed top (logo + 3D view + quick sliders), scrolling options below: the form stays visible while you edit
  const topBox = el('div', 'top'), scroller = el('div', 'scroll');
  app.insertBefore(topBox, app.firstChild);
  topBox.appendChild(head); topBox.appendChild(vpWrap);
  Array.prototype.slice.call(app.children).forEach((c) => { if (c !== topBox) scroller.appendChild(c); });
  app.appendChild(scroller);
  function layout() {
    const H = window.innerHeight || document.documentElement.clientHeight || 800;
    app.style.height = H + 'px';
    const w = app.clientWidth || 280;
    // the view takes at most ~48% of the panel height so the options always have room
    const size = Math.round(clamp(Math.min(w - 16, (H - 34 - 48) * 0.5), 150, 420));
    if (size !== vpSize) { vpSize = size; vp.style.width = size + 'px'; vp.style.height = size + 'px'; requestRender(); }
  }
  wheel.style.width = WS + 'px'; wheel.style.height = WS + 'px';
  window.addEventListener('resize', () => { clearTimeout(layout._t); layout._t = setTimeout(layout, 120); });

  applyBackdrop();
  makeRing();
  syncEditor();
  renderGrid();
  renderHistory();
  renderPresets();
  refreshAll();
  refreshUndo();
  vpSize = 0;
  layout();
})((window.Yekta = window.Yekta || {}));
