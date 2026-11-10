// Yekta Light: painter light model (CPU side). The same math runs in the GPU shader (shader.js);
// here it drives the light-families palette, the value ramp and the light-ball preview.
// All directions are in view space: x right, y up, z toward the viewer.

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const len2 = (x, y) => Math.hypot(x, y);

// ---------- color ----------
export const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const toSrgb = (c) => (c <= 0 ? 0 : c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
export const lin3 = (c) => c.map(toLin);
export const hex = (c) => '#' + c.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');
export const fromHex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255); };
export const luma = (c) => 0.2126 * toLin(c[0]) + 0.7152 * toLin(c[1]) + 0.0722 * toLin(c[2]);
export function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; let h = 0;
  if (d > 1e-9) { h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, max <= 0 ? 0 : d / max, max];
}
export function kelvin(K) { // Tanner Helland approximation -> sRGB 0..1
  const t = K / 100; let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = 255; }
  const m = Math.max(r, g, b);
  return [r, g, b].map((v) => clamp01(v / m));
}
const KNEE = 0.82;
export function enc(x) { if (x > KNEE) x = KNEE + (1 - KNEE) * (1 - Math.exp(-(x - KNEE) / (1 - KNEE))); return toSrgb(x); }

// ---------- material + light preparation ----------
export function prepMat(m) {
  const base = lin3(m.base), spec = lin3(m.spec || [1, 1, 1]), metal = clamp01(m.metal || 0);
  const exp = 2 + Math.pow(clamp01(m.gloss), 2.2) * 600;
  return {
    base, alb: base.map((c) => c * (1 - metal)),
    spec: [0, 1, 2].map((i) => spec[i] * (1 - metal) + base[i] * metal),
    specInt: m.specInt * (1 + metal * 0.8), exp, norm: Math.sqrt((exp + 8) / 10),
    env: metal * 1.1 + Math.pow(clamp01(m.gloss), 3) * 0.15 * clamp01(m.specInt),
    sss: clamp01(m.sss || 0) * (1 - metal), sssC: lin3(m.sssColor || [1, 0.32, 0.22]),
  };
}
export function prepare(S) {
  const Ld = norm3(S.light.dir), l2 = S.light2, L2 = norm3(l2.dir);
  const st = S.shadowTint, tl = lin3(st.color), ty = 0.2126 * tl[0] + 0.7152 * tl[1] + 0.0722 * tl[2] || 1e-3;
  return {
    L: Ld, H: norm3([Ld[0], Ld[1], Ld[2] + 1]),
    lc: lin3(S.light.color).map((c) => c * S.light.intensity),
    l2: !!l2.on && l2.intensity > 0, L2, H2: norm3([L2[0], L2[1], L2[2] + 1]),
    lc2: lin3(l2.color).map((c) => c * (l2.on ? l2.intensity : 0)),
    amb: lin3(S.ambient.color), ambInt: S.ambient.intensity,
    bnc: lin3(S.bounce.color), bncInt: S.bounce.intensity,
    tint: tl.map((v) => Math.min(3, v / ty)), tintAmt: st.amount,
    envC: S.envCustom ? lin3(S.envColor).map((v) => v * 0.9) : null,
    rimC: lin3(S.rim.color), rimInt: S.rim.intensity, rimExp: 0.7 + (1 - S.rim.width) * 6,
    wrap: S.light.wrap, bands: Math.round(S.light.bands), soft: S.light.soft,
    A: prepMat(S.mat),
  };
}
function band(d, k, soft) {
  const x = d * k, i = Math.floor(x), f = x - i, e = soft * 0.5;
  const s = e < 1e-4 ? (f >= 0.5 ? 1 : 0) : smooth(0.5 - e, 0.5 + e, f);
  return Math.min(1, (i + s) / k);
}
// n = view-space normal; sh = shadow (0..1); ao = occlusion
export function shade(n0, n1, n2, P, m, sh, ao, out) {
  const Lv = P.L, ndl = n0 * Lv[0] + n1 * Lv[1] + n2 * Lv[2];
  let d = clamp01((ndl + P.wrap) / (1 + P.wrap));
  const toon = P.bands > 1;
  if (toon) d = band(d, P.bands, P.soft);
  d *= sh;
  const H = P.H, nh = n0 * H[0] + n1 * H[1] + n2 * H[2];
  let s = 0;
  if (nh > 0 && ndl > -0.1) {
    s = Math.pow(nh, m.exp);
    if (toon) { const e = Math.max(0.01, P.soft * 0.25); s = smooth(0.5 - e, 0.5 + e, s) * 1.6; } else s *= m.norm;
    s *= m.specInt * sh * smooth(-0.1, 0.12, ndl);
  }
  let sss = 0;
  if (m.sss > 0) { const x = (ndl + 0.05) / 0.32; sss = Math.exp(-x * x) * m.sss * 0.6 * (0.35 + 0.65 * sh); if (toon) sss *= 0.5; }
  let d2 = 0, s2 = 0;
  if (P.l2) {
    const L2 = P.L2, nd2 = n0 * L2[0] + n1 * L2[1] + n2 * L2[2];
    d2 = clamp01((nd2 + 0.1) / 1.1); if (toon) d2 = band(d2, P.bands, P.soft);
    const H2 = P.H2, nh2 = n0 * H2[0] + n1 * H2[1] + n2 * H2[2];
    if (nh2 > 0 && nd2 > 0) s2 = Math.pow(nh2, m.exp) * (toon ? 0 : m.norm) * m.specInt;
  }
  const sky = (0.55 + 0.45 * n1) * ao * P.ambInt;
  const bb = 0.5 - 0.5 * n1, bounce = bb * bb * ao * P.bncInt;
  const nv = n2 > 0 ? n2 : 0;
  let rim = 0;
  if (P.rimInt > 0) { rim = Math.pow(1 - nv, P.rimExp); if (toon) rim = smooth(0.42 - P.soft * 0.2, 0.48 + P.soft * 0.2, rim); rim *= P.rimInt * ao; }
  let ek = 0;
  if (m.env > 0) { const ry = 2 * nv * n1, fr = 0.35 + 0.65 * Math.pow(1 - nv, 4); ek = m.env * ao * (0.25 + 0.75 * smooth(-0.3, 0.6, ry)) * (m.alb[0] + m.alb[1] + m.alb[2] > 0 ? fr : 1); }
  const tw = P.tintAmt > 0 ? P.tintAmt * (1 - d) : 0;
  for (let c = 0; c < 3; c++) {
    const env = P.envC ? P.envC[c] : P.amb[c] * P.ambInt * 1.4;
    out[c] = m.spec[c] * ek * (env + P.lc[c] * 0.22)
      + m.alb[c] * (P.lc[c] * d + P.lc2[c] * d2) + m.base[c] * m.sssC[c] * P.lc[c] * sss
      + m.base[c] * (P.amb[c] * sky + P.bnc[c] * bounce)
      + m.spec[c] * (P.lc[c] * s + P.lc2[c] * s2) + P.rimC[c] * rim * (0.35 + 0.65 * m.base[c]);
  }
  if (tw > 0) { const Y = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2]; for (let c = 0; c < 3; c++) out[c] = out[c] * (1 - tw) + Y * P.tint[c] * tw; }
}
// display value (sRGB 0..1) honoring value modes
export function finish(lin, S) {
  let c = lin.map(enc);
  const vm = S.valueMode;
  if (vm !== 'off') {
    const Y = enc(0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]);
    let v = Y;
    if (vm === 'notan') v = Y >= S.notan ? 0.92 : 0.1;
    else if (vm === 'v3') v = Y < 0.36 ? 0.1 : Y < 0.68 ? 0.48 : 0.9;
    else if (vm === 'v5') v = 0.08 + Math.min(4, Math.floor(Y * 5)) * 0.215;
    c = [v, v, v];
  }
  return c.map(clamp01);
}

// ---------- palettes ----------
export function families(S) {
  const P = prepare(S), m = P.A, out = [0, 0, 0], Lv = P.L;
  let b = [-Lv[0] * Lv[2], -Lv[1] * Lv[2], 1 - Lv[2] * Lv[2]];
  if (Math.hypot(...b) < 1e-3) b = [0, 1, 0];
  b = norm3(b);
  const arc = (ndl) => { const th = Math.acos(Math.max(-1, Math.min(1, ndl))); return norm3([0, 1, 2].map((i) => Lv[i] * Math.cos(th) + b[i] * Math.sin(th))); };
  const col = (N, sh = 1, ao = 1) => { shade(N[0], N[1], N[2], P, m, sh, ao, out); return out.map((v) => clamp01(enc(v))); };
  const res = [
    { id: 'highlight', label: 'Highlight', color: col(P.H) },
    { id: 'light', label: 'Light', color: col(arc(0.82)) },
    { id: 'half', label: 'Halftone', color: col(arc(0.38)) },
    { id: 'term', label: 'Terminator', color: col(arc(0.02)) },
    { id: 'core', label: 'Core shadow', color: col(arc(-0.32)) },
    { id: 'refl', label: 'Reflected', color: col(norm3([-Lv[0] * 0.5 + b[0] * 0.2, -0.85, -Lv[2] * 0.3 + 0.35])) },
    { id: 'occl', label: 'Occlusion', color: col(arc(-0.5), 1, 0.3) },
    { id: 'cast', label: 'Cast shadow', color: col([0, 1, 0], 0, 0.75) },
  ];
  if (P.rimInt > 0) {
    const sx = -Lv[0], sy = -Lv[1], sl = len2(sx, sy) || 1;
    res.splice(5, 0, { id: 'rim', label: 'Rim', color: col(norm3([(sx / sl) * 0.99, (sy / sl) * 0.99, 0.12])) });
  }
  return res;
}
export function ramp(S, n) {
  const P = prepare(S), out = [0, 0, 0], res = [];
  let ax = P.L[0], ay = P.L[1]; const al = len2(ax, ay);
  if (al < 0.05) { ax = -0.707; ay = 0.707; } else { ax /= al; ay /= al; }
  for (let i = 0; i < n; i++) {
    const t = 0.97 - (1.94 * i) / (n - 1), x = ax * t, y = ay * t, z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    shade(x, y, z, P, P.A, 1, 1, out);
    res.push(out.map((v) => clamp01(enc(v))));
  }
  return res;
}

// ---------- light handle (disc): inside = front hemisphere, outer ring = behind the form ----------
export const RS = 0.9, EMAX = 1.08;
export function lightFromHandle(x, y) {
  const r = len2(x, y);
  if (r <= RS) { const k = r / RS; return norm3([x / RS, y / RS, Math.sqrt(Math.max(0, 1 - k * k))]); }
  const t = Math.min(1, (r - RS) / (EMAX - RS)), th = Math.PI / 2 + t * (Math.PI / 2) * 0.96, s = Math.sin(th);
  return norm3([(x / r) * s, (y / r) * s, Math.cos(th)]);
}
export function handleFromLight(d) {
  d = norm3(d);
  if (d[2] >= 0) return [d[0] * RS, d[1] * RS];
  const th = Math.acos(Math.max(-1, Math.min(1, d[2]))), t = Math.min(1, (th - Math.PI / 2) / ((Math.PI / 2) * 0.96));
  const r = RS + t * (EMAX - RS), l = len2(d[0], d[1]);
  return l < 1e-4 ? [0, r] : [(d[0] / l) * r, (d[1] / l) * r];
}
export const dirAE = (az, el) => [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];

export const setups = {
  Rembrandt: { key: dirAE(-0.85, 0.62) }, Loop: { key: dirAE(-0.55, 0.42) }, Butterfly: { key: dirAE(0, 0.78) },
  Split: { key: dirAE(-1.55, 0.08) }, Rim: { key: dirAE(2.5, 0.35), l2: { dir: dirAE(-0.4, 0.2), intensity: 0.35 } }, Under: { key: dirAE(0.15, -0.75) },
};

// ---------- presets (light + material) ----------
const mat = (base, specInt, gloss, metal = 0, sss = 0) => ({ base, spec: [1, 1, 1], specInt, gloss, metal, sss, sssColor: [1, 0.32, 0.22] });
const Lt = (dir, color, intensity, wrap, bands = 0, soft = 0.2) => ({ dir: norm3(dir), color, intensity, wrap, bands, soft });
const P_ = (name, light, ambient, rim, m, extra) => Object.assign({ name, light, ambient, rim, mat: m }, extra || {});
export const presets = [
  P_('Warm skin', Lt([-0.55, 0.5, 0.67], [1, 0.92, 0.82], 1.2, 0.3), { color: [0.35, 0.42, 0.72], intensity: 0.36 }, { color: [1, 0.55, 0.4], intensity: 0.2, width: 0.3 }, mat([0.93, 0.66, 0.54], 0.25, 0.38, 0, 0.75), { bounce: { color: [0.75, 0.5, 0.38], intensity: 0.3 } }),
  P_('Deep skin', Lt([-0.6, 0.45, 0.66], [1, 0.9, 0.78], 1.3, 0.25), { color: [0.4, 0.42, 0.62], intensity: 0.32 }, { color: [1, 0.75, 0.55], intensity: 0.3, width: 0.3 }, mat([0.45, 0.27, 0.18], 0.45, 0.55, 0, 0.6), { bounce: { color: [0.7, 0.45, 0.3], intensity: 0.3 } }),
  P_('Plaster cast', Lt([-0.7, 0.55, 0.45], [1, 0.97, 0.92], 1.15, 0.15), { color: [0.5, 0.52, 0.58], intensity: 0.3 }, { color: [1, 1, 1], intensity: 0, width: 0.3 }, mat([0.86, 0.84, 0.8], 0.08, 0.2)),
  P_('Matte clay', Lt([-0.6, 0.5, 0.62], [1, 0.97, 0.93], 1.1, 0.25), { color: [0.55, 0.55, 0.6], intensity: 0.45 }, { color: [1, 1, 1], intensity: 0, width: 0.3 }, mat([0.72, 0.65, 0.58], 0.05, 0.1)),
  P_('Anime cel', Lt([-0.55, 0.6, 0.58], [1, 0.97, 0.93], 1.15, 0.1, 2, 0.08), { color: [0.6, 0.42, 0.66], intensity: 0.55 }, { color: [1, 0.9, 0.8], intensity: 0, width: 0.3 }, mat([1, 0.8, 0.72], 0.45, 0.62)),
  P_('Sunset', Lt([-0.85, 0.15, 0.5], [1, 0.58, 0.3], 1.45, 0.25), { color: [0.3, 0.32, 0.72], intensity: 0.5 }, { color: [1, 0.78, 0.5], intensity: 0.45, width: 0.35 }, mat([0.85, 0.8, 0.75], 0.3, 0.45)),
  P_('Overcast', Lt([-0.2, 0.9, 0.35], [0.92, 0.95, 1], 0.7, 0.6), { color: [0.7, 0.74, 0.8], intensity: 0.75 }, { color: [1, 1, 1], intensity: 0, width: 0.3 }, mat([0.8, 0.72, 0.66], 0.15, 0.3)),
  P_('Campfire', Lt([0.3, -0.45, 0.85], [1, 0.5, 0.18], 1.6, 0.2), { color: [0.12, 0.14, 0.3], intensity: 0.35 }, { color: [0.4, 0.55, 1], intensity: 0.35, width: 0.3 }, mat([0.9, 0.7, 0.6], 0.3, 0.45, 0, 0.5)),
  P_('Neon night', Lt([0.5, 0.7, 0.5], [0.5, 0.62, 1], 0.55, 0.1), { color: [0.15, 0.08, 0.3], intensity: 0.45 }, { color: [1, 0.2, 0.8], intensity: 1.25, width: 0.45 }, mat([0.62, 0.62, 0.72], 0.5, 0.6)),
  P_('Bronze statue', Lt([-0.4, 0.6, 0.7], [1, 0.97, 0.9], 1.35, 0), { color: [0.32, 0.26, 0.22], intensity: 0.6 }, { color: [1, 0.9, 0.7], intensity: 0.15, width: 0.25 }, mat([0.8, 0.52, 0.3], 1.0, 0.7, 1)),
  P_('Chrome', Lt([-0.45, 0.6, 0.66], [1, 1, 1], 1.3, 0), { color: [0.4, 0.45, 0.55], intensity: 0.7 }, { color: [0.8, 0.9, 1], intensity: 0.35, width: 0.25 }, mat([0.85, 0.87, 0.9], 1.2, 0.93, 1)),
  P_('Glossy plastic', Lt([-0.5, 0.6, 0.62], [1, 1, 1], 1.2, 0.1), { color: [0.45, 0.5, 0.6], intensity: 0.35 }, { color: [1, 1, 1], intensity: 0, width: 0.3 }, mat([0.18, 0.42, 0.95], 0.85, 0.88)),
];

export function defaultState() {
  return {
    model: 'woman', surface: 'texture',
    light: { dir: norm3([-0.55, 0.5, 0.67]), color: [1, 0.92, 0.82], intensity: 1.2, wrap: 0.3, bands: 0, soft: 0.2, kelvin: 5200 },
    light2: { on: false, dir: norm3([0.75, 0.15, 0.6]), color: [0.75, 0.85, 1], intensity: 0.35, kelvin: 9000 },
    ambient: { color: [0.35, 0.42, 0.72], intensity: 0.36 },
    bounce: { color: [0.75, 0.5, 0.38], intensity: 0.3 },
    rim: { color: [1, 0.55, 0.4], intensity: 0.2, width: 0.3 },
    shadowTint: { color: [0.42, 0.4, 0.9], amount: 0 },
    envCustom: false, envColor: [0.55, 0.62, 0.8],
    mat: { base: [0.9, 0.68, 0.58], spec: [1, 1, 1], specInt: 0.25, gloss: 0.38, metal: 0, sss: 0.75, sssColor: [1, 0.32, 0.22] },
    shadows: true, shadowSoft: 0.35, floor: true,
    backdrop: 'dark', backdropColor: [0.36, 0.34, 0.32],
    valueMode: 'off', notan: 0.5, iso: false, isoLuma: 0.5,
    lens: 50,
    pose: { j: { arm_l: [4, 0, -14], arm_r: [4, 0, -14], elbow_l: [12, 0, 0], elbow_r: [12, 0, 0] }, f: { l: { curl: 25, spread: 15, thumb: 5, fc: {} }, r: { curl: 25, spread: 15, thumb: 5, fc: {} } } },
    pick: [0.93, 0.66, 0.54], history: [],
  };
}
