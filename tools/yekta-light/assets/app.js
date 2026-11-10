// Yekta Light (online). WebGL viewport on the left, tools on the right.
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { TransformControls } from './vendor/TransformControls.js';
import { MeshoptDecoder } from './vendor/meshopt_decoder.module.js';
import * as LM from './light.js';
import { Rig, POSES, LABEL, BONES, FINGERS, limitsOf, clampSem } from './rig.js';
import { makeUniforms, patchMaterial } from './shader.js';

const $ = (id) => document.getElementById(id);
const h = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const BASE = '/tools/yekta-light/assets/';
const MODELS = {
  woman: { file: 'models/woman.glb', label: 'Woman', fused: ['middle_r', 'ring_r', 'pinky_r'] },
  man: { file: 'models/man.glb', label: 'Man', fused: [] },
};

// ---------------- state, undo, persistence ----------------
const KEY = 'yekta-light-3';
let S = LM.defaultState();
try { const saved = JSON.parse(localStorage.getItem(KEY) || 'null'); if (saved && saved.v === 3) S = Object.assign(S, saved.s); } catch (e) { /* storage unavailable */ }
const undo = [], redo = [];
let lastSnap = JSON.stringify(S);
function commit() {
  const now = JSON.stringify(S);
  if (now === lastSnap) return;
  undo.push(lastSnap); if (undo.length > 100) undo.shift(); redo.length = 0; lastSnap = now;
  try { localStorage.setItem(KEY, JSON.stringify({ v: 3, s: S })); } catch (e) { /* ignore */ }
}
function restore(snap) { S = JSON.parse(snap); lastSnap = snap; applyAll(); refreshUI(); }
function doUndo() { if (!undo.length) return; redo.push(JSON.stringify(S)); restore(undo.pop()); }
function doRedo() { if (!redo.length) return; undo.push(JSON.stringify(S)); restore(redo.pop()); }

// ---------------- three.js ----------------
const stage = $('stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
} catch (e) { $('nogl').style.display = 'flex'; $('loading').classList.add('done'); throw e; }
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
stage.prepend(renderer.domElement);
renderer.domElement.tabIndex = 0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.12; controls.minDistance = 0.25; controls.maxDistance = 12;
controls.target.set(0, 0.95, 0);

const key = new THREE.DirectionalLight(0xffffff, 1);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -1.4, right: 1.4, top: 1.4, bottom: -1.4, near: 0.1, far: 12 });
key.shadow.bias = -0.0004; key.shadow.normalBias = 0.012;
scene.add(key, key.target);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.5 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
scene.add(floor);

const U = makeUniforms();
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = {};
let cur = null; // { root, rig, mesh, height, restMin, texAvg }

function texAverage(tex) {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d'); g.drawImage(tex.image, 0, 0, 32, 32);
    c.width = c.height = 128; g.drawImage(tex.image, 0, 0, 128, 128);
    // average of skin-like texels (warm hue, moderate saturation)
    const d = g.getImageData(0, 0, 128, 128).data, s = [0, 0, 0]; let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const [hh, ss, vv] = LM.rgbToHsv(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
      if (!((hh < 45 || hh > 345) && ss > 0.18 && ss < 0.75 && vv > 0.25)) continue;
      s[0] += LM.toLin(d[i] / 255); s[1] += LM.toLin(d[i + 1] / 255); s[2] += LM.toLin(d[i + 2] / 255); n++;
    }
    return s.map((v) => v / Math.max(1, n));
  } catch (e) { return [0.5, 0.3, 0.22]; }
}
const FEET = ['LeftFoot', 'LeftToeBase', 'RightFoot', 'RightToeBase'];
const lowest = (rig) => Math.min(...FEET.map((n) => rig.bones[n]).filter(Boolean).map((b) => b.getWorldPosition(new THREE.Vector3()).y));

async function loadModel(name) {
  if (cache[name]) return cache[name];
  const def = MODELS[name];
  const gltf = await new Promise((res, rej) => loader.load(BASE + def.file, res, (e) => { if (e.total) $('lbar').style.width = Math.round((e.loaded / e.total) * 100) + '%'; }, rej));
  const root = gltf.scene;
  let mesh = null, texAvg = [0.5, 0.4, 0.35];
  root.traverse((o) => {
    if (!o.isMesh) return;
    mesh = o; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    const src = o.material;
    if (src.map) texAvg = texAverage(src.map);
    const m = new THREE.MeshStandardMaterial({ map: src.map, normalMap: src.normalMap, roughnessMap: src.roughnessMap || src.metalnessMap, side: THREE.FrontSide });
    if (src.normalScale) m.normalScale.copy(src.normalScale);
    o.material = patchMaterial(m, U);
  });
  const rig = new Rig(root, { fused: def.fused });
  const restMin = lowest(rig);
  const box = new THREE.Box3().setFromObject(root);
  cache[name] = { root, rig, mesh, restMin, height: box.max.y - box.min.y, texAvg };
  return cache[name];
}
async function showModel(name) {
  $('loading').classList.remove('done'); $('lbar').style.width = '0';
  const M = await loadModel(name);
  if (cur) scene.remove(cur.root);
  cur = M; scene.add(M.root);
  buildHandles();
  applyPose();
  $('loading').classList.add('done');
  dirty();
}

// ---------------- apply state ----------------
const lin = (c) => new THREE.Color(...LM.lin3(c));
function applyLight() {
  const P = LM.prepare(S), m = P.A;
  U.uL.value.set(...P.L); U.uL2.value.set(...P.L2);
  U.uLc.value.setRGB(...P.lc); U.uLc2.value.setRGB(...(P.l2 ? P.lc2 : [0, 0, 0]));
  U.uWrap.value = P.wrap; U.uBands.value = P.bands; U.uSoft.value = P.soft;
  U.uAmb.value.setRGB(...P.amb); U.uAmbInt.value = P.ambInt; U.uBnc.value.setRGB(...P.bnc); U.uBncInt.value = P.bncInt;
  U.uRimC.value.setRGB(...P.rimC); U.uRimInt.value = P.rimInt; U.uRimExp.value = P.rimExp;
  U.uTint.value.setRGB(...P.tint); U.uTintAmt.value = P.tintAmt;
  U.uEnvCustom.value = P.envC ? 1 : 0; if (P.envC) U.uEnvC.value.setRGB(...P.envC);
  U.uBase.value.setRGB(...m.base); U.uSpec.value.setRGB(...LM.lin3(S.mat.spec || [1, 1, 1]));
  U.uSpecInt.value = m.specInt; U.uExp.value = m.exp; U.uNorm.value = m.norm; U.uMetal.value = LM.clamp01(S.mat.metal);
  U.uEnvK.value = m.env; U.uSss.value = m.sss; U.uSssC.value.setRGB(...m.sssC);
  U.uTexMode.value = S.surface === 'texture' ? 1 : 0;
  if (cur) { const t = cur.texAvg, ts = t[0] + t[1] + t[2]; U.uSkinC.value.set(t[0] / ts, t[1] / ts, t[2] / ts); }
  if (cur) U.uTexTint.value.setRGB(...m.base.map((b, i) => Math.min(4, b / Math.max(0.02, cur.texAvg[i]))));
  U.uVMode.value = { off: 0, gray: 1, notan: 2, v3: 3, v5: 4 }[S.valueMode] || 0;
  U.uNotan.value = S.notan; U.uIso.value = S.iso ? S.isoLuma : -1;
  U.uShadowOn.value = S.shadows ? 1 : 0;
  key.castShadow = !!S.shadows; floor.visible = !!S.floor && !!S.shadows;
  key.shadow.radius = 1 + S.shadowSoft * 7;
  floor.material.opacity = 0.25 + 0.4 * (1 - S.ambient.intensity * 0.6);
  const bg = { dark: [0.06, 0.06, 0.065], mid: [0.36, 0.36, 0.36], light: [0.8, 0.79, 0.77], custom: S.backdropColor }[S.backdrop] || [0.06, 0.06, 0.065];
  scene.background = new THREE.Color().setRGB(...bg, THREE.SRGBColorSpace);
  dirty();
}
function applyPose() {
  if (!cur) return;
  cur.root.position.y = 0;
  cur.rig.apply(S.pose);
  cur.root.position.y = cur.restMin - lowest(cur.rig);
  cur.root.updateMatrixWorld(true);
  placeHandles();
  dirty();
}
function applyLens() {
  camera.fov = 2 * Math.atan(12 / S.lens) * 180 / Math.PI;
  camera.updateProjectionMatrix(); dirty();
}
function applyAll() { applyLight(); applyLens(); if (cur && cur !== cache[S.model]) showModel(S.model); else applyPose(); }

// camera views
const VIEWS = { Front: [0, 0.03], '3/4': [0.62, 0.06], Profile: [1.5708, 0.02], Back: [Math.PI, 0.05], High: [0.45, 0.55], Low: [0.35, -0.3], Face: [0.5, 0.05, 'face'] };
function setView(name, inst) {
  const [yaw, pitch, mode] = VIEWS[name];
  const H = cur ? cur.height : 1.75;
  let tgt = new THREE.Vector3(0, H * 0.53, 0), dist = (H * 0.62) / Math.tan((camera.fov * Math.PI) / 360);
  if (mode === 'face' && cur) { tgt = cur.rig.pos('head').add(new THREE.Vector3(0, 0.07, 0)); dist = 0.34 / Math.tan((camera.fov * Math.PI) / 360); }
  const to = tgt.clone().add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist));
  if (inst) { controls.target.copy(tgt); camera.position.copy(to); controls.update(); dirty(); return; }
  const t0 = controls.target.clone(), p0 = camera.position.clone(), st = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - st) / 450), e = 1 - Math.pow(1 - k, 3);
    controls.target.lerpVectors(t0, tgt, e); camera.position.lerpVectors(p0, to, e); controls.update(); dirty();
    if (k < 1) requestAnimationFrame(step);
  };
  step();
}

// ---------------- joint handles + gizmo ----------------
const handles = new THREE.Group(); scene.add(handles);
const hGeo = new THREE.SphereGeometry(1, 16, 12);
const hMat = new THREE.MeshBasicMaterial({ color: 0xebe8e2, depthTest: false, transparent: true, opacity: 0.9 });
const hMatOn = new THREE.MeshBasicMaterial({ color: 0xf3b44a, depthTest: false });
let selJoint = 'head', poseTab = false;
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setMode('rotate'); gizmo.setSpace('world'); gizmo.setSize(0.7);
scene.add(gizmo);
gizmo.addEventListener('dragging-changed', (e) => { controls.enabled = !e.value; if (!e.value) { commit(); refreshUI(); } });
gizmo.addEventListener('objectChange', () => {
  if (!cur || !gizmo.object) return;
  const sem = selJoint;
  S.pose.j[sem] = clampSem(sem, cur.rig.readSem(sem));
  if (S.symmetric && /_[lr]$/.test(sem)) S.pose.j[mirrorName(sem)] = S.pose.j[sem].slice();
  applyPose(); refreshPose();
});
gizmo.addEventListener('change', () => dirty());
function buildHandles() {
  handles.clear();
  if (!cur) return;
  for (const sem of cur.rig.joints) {
    const m = new THREE.Mesh(hGeo, hMat); m.userData.sem = sem; m.renderOrder = 998;
    const s = /head|hips|chest|spine|neck/.test(sem) ? 0.022 : 0.017; m.scale.setScalar(s);
    handles.add(m);
  }
}
function placeHandles() {
  if (!cur) return;
  handles.children.forEach((m) => { m.position.copy(cur.rig.pos(m.userData.sem)); m.material = m.userData.sem === selJoint ? hMatOn : hMat; });
  handles.visible = poseTab;
  if (poseTab && S.gizmo !== false && cur.rig.B(selJoint)) gizmo.attach(cur.rig.B(selJoint)); else gizmo.detach();
  // keep the gizmo from changing the bone outside our limits: it is re-applied from state on every change
}
const mirrorName = (sem) => sem.replace(/_l$/, '_R').replace(/_r$/, '_l').replace(/_R$/, '_r');

// ---------------- render loop + picking ----------------
let needs = true, pendingPick = null, hoverAt = null;
const dirty = () => { needs = true; };
controls.addEventListener('change', dirty);
function resize() {
  const r = stage.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); dirty();
}
new ResizeObserver(resize).observe(stage);
const tmpV = new THREE.Vector3();
function updateLightRig() {
  // the light is set relative to the view (like a painter lighting from where they stand)
  const dw = tmpV.set(...LM.norm3(S.light.dir)).applyQuaternion(camera.quaternion);
  key.target.position.copy(controls.target);
  key.position.copy(controls.target).addScaledVector(dw, 5);
  key.target.updateMatrixWorld();
  U.uUp.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
}
const px = new Uint8Array(4);
function readAt(x, y) {
  const c = renderer.domElement, pr = renderer.getPixelRatio();
  const gx = Math.round(x * pr), gy = Math.round(c.height - y * pr - 1);
  const gl = renderer.getContext(); gl.readPixels(gx, gy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return [px[0] / 255, px[1] / 255, px[2] / 255];
}
function frame() {
  requestAnimationFrame(frame);
  if (controls.update()) needs = true;
  if (!needs && !pendingPick && !hoverAt) return;
  updateLightRig();
  if (pendingPick || hoverAt) {
    // read colors without helpers (handles / gizmo) in the image
    const hv = handles.visible, gv = gizmo.visible; handles.visible = false; gizmo.visible = false;
    renderer.render(scene, camera);
    if (hoverAt) { const c = readAt(hoverAt.x, hoverAt.y); showLoupe(hoverAt, c); hoverAt = null; }
    if (pendingPick) { const c = readAt(pendingPick.x, pendingPick.y); const p = pendingPick; pendingPick = null; onPicked(c, p); }
    handles.visible = hv; gizmo.visible = gv;
  }
  renderer.render(scene, camera);
  needs = false;
}

// pointer: click = pick (or select a joint in Pose), drag = orbit
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null;
const loupe = $('loupe');
function showLoupe(p, c) {
  loupe.style.display = 'block'; loupe.style.left = p.x + 'px'; loupe.style.top = p.y + 'px'; loupe.style.background = LM.hex(c);
}
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.offsetX, y: e.offsetY, t: performance.now(), b: e.button }; });
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.buttons || gizmo.dragging) { loupe.style.display = 'none'; return; }
  if (e.pointerType === 'mouse') hoverAt = { x: e.offsetX, y: e.offsetY };
});
renderer.domElement.addEventListener('pointerleave', () => { loupe.style.display = 'none'; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || down.b !== 0) return;
  const moved = Math.hypot(e.offsetX - down.x, e.offsetY - down.y); down = null;
  if (moved > 4 || gizmo.dragging || gizmo.axis) return;
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set((e.offsetX / r.width) * 2 - 1, -(e.offsetY / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (poseTab && handles.children.length) {
    const hit = ray.intersectObjects(handles.children)[0];
    if (hit) { selectJoint(hit.object.userData.sem); return; }
  }
  pendingPick = { x: e.offsetX, y: e.offsetY, hit: cur ? ray.intersectObject(cur.mesh)[0] : null };
  dirty();
});

function onPicked(c, p) {
  if (!p.hit) { toast('Click on the figure to pick a color'); return; }
  setPick(c, true);
}
function setPick(c, addHist) {
  S.pick = c.map((v) => Math.round(v * 255) / 255);
  if (addHist) { const hx = LM.hex(S.pick); S.history = [hx].concat((S.history || []).filter((x) => x !== hx)).slice(0, 18); }
  if (S.iso) { S.isoLuma = LM.enc(LM.luma(S.pick)); applyLight(); }
  refreshPick(); commit();
}

// ---------------- UI primitives ----------------
const refreshers = [];
const onRefresh = (f) => { refreshers.push(f); f(); };
function refreshUI() { refreshers.forEach((f) => f()); }
function slider(parent, label, get, set, min, max, opt = {}) {
  const row = h('div', 'row'), lb = h('label', null, label), sl = h('div', 'sl'), tr = h('div', 'tr'), fi = h('div', 'fi'), kn = h('div', 'kn'), val = h('input', 'val');
  val.setAttribute('aria-label', label); sl.setAttribute('role', 'slider'); sl.setAttribute('aria-label', label); sl.tabIndex = 0;
  sl.append(tr, fi, kn); row.append(lb, sl, val); parent.append(row);
  const step = opt.step || (max - min > 20 ? 1 : 0.01), fmt = opt.fmt || ((v) => (step >= 1 ? Math.round(v) : v.toFixed(2)));
  const rng = () => { if (opt.range) [min, max] = opt.range(); };
  const draw = () => {
    rng();
    const zero = opt.zero != null ? opt.zero : Math.max(min, Math.min(max, 0));
    const v = get(), k = (v - min) / (max - min), z = (zero - min) / (max - min);
    kn.style.left = k * 100 + '%'; fi.style.left = Math.min(k, z) * 100 + '%'; fi.style.width = Math.abs(k - z) * 100 + '%';
    if (document.activeElement !== val) val.value = fmt(v);
    sl.setAttribute('aria-valuenow', v);
  };
  const put = (v) => { rng(); v = Math.max(min, Math.min(max, Math.round(v / step) * step)); set(v); draw(); };
  const fromX = (x) => { rng(); const r = sl.getBoundingClientRect(); return min + ((x - r.left) / r.width) * (max - min); };
  sl.addEventListener('pointerdown', (e) => {
    sl.setPointerCapture(e.pointerId);
    const fine = e.shiftKey; const x0 = e.clientX, v0 = get();
    put(fine ? v0 : fromX(e.clientX));
    const mv = (ev) => put(fine ? v0 + ((ev.clientX - x0) / sl.getBoundingClientRect().width) * (max - min) * 0.2 : fromX(ev.clientX));
    const up = () => { sl.removeEventListener('pointermove', mv); sl.removeEventListener('pointerup', up); commit(); };
    sl.addEventListener('pointermove', mv); sl.addEventListener('pointerup', up);
  });
  sl.addEventListener('dblclick', () => { if (opt.def != null) { put(opt.def); commit(); } });
  sl.addEventListener('keydown', (e) => { const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0; if (d) { e.preventDefault(); put(get() + d * step * (e.shiftKey ? 10 : 1)); commit(); } });
  val.addEventListener('change', () => { const v = parseFloat(val.value); if (!isNaN(v)) put(v); commit(); });
  onRefresh(draw);
  return { row, draw };
}
function colorIn(parent, label, get, set, extra) {
  const row = h('div', 'row'), lb = h('label', null, label), inp = h('input'); inp.type = 'color'; inp.setAttribute('aria-label', label);
  row.append(lb, inp); if (extra) extra(row); parent.append(row);
  inp.addEventListener('input', () => set(LM.fromHex(inp.value)));
  inp.addEventListener('change', commit);
  onRefresh(() => { inp.value = LM.hex(get()); });
  return row;
}
function toggle(parent, label, get, set) {
  const row = h('div', 'row'), lb = h('label', null, label), t = h('button', 'toggle'); t.setAttribute('role', 'switch'); t.setAttribute('aria-label', label);
  row.append(lb, t); parent.append(row);
  t.addEventListener('click', () => { set(!get()); commit(); refreshUI(); });
  onRefresh(() => { t.classList.toggle('on', !!get()); t.setAttribute('aria-checked', !!get()); });
  return row;
}
function chips(parent, items, isOn, click, cls = 'chip') {
  const w = h('div', 'chips'); parent.append(w);
  const bs = items.map((it) => { const b = h('button', cls, it.label || it); if (it.title) b.title = it.title; b.addEventListener('click', () => { click(it.value != null ? it.value : it); refreshUI(); }); w.append(b); return [b, it.value != null ? it.value : it]; });
  if (isOn) onRefresh(() => bs.forEach(([b, v]) => b.classList.toggle('on', isOn(v))));
  return w;
}
function seg(parent, items, isOn, click, cls) { const w = chips(parent, items, isOn, click, ''); w.className = 'seg' + (cls ? ' ' + cls : ''); return w; }
const H3 = (parent, txt, right) => { const e = h('h3', null, txt); if (right) { const r = h('span', 'r'); r.append(right); e.append(r); } parent.append(e); return e; };
let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 1600); }
async function copyHex(hx) { try { await navigator.clipboard.writeText(hx.toUpperCase()); toast('Copied ' + hx.toUpperCase()); } catch (e) { toast(hx.toUpperCase()); } }

// ---------------- picked color + palettes ----------------
const pb = $('pickbox');
const pk = h('div', 'pick'), sw = h('div', 'sw'), info = h('div', 'info'), hx = h('div', 'hx'), sub = h('div', 'sub'), cp = h('button', 'btn amber', 'Copy');
info.append(hx, sub); pk.append(sw, info, cp); pb.append(pk);
cp.addEventListener('click', () => copyHex(LM.hex(S.pick)));
sw.title = 'Picked color'; hx.title = 'Click to copy'; hx.style.cursor = 'pointer'; hx.addEventListener('click', () => copyHex(LM.hex(S.pick)));
const fam = h('div', 'fam'), famL = h('div', 'famlbl'), rampEl = h('div', 'ramp'), hist = h('div', 'hist');
famL.append(h('span', null, 'Light families'), h('span', null, 'click to pick · values ↓'));
pb.append(fam, famL, rampEl, hist);
function refreshPick() {
  const c = S.pick, hsv = LM.rgbToHsv(...c);
  sw.style.background = LM.hex(c); hx.textContent = LM.hex(c).toUpperCase();
  sub.textContent = `H ${Math.round(hsv[0])}°  S ${Math.round(hsv[1] * 100)}  V ${Math.round(hsv[2] * 100)}  ·  L ${Math.round(LM.enc(LM.luma(c)) * 100)}`;
  hist.replaceChildren(...(S.history || []).map((x) => { const b = h('button'); b.style.background = x; b.title = x.toUpperCase(); b.addEventListener('click', () => { setPick(LM.fromHex(x), false); copyHex(x); }); return b; }));
}
function refreshFamilies() {
  const F = LM.families(S);
  fam.replaceChildren(...F.map((f) => { const c = LM.finish(f.color.map(LM.toLin), S), b = h('button'); b.style.background = LM.hex(c); b.title = `${f.label}  ${LM.hex(c).toUpperCase()}`; b.setAttribute('aria-label', f.label); b.addEventListener('click', () => { setPick(c, true); copyHex(LM.hex(c)); }); return b; }));
  fam.style.gridTemplateColumns = `repeat(${F.length},1fr)`;
  rampEl.replaceChildren(...LM.ramp(S, 13).map((col) => { const c = LM.finish(col.map(LM.toLin), S), b = h('button'); b.style.background = LM.hex(c); b.title = LM.hex(c).toUpperCase(); b.addEventListener('click', () => { setPick(c, true); copyHex(LM.hex(c)); }); return b; }));
}
onRefresh(refreshPick); onRefresh(refreshFamilies);

// ---------------- tabs ----------------
const TABS = ['Light', 'Surface', 'Pose', 'View'];
const panes = {};
const tabs = $('tabs'), scroll = $('scroll');
let tab = 'Light';
TABS.forEach((t) => {
  const b = h('button', null, t); b.addEventListener('click', () => setTab(t)); tabs.append(b);
  panes[t] = h('div', 'pane'); scroll.append(panes[t]);
});
function setTab(t) {
  tab = t; [...tabs.children].forEach((b) => b.classList.toggle('on', b.textContent === t));
  Object.entries(panes).forEach(([k, p]) => p.classList.toggle('on', k === t));
  poseTab = t === 'Pose'; placeHandles(); dirty();
  $('status').textContent = poseTab ? 'Click a joint dot (or the body map) · drag the rings to rotate · click the figure to pick' : 'Click the figure to pick a color · drag to orbit · right-drag to pan · scroll to zoom';
}
const upd = (f) => (v) => { f(v); applyLight(); refreshFamilies(); };

// ---------------- Light pane ----------------
{
  const P = panes.Light;
  let which = 'key';
  H3(P, 'Key light');
  seg(P, [{ label: 'Key light', value: 'key' }, { label: 'Second light', value: 'l2' }], (v) => v === which, (v) => { which = v; if (v === 'l2' && !S.light2.on) { S.light2.on = true; applyLight(); commit(); } drawBall(); });
  const lw = h('div', 'lightwrap'); lw.style.marginTop = '10px'; P.append(lw);
  const ball = h('canvas', 'ball'); ball.width = ball.height = 300; ball.setAttribute('aria-label', 'Light direction: drag the dot'); lw.append(ball);
  const side = h('div', 'side'); lw.append(side);
  side.append(h('div', 'note', 'Drag on the ball to aim the light. The outer ring puts the light behind the figure (rim / back light).'));
  const g = ball.getContext('2d');
  function drawBall() {
    const n = ball.width, R = n / 2, img = g.createImageData(n, n), out = [0, 0, 0], P2 = LM.prepare(S), sc = 1 / (R / LM.EMAX * 0.98);
    for (let y = 0; y < n; y += 2) for (let x = 0; x < n; x += 2) {
      const vx = (x + 1 - R) * sc, vy = -(y + 1 - R) * sc, r2 = vx * vx + vy * vy;
      let c;
      if (r2 <= 0.81) { const nx = vx / 0.9, ny = vy / 0.9, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny)); LM.shade(nx, ny, nz, P2, P2.A, 1, 1, out); c = LM.finish(out, S).map((v) => v * 255); }
      else if (r2 <= LM.EMAX * LM.EMAX) c = [30, 30, 33]; else continue;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) { const o = ((y + j) * n + x + i) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255; }
    }
    g.putImageData(img, 0, 0);
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = 2; g.beginPath(); g.arc(R, R, 0.9 / sc, 0, 7); g.stroke();
    const dot = (d, col, rr) => { const [hx2, hy2] = LM.handleFromLight(d); g.beginPath(); g.arc(R + hx2 / sc, R - hy2 / sc, rr, 0, 7); g.fillStyle = col; g.fill(); g.strokeStyle = '#111'; g.lineWidth = 3; g.stroke(); };
    if (S.light2.on) dot(S.light2.dir, which === 'l2' ? '#f3b44a' : '#8fb4ff', which === 'l2' ? 13 : 9);
    dot(S.light.dir, which === 'key' ? '#f3b44a' : '#fff', which === 'key' ? 13 : 9);
  }
  ball.addEventListener('pointerdown', (e) => {
    ball.setPointerCapture(e.pointerId);
    const mv = (ev) => {
      const r = ball.getBoundingClientRect(), R = r.width / 2, sc = LM.EMAX / (R * 0.98);
      const d = LM.lightFromHandle((ev.clientX - r.left - R) * sc, -(ev.clientY - r.top - R) * sc);
      (which === 'key' ? S.light : S.light2).dir = d; applyLight(); refreshFamilies(); drawBall();
    };
    mv(e);
    const up = () => { ball.removeEventListener('pointermove', mv); ball.removeEventListener('pointerup', up); commit(); };
    ball.addEventListener('pointermove', mv); ball.addEventListener('pointerup', up);
  });
  onRefresh(drawBall);
  const setups = h('div'); setups.style.marginTop = '10px'; P.append(setups);
  chips(setups, Object.keys(LM.setups).map((k) => ({ label: k, value: k, title: k + ' lighting' })), null, (k) => {
    const s = LM.setups[k]; S.light.dir = LM.norm3(s.key);
    if (s.l2) Object.assign(S.light2, { on: true, dir: LM.norm3(s.l2.dir), intensity: s.l2.intensity });
    applyLight(); commit(); refreshUI();
  });
  slider(P, 'Intensity', () => S.light.intensity, upd((v) => { S.light.intensity = v; }), 0, 2.5, { def: 1.2 });
  slider(P, 'Kelvin', () => S.light.kelvin || 5600, (v) => { S.light.kelvin = v; S.light.color = LM.kelvin(v); applyLight(); refreshUI(); }, 1800, 12000, { step: 100, def: 5600 });
  colorIn(P, 'Color', () => S.light.color, upd((c) => { S.light.color = c; }));
  slider(P, 'Wrap', () => S.light.wrap, upd((v) => { S.light.wrap = v; }), 0, 1, { def: 0.2 });
  slider(P, 'Cel bands', () => S.light.bands, upd((v) => { S.light.bands = v; }), 0, 6, { step: 1, fmt: (v) => (v < 2 ? 'off' : String(v)) });
  slider(P, 'Band edge', () => S.light.soft, upd((v) => { S.light.soft = v; }), 0, 1, { def: 0.2 });
  toggle(P, 'Cast shadows', () => S.shadows, (v) => { S.shadows = v; applyLight(); });
  slider(P, 'Shadow soft', () => S.shadowSoft, (v) => { S.shadowSoft = v; applyLight(); }, 0, 1, { def: 0.35 });

  H3(P, 'Second light');
  toggle(P, 'On', () => S.light2.on, (v) => { S.light2.on = v; applyLight(); refreshFamilies(); drawBall(); });
  slider(P, 'Intensity', () => S.light2.intensity, upd((v) => { S.light2.intensity = v; }), 0, 2, { def: 0.35 });
  slider(P, 'Kelvin', () => S.light2.kelvin || 9000, (v) => { S.light2.kelvin = v; S.light2.color = LM.kelvin(v); applyLight(); refreshUI(); }, 1800, 12000, { step: 100, def: 9000 });
  colorIn(P, 'Color', () => S.light2.color, upd((c) => { S.light2.color = c; }));

  H3(P, 'Environment');
  colorIn(P, 'Sky', () => S.ambient.color, upd((c) => { S.ambient.color = c; }));
  slider(P, 'Sky amount', () => S.ambient.intensity, upd((v) => { S.ambient.intensity = v; }), 0, 1.5, { def: 0.35 });
  colorIn(P, 'Bounce', () => S.bounce.color, upd((c) => { S.bounce.color = c; }));
  slider(P, 'Bounce amt', () => S.bounce.intensity, upd((v) => { S.bounce.intensity = v; }), 0, 1.5, { def: 0.25 });
  colorIn(P, 'Shadow tint', () => S.shadowTint.color, upd((c) => { S.shadowTint.color = c; }));
  slider(P, 'Tint amount', () => S.shadowTint.amount, upd((v) => { S.shadowTint.amount = v; }), 0, 1, { def: 0 });

  H3(P, 'Rim light');
  colorIn(P, 'Color', () => S.rim.color, upd((c) => { S.rim.color = c; }));
  slider(P, 'Intensity', () => S.rim.intensity, upd((v) => { S.rim.intensity = v; }), 0, 2, { def: 0 });
  slider(P, 'Width', () => S.rim.width, upd((v) => { S.rim.width = v; }), 0, 1, { def: 0.35 });
}

// ---------------- Surface pane ----------------
{
  const P = panes.Surface;
  H3(P, 'Presets', 'light + material');
  chips(P, LM.presets.map((p) => p.name), null, (name) => {
    const p = LM.presets.find((x) => x.name === name);
    Object.assign(S.light, clone(p.light)); S.ambient = clone(p.ambient); S.rim = clone(p.rim); S.mat = clone(p.mat);
    if (p.bounce) S.bounce = clone(p.bounce);
    S.surface = p.mat.metal > 0.5 || /plastic|Plaster|clay|Anime/i.test(name) ? 'color' : S.surface;
    applyLight(); commit(); refreshUI();
  });
  H3(P, 'Surface');
  seg(P, [{ label: 'Skin texture', value: 'texture', title: 'Scanned skin detail, tinted by the base color' }, { label: 'Flat color', value: 'color', title: 'One clean color: best for value studies' }], (v) => S.surface === v, (v) => { S.surface = v; applyLight(); commit(); });
  colorIn(P, 'Base color', () => S.mat.base, upd((c) => { S.mat.base = c; }), (row) => {
    const b = h('button', 'btn', 'From texture'); b.title = 'Use the scan\'s own skin color'; row.append(b);
    b.addEventListener('click', () => { if (!cur) return; S.mat.base = cur.texAvg.map((v) => Math.round(LM.toSrgb(v) * 255) / 255); applyLight(); commit(); refreshUI(); });
  });
  slider(P, 'Specular', () => S.mat.specInt, upd((v) => { S.mat.specInt = v; }), 0, 1.5, { def: 0.35 });
  slider(P, 'Gloss', () => S.mat.gloss, upd((v) => { S.mat.gloss = v; }), 0, 1, { def: 0.45 });
  slider(P, 'Metal', () => S.mat.metal, upd((v) => { S.mat.metal = v; }), 0, 1, { def: 0 });
  slider(P, 'Subsurface', () => S.mat.sss, upd((v) => { S.mat.sss = v; }), 0, 1, { def: 0 });
  colorIn(P, 'SSS color', () => S.mat.sssColor, upd((c) => { S.mat.sssColor = c; }));
  colorIn(P, 'Spec color', () => S.mat.spec || [1, 1, 1], upd((c) => { S.mat.spec = c; }));
  toggle(P, 'Custom reflect', () => S.envCustom, (v) => { S.envCustom = v; applyLight(); refreshFamilies(); });
  colorIn(P, 'Reflection', () => S.envColor, upd((c) => { S.envColor = c; }));
  P.append(h('div', 'note', 'Subsurface adds the warm red band along the terminator that real skin has. Metal tints the highlight with the base color.'));
}

// ---------------- Pose pane ----------------
let refreshPose = () => {};
function selectJoint(sem) { selJoint = sem; placeHandles(); refreshPose(); dirty(); }
{
  const P = panes.Pose;
  H3(P, 'Pose presets');
  chips(P, Object.keys(POSES), null, (name) => { S.pose = clone(POSES[name]); applyPose(); commit(); refreshUI(); });

  H3(P, 'Joints', (() => { const s = h('span'); s.append('click a dot'); return s; })());
  const body = h('div', 'body'); P.append(body);
  // front view of the figure: the character's left side is on the viewer's right
  const POS = { head: [50, 11], neck: [50, 21], chest: [50, 31], spine: [50, 41], hips: [50, 51], shoulder_l: [57, 24], arm_l: [64, 26], elbow_l: [70, 39], wrist_l: [75, 51], shoulder_r: [43, 24], arm_r: [36, 26], elbow_r: [30, 39], wrist_r: [25, 51], thigh_l: [55, 54], knee_l: [56, 72], ankle_l: [57, 89], thigh_r: [45, 54], knee_r: [44, 72], ankle_r: [43, 89] };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 100 100'); svg.setAttribute('preserveAspectRatio', 'none');
  const LINES = [['head', 'neck'], ['neck', 'chest'], ['chest', 'spine'], ['spine', 'hips'], ['neck', 'shoulder_l'], ['shoulder_l', 'arm_l'], ['arm_l', 'elbow_l'], ['elbow_l', 'wrist_l'], ['neck', 'shoulder_r'], ['shoulder_r', 'arm_r'], ['arm_r', 'elbow_r'], ['elbow_r', 'wrist_r'], ['hips', 'thigh_l'], ['thigh_l', 'knee_l'], ['knee_l', 'ankle_l'], ['hips', 'thigh_r'], ['thigh_r', 'knee_r'], ['knee_r', 'ankle_r']];
  LINES.forEach(([a, b]) => { const l = document.createElementNS('http://www.w3.org/2000/svg', 'line'); l.setAttribute('x1', POS[a][0]); l.setAttribute('y1', POS[a][1]); l.setAttribute('x2', POS[b][0]); l.setAttribute('y2', POS[b][1]); l.setAttribute('stroke', '#3a3a40'); l.setAttribute('stroke-width', '0.8'); l.setAttribute('vector-effect', 'non-scaling-stroke'); l.style.strokeWidth = '2px'; svg.append(l); });
  body.append(svg);
  const cap = h('div', 'cap'); body.append(cap);
  body.append(h('div', 'hint', 'Figure faces you: its left side is on your right'));
  const dots = Object.keys(POS).map((sem) => { const d = h('button', 'jd'); d.style.left = POS[sem][0] + '%'; d.style.top = POS[sem][1] + '%'; d.title = LABEL[sem]; d.setAttribute('aria-label', LABEL[sem]); d.addEventListener('click', () => selectJoint(sem)); body.append(d); return [sem, d]; });

  const box = h('div'); P.append(box);
  const sl = ['Bend', 'Turn', 'Tilt'].map((nm, i) => slider(box, nm, () => ((S.pose.j[selJoint] || [0, 0, 0])[i] || 0), (v) => {
    const e = (S.pose.j[selJoint] || [0, 0, 0]).slice(); e[i] = v; S.pose.j[selJoint] = e;
    if (S.symmetric && /_[lr]$/.test(selJoint)) S.pose.j[mirrorName(selJoint)] = e.slice();
    applyPose(); dots.forEach(([s, d]) => d.classList.toggle('set', !!(S.pose.j[s] && S.pose.j[s].some((x) => x))));
  }, -180, 180, { step: 1, fmt: (v) => Math.round(v) + '°', def: 0, range: () => limitsOf(selJoint)[i] }));
  const tools = h('div', 'chips'); tools.style.margin = '10px 0 4px'; box.append(tools);
  const tb = (txt, title, fn) => { const b = h('button', 'chip', txt); b.title = title; b.addEventListener('click', () => { fn(); applyPose(); commit(); refreshUI(); }); tools.append(b); return b; };
  tb('Reset joint', 'Back to the neutral angle', () => { delete S.pose.j[selJoint]; });
  tb('Mirror L → R', 'Copy the left side to the right side', () => mirror('l', 'r'));
  tb('Mirror R → L', 'Copy the right side to the left side', () => mirror('r', 'l'));
  tb('Reset pose', 'Neutral A-pose', () => { S.pose = clone(POSES['A-pose']); });
  toggle(box, 'Symmetric', () => S.symmetric, (v) => { S.symmetric = v; });
  toggle(box, 'Rotate rings', () => S.gizmo !== false, (v) => { S.gizmo = v; placeHandles(); dirty(); });
  function mirror(a, b) {
    for (const k of Object.keys(S.pose.j)) if (k.endsWith('_' + b)) delete S.pose.j[k];
    for (const [k, v] of Object.entries(S.pose.j)) if (k.endsWith('_' + a)) S.pose.j[k.slice(0, -1) + b] = v.slice();
    S.pose.f[b] = clone(S.pose.f[a]);
  }
  refreshPose = () => {
    const lim = limitsOf(selJoint);
    cap.textContent = LABEL[selJoint];
    dots.forEach(([s, d]) => { d.classList.toggle('on', s === selJoint); d.classList.toggle('set', !!(S.pose.j[s] && S.pose.j[s].some((x) => x))); });
    sl.forEach((s, i) => { s.row.title = `${['Bend', 'Turn', 'Tilt'][i]}: ${lim[i][0]}° to ${lim[i][1]}°`; s.draw(); });
  };
  onRefresh(refreshPose);

  H3(P, 'Hands');
  const hand = h('div', 'hand'); P.append(hand);
  for (const [s, nm] of [['r', 'Right hand'], ['l', 'Left hand']]) {
    const col = h('div'); hand.append(col);
    col.append(h('div', 'note', nm));
    const hs = () => S.pose.f[s];
    const mk = (label, k, min, max) => { const r = slider(col, label, () => hs()[k] || 0, (v) => { hs()[k] = v; if (S.symmetric) S.pose.f[s === 'l' ? 'r' : 'l'][k] = v; applyPose(); }, min, max, { step: 1, def: 0 }); r.row.querySelector('label').style.width = '46px'; };
    mk('Curl', 'curl', -20, 100); mk('Spread', 'spread', -15, 30); mk('Thumb', 'thumb', -30, 90);
    for (const f of FINGERS.slice(1)) {
      const r = slider(col, f[0].toUpperCase() + f.slice(1), () => (hs().fc || {})[f] || 0, (v) => { hs().fc = hs().fc || {}; hs().fc[f] = v; if (S.symmetric) { const o = S.pose.f[s === 'l' ? 'r' : 'l']; o.fc = o.fc || {}; o.fc[f] = v; } applyPose(); }, -90, 90, { step: 1, def: 0 });
      r.row.querySelector('label').style.width = '46px';
    }
  }
  P.append(h('div', 'note', 'Finger sliders add to the hand curl. Values are mirrored, so the same numbers on both sides give a symmetric pose. Shift-drag a slider for fine control, double-click to reset.'));
}

// ---------------- View pane ----------------
{
  const P = panes.View;
  H3(P, 'Figure');
  chips(P, Object.entries(MODELS).map(([k, m]) => ({ label: m.label, value: k })), (v) => S.model === v, (v) => { if (S.model === v) return; S.model = v; commit(); showModel(v).then(() => { applyLight(); refreshFamilies(); }); });
  H3(P, 'Camera');
  chips(P, Object.keys(VIEWS), null, (v) => setView(v));
  const lensRow = h('div'); lensRow.style.marginTop = '10px'; P.append(lensRow);
  seg(lensRow, [24, 35, 50, 85, 135].map((mm) => ({ label: mm + 'mm', value: mm })), (v) => S.lens === v, (v) => { S.lens = v; applyLens(); commit(); setView('3/4'); });
  H3(P, 'Value check');
  seg(P, [{ label: 'Color', value: 'off' }, { label: 'Gray', value: 'gray' }, { label: 'Notan', value: 'notan' }, { label: '3 values', value: 'v3' }, { label: '5 values', value: 'v5' }], (v) => S.valueMode === v, (v) => { S.valueMode = v; applyLight(); refreshFamilies(); commit(); });
  slider(P, 'Notan split', () => S.notan, upd((v) => { S.notan = v; }), 0.05, 0.95, { def: 0.5 });
  toggle(P, 'Same value', () => S.iso, (v) => { S.iso = v; S.isoLuma = LM.enc(LM.luma(S.pick)); applyLight(); });
  P.append(h('div', 'note', 'Same value marks every area that has the value of your picked color, so you can see what reads as one shape.'));
  H3(P, 'Backdrop');
  seg(P, [{ label: 'Dark', value: 'dark' }, { label: 'Mid', value: 'mid' }, { label: 'Light', value: 'light' }, { label: 'Custom', value: 'custom' }], (v) => S.backdrop === v, (v) => { S.backdrop = v; applyLight(); commit(); });
  colorIn(P, 'Custom', () => S.backdropColor, (c) => { S.backdropColor = c; S.backdrop = 'custom'; applyLight(); refreshUI(); });
  toggle(P, 'Floor shadow', () => S.floor, (v) => { S.floor = v; applyLight(); });
  H3(P, 'Export');
  const ex = h('div', 'chips'); P.append(ex);
  const png = h('button', 'chip', 'Save image (PNG)'); ex.append(png);
  png.addEventListener('click', () => {
    handles.visible = false; gizmo.visible = false; updateLightRig(); renderer.render(scene, camera);
    renderer.domElement.toBlob((b) => { const a = h('a'); a.href = URL.createObjectURL(b); a.download = 'yekta-light.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); handles.visible = poseTab; gizmo.visible = true; dirty(); });
  });
  const pal = h('button', 'chip', 'Copy palette'); ex.append(pal);
  pal.addEventListener('click', () => { const t = LM.families(S).map((f) => `${f.label}: ${LM.hex(LM.finish(f.color.map(LM.toLin), S)).toUpperCase()}`).join('\n'); navigator.clipboard.writeText(t).then(() => toast('Palette copied'), () => toast('Copy not allowed here')); });
  const rs = h('button', 'chip', 'Reset everything'); ex.append(rs);
  rs.addEventListener('click', () => { const m = S.model; S = LM.defaultState(); S.model = m; applyAll(); commit(); refreshUI(); setView('3/4'); });
  const foot = h('div', 'foot');
  foot.innerHTML = 'Shortcuts: <span class="kbd">Ctrl Z</span> undo · <span class="kbd">Ctrl Shift Z</span> redo · <span class="kbd">V</span> value mode · <span class="kbd">1–4</span> tabs · <span class="kbd">F</span> frame figure<br>Figures: Man and Woman base meshes by Grab3D (CC0). Finger rig by Yekta Light. Free tool by <a href="/">YEKTA</a>.';
  P.append(foot);
}

// ---------------- viewport overlays ----------------
{
  const tl = $('ovtl');
  seg(tl, Object.entries(MODELS).map(([k, m]) => ({ label: m.label, value: k })), (v) => S.model === v, (v) => { if (S.model === v) return; S.model = v; commit(); showModel(v).then(() => { applyLight(); refreshFamilies(); }); });
  seg(tl, [{ label: 'Color', value: 'off' }, { label: 'Gray', value: 'gray' }, { label: 'Notan', value: 'notan' }, { label: '3', value: 'v3' }, { label: '5', value: 'v5' }], (v) => S.valueMode === v, (v) => { S.valueMode = v; applyLight(); refreshFamilies(); commit(); });
  const br = $('ovbr');
  seg(br, ['Front', '3/4', 'Profile', 'Back', 'Face'].map((v) => ({ label: v, value: v })), null, (v) => setView(v));
}

// ---------------- keyboard ----------------
addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); doRedo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (k === 'v') { const m = ['off', 'gray', 'notan', 'v3', 'v5']; S.valueMode = m[(m.indexOf(S.valueMode) + 1) % m.length]; applyLight(); refreshFamilies(); refreshUI(); commit(); }
  else if (k >= '1' && k <= '4') setTab(TABS[+k - 1]);
  else if (k === 'f') setView('3/4');
  else if (k === 'escape' && poseTab) { gizmo.detach(); dirty(); }
});

// ---------------- start ----------------
setTab('Light');
applyLight(); applyLens();
resize();
setView('3/4', true);
frame();
showModel(S.model).then(() => { applyLight(); refreshFamilies(); setView('3/4', true); }).catch((err) => { $('loading').querySelector('span').textContent = 'Could not load the figure'; console.error(err); });
window.YektaLight = { get S() { return S; }, applyAll, refreshUI, setView, setTab, selectJoint, get cur() { return cur; }, camera, controls, render: () => { updateLightRig(); renderer.render(scene, camera); } };
