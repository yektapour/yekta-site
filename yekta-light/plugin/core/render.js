/* Yekta Light — software renderer.
   Forms: analytic sphere, SDF ray-marched primitives, rasterised scanned meshes (z-buffer + shadow map).
   Light model (linear): key light (wrap / toon bands / skin SSS), second light, sky + ground-bounce ambient,
   normalized Blinn-Phong spec + metalness + env reflection, fresnel rim, soft shadows + AO.
   Every render is a generator so the host UI can time-slice it (Photoshop / desktop never freeze). */
(function (L) {
  'use strict';
  const C = L.color;
  const VIEW = 1.12;      // view half-extent in scene units
  const RS = 0.9;         // light-handle "horizon" radius
  const EMAX = 1.08;      // max handle radius (fully behind)
  const SR = 0.82, SR2 = SR * SR;
  const B_CX = 0.8, B_CY = -0.8, B_R = 0.25; // compare sphere (material B), screen-space
  const LENS = { ortho: 0, '85': 7.5, '50': 4.4, '35': 2.9 };

  const clamp01 = C.clamp01;
  const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const norm3 = (v) => { const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const len2 = (x, y) => Math.sqrt(x * x + y * y);
  const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
  const smin = (a, b, k) => { const h = clamp01(0.5 + (0.5 * (b - a)) / k); return b * (1 - h) + a * h - k * h * (1 - h); };
  function ell(x, y, z, a, b, c) {
    const k0 = len3(x / a, y / b, z / c), k1 = len3(x / (a * a), y / (b * b), z / (c * c));
    return k1 < 1e-9 ? -Math.min(a, b, c) : (k0 * (k0 - 1)) / k1;
  }

  const SDF = {
    sphere(x, y, z) { return len3(x, y, z) - SR; },
    egg(x, y, z) { const s = 1 - 0.15 * y; return ell(x / s, y, z / s, 0.54, 0.74, 0.54) * 0.88; },
    drape(x, y, z) {
      const amp = 0.08 + 0.06 * (0.7 - y);
      const f = amp * Math.sin(x * 7.2 + 0.7 * Math.sin(y * 2.6)) + 0.035 * Math.sin(x * 15 + 1.3 + y * 2);
      return Math.max((Math.abs(z - f) - 0.022) * 0.5, Math.max(Math.abs(x) - 0.66, Math.abs(y) - 0.7));
    },
    cube(x, y, z) {
      const b = 0.5, r = 0.06;
      const qx = Math.abs(x) - b + r, qy = Math.abs(y) - b + r, qz = Math.abs(z) - b + r;
      return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - r;
    },
    cylinder(x, y, z) {
      const ra = 0.48, h = 0.6, rb = 0.05;
      const dx = len2(x, z) - ra + rb, dy = Math.abs(y) - h + rb;
      return Math.min(Math.max(dx, dy), 0) + len2(Math.max(dx, 0), Math.max(dy, 0)) - rb;
    },
    cone(x, y, z) {
      const h = 0.58, r1 = 0.6, r2 = 0.0;
      y += 0.08;
      const qx = len2(x, z), qy = y, k1x = r2, k1y = h, k2x = r2 - r1, k2y = 2 * h;
      const cax = qx - Math.min(qx, qy < 0 ? r1 : r2), cay = Math.abs(qy) - h;
      const t = clamp01(((k1x - qx) * k2x + (k1y - qy) * k2y) / (k2x * k2x + k2y * k2y));
      const cbx = qx - k1x + k2x * t, cby = qy - k1y + k2y * t;
      const s = cbx < 0 && cay < 0 ? -1 : 1;
      return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
    },
    torus(x, y, z) { return len2(len2(x, z) - 0.56, y) - 0.25; },
    blob(x, y, z) {
      const a = len3(x, y + 0.2, z) - 0.5, b = len3(x - 0.05, y - 0.38, z - 0.05) - 0.33;
      const c = len3(x + 0.42, y + 0.05, z - 0.12) - 0.22, d = len3(x - 0.4, y + 0.32, z + 0.05) - 0.2;
      return smin(smin(smin(a, b, 0.18), c, 0.16), d, 0.15);
    },
  };
  // scanned meshes: framing (scale / offset after unit-radius normalisation) + orientation fix
  const MESHES = {
    head: { s: 1.45, dy: -0.24 },
    headF: { s: 1.25, dy: -0.18, rx: Math.PI },
    skull: { s: 1.25, dy: 0.02 },
    // rigged full bodies (posable): framed to 2 units tall, feet on the ground
    bodyF: { skinned: true, gy: -1.0 }, bodyM: { skinned: true, gy: -1.0 },
    heroF: { skinned: true, gy: -1.0 }, heroM: { skinned: true, gy: -1.0 },
  };
  const hasMesh = (m) => !!MESHES[m] && !!(L.meshData && L.meshData[m]);
  const NONCONVEX = { torus: 1, blob: 1, drape: 1, head: 1, headF: 1, skull: 1, bodyF: 1, bodyM: 1, heroF: 1, heroM: 1 };
  const STEP = { egg: 0.9, drape: 0.8 };
  const G_A = 0.62, G_Y = -0.86;
  const GN = [0, Math.cos(G_A), Math.sin(G_A)];
  function fib(n) { const a = new Float64Array(n * 3), g = Math.PI * (3 - Math.sqrt(5)); for (let i = 0; i < n; i++) { const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), t = g * i; a[i * 3] = Math.cos(t) * r; a[i * 3 + 1] = y; a[i * 3 + 2] = Math.sin(t) * r; } return a; }
  const FACETS = fib(110);

  // ---------------- colour helpers ----------------
  function kelvin(K) { // Tanner Helland approximation -> sRGB 0..1
    const t = K / 100; let r, g, b;
    if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307; }
    else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); b = 255; }
    const m = Math.max(r, g, b);
    return [r, g, b].map((v) => clamp01(v / m));
  }
  function shadowTemp(t) { // 0 = cool blue sky, 1 = warm bounce
    const a = C.srgbToOklab([0.3, 0.44, 0.92]), b = C.srgbToOklab([0.92, 0.55, 0.32]), m = C.srgbToOklab([0.55, 0.53, 0.6]);
    const mix = (p, q, k) => p.map((x, i) => x + (q[i] - x) * k);
    return C.oklabToSrgb(t < 0.5 ? mix(a, m, t * 2) : mix(m, b, (t - 0.5) * 2));
  }

  // ---------------- preparation ----------------
  function prepMat(m) {
    const base = C.lin3(m.base), spec = C.lin3(m.spec), metal = clamp01(m.metal || 0);
    const exp = 2 + Math.pow(clamp01(m.gloss), 2.2) * 600;
    return {
      base, alb: base.map((c) => c * (1 - metal)),
      spec: [0, 1, 2].map((i) => spec[i] * (1 - metal) + base[i] * metal),
      specInt: m.specInt * (1 + metal * 0.8), exp, norm: Math.sqrt((exp + 8) / 10),
      env: metal * 1.1 + Math.pow(clamp01(m.gloss), 3) * 0.15 * clamp01(m.specInt),
      sss: clamp01(m.sss || 0) * (1 - metal), sssC: C.lin3(m.sssColor || [1, 0.32, 0.22]),
    };
  }
  function prepare(S) {
    const Ld = norm3(S.light.dir), H = norm3([Ld[0], Ld[1], Ld[2] + 1]);
    const l2 = S.light2 || { on: false }, L2 = norm3(l2.dir || [0.6, 0.2, 0.7]);
    const cy = Math.cos(S.rot.yaw), sy = Math.sin(S.rot.yaw), cp = Math.cos(S.rot.pitch), sp = Math.sin(S.rot.pitch);
    const M = [cy, 0, sy, sp * sy, cp, -sp * cy, -cp * sy, sp, cp * cy]; // world = M * obj
    const isMesh = hasMesh(S.model);
    const persp = LENS[S.lens] || 0;
    const useSdf = !isMesh && (S.model !== 'sphere' || S.planes || S.ground || persp);
    const tr = (v) => [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]];
    const bo = S.bounce || { color: [0, 0, 0], intensity: 0 };
    return {
      L: Ld, H, M, isMesh, persp, gy: MESHES[S.model] && MESHES[S.model].gy != null ? MESHES[S.model].gy : G_Y,
      sdf: useSdf ? SDF[S.model] || SDF.sphere : null,
      Lobj: tr(Ld), GNobj: tr(GN),
      lc: C.lin3(S.light.color).map((c) => c * S.light.intensity),
      l2: !!l2.on && l2.intensity > 0, L2, H2: norm3([L2[0], L2[1], L2[2] + 1]),
      lc2: C.lin3(l2.color || [1, 1, 1]).map((c) => c * (l2.intensity || 0)),
      amb: C.lin3(S.ambient.color), ambInt: S.ambient.intensity,
      bnc: C.lin3(bo.color), bncInt: bo.intensity,
      // shadow tint: hue shift in the unlit areas, luminance preserved
      tint: (() => { const st = S.shadowTint || { color: [0.4, 0.45, 0.9], amount: 0 }, l = C.lin3(st.color), y = 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2] || 1e-3; return l.map((v) => Math.min(3, v / y)); })(),
      tintAmt: S.shadowTint ? S.shadowTint.amount : 0,
      envC: S.envCustom && S.envColor ? C.lin3(S.envColor).map((v) => v * 0.9) : null,
      rimC: C.lin3(S.rim.color), rimInt: S.rim.intensity, rimExp: 0.7 + (1 - S.rim.width) * 6,
      wrap: S.light.wrap, bands: Math.round(S.light.bands), soft: S.light.soft,
      shadows: !!S.shadows && (!!NONCONVEX[S.model] || !!S.ground),
      selfShadow: !!S.shadows && !!NONCONVEX[S.model],
      step: STEP[S.model] || 0.92, planes: !!S.planes, ground: !!S.ground,
      G: prepMat({ base: S.groundColor || [0.5, 0.5, 0.5], spec: [1, 1, 1], specInt: 0.04, gloss: 0.2, metal: 0 }),
      A: prepMat(S.matA), B: prepMat(S.matB), compare: !!S.compare,
      vmode: S.valueMode || (S.valueView ? 'gray' : 'off'), notan: S.notan == null ? 0.5 : S.notan,
      iso: S.iso ? S.isoLuma : -1,
      alpha: 1,
    };
  }

  function band(d, k, soft) {
    const x = d * k, i = Math.floor(x), f = x - i, e = soft * 0.5;
    const s = e < 1e-4 ? (f >= 0.5 ? 1 : 0) : smooth(0.5 - e, 0.5 + e, f);
    return Math.min(1, (i + s) / k);
  }

  function shade(n0, n1, n2, P, m, sh, ao, out) {
    const Lv = P.L, ndl = n0 * Lv[0] + n1 * Lv[1] + n2 * Lv[2];
    let d = (ndl + P.wrap) / (1 + P.wrap);
    d = d < 0 ? 0 : d > 1 ? 1 : d;
    const toon = P.bands > 1;
    if (toon) d = band(d, P.bands, P.soft);
    d *= sh;
    const H = P.H, nh = n0 * H[0] + n1 * H[1] + n2 * H[2];
    let s = 0;
    if (nh > 0 && ndl > -0.1) {
      s = Math.pow(nh, m.exp);
      if (toon) { const e = Math.max(0.01, P.soft * 0.25); s = smooth(0.5 - e, 0.5 + e, s) * 1.6; }
      else s *= m.norm;
      s *= m.specInt * sh * smooth(-0.1, 0.12, ndl);
    }
    // skin subsurface: warm/red band along the terminator
    let sss = 0;
    if (m.sss > 0) { const x = (ndl + 0.05) / 0.32; sss = Math.exp(-x * x) * m.sss * 0.6 * (0.35 + 0.65 * sh); if (toon) sss *= 0.5; }
    // second light (fill / kicker): no shadows
    let d2 = 0, s2 = 0;
    if (P.l2) {
      const L2 = P.L2, nd2 = n0 * L2[0] + n1 * L2[1] + n2 * L2[2];
      d2 = clamp01((nd2 + 0.1) / 1.1);
      if (toon) d2 = band(d2, P.bands, P.soft);
      const H2 = P.H2, nh2 = n0 * H2[0] + n1 * H2[1] + n2 * H2[2];
      if (nh2 > 0 && nd2 > 0) s2 = Math.pow(nh2, m.exp) * (toon ? 0 : m.norm) * m.specInt;
    }
    const sky = (0.55 + 0.45 * n1) * ao * P.ambInt;
    const bb = 0.5 - 0.5 * n1, bounce = bb * bb * ao * P.bncInt;
    const nv = n2 > 0 ? n2 : 0;
    let rim = 0;
    if (P.rimInt > 0) {
      rim = Math.pow(1 - nv, P.rimExp);
      if (toon) rim = smooth(0.42 - P.soft * 0.2, 0.48 + P.soft * 0.2, rim);
      rim *= P.rimInt * ao;
    }
    let ek = 0;
    if (m.env > 0) {
      const ry = 2 * nv * n1, fr = 0.35 + 0.65 * Math.pow(1 - nv, 4);
      ek = m.env * ao * (0.25 + 0.75 * smooth(-0.3, 0.6, ry)) * (m.alb[0] + m.alb[1] + m.alb[2] > 0 ? fr : 1);
    }
    const tw = P.tintAmt > 0 ? P.tintAmt * (1 - d) : 0;
    for (let c = 0; c < 3; c++) {
      const env = P.envC ? P.envC[c] : P.amb[c] * P.ambInt * 1.4;
      out[c] = m.spec[c] * ek * (env + P.lc[c] * 0.22)
        + m.alb[c] * (P.lc[c] * d + P.lc2[c] * d2) + m.base[c] * m.sssC[c] * P.lc[c] * sss
        + m.base[c] * (P.amb[c] * sky + P.bnc[c] * bounce)
        + m.spec[c] * (P.lc[c] * s + P.lc2[c] * s2) + P.rimC[c] * rim * (0.35 + 0.65 * m.base[c]);
    }
    if (tw > 0) {
      const Y = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
      for (let c = 0; c < 3; c++) out[c] = out[c] * (1 - tw) + Y * P.tint[c] * tw;
    }
  }

  function softShadow(f, ox, oy, oz, l) {
    let res = 1, t = 0.03;
    for (let i = 0; i < 36 && t < 2.4; i++) {
      const h = f(ox + l[0] * t, oy + l[1] * t, oz + l[2] * t);
      res = Math.min(res, (8 * h) / t);
      if (res < -1) break;
      t += clamp01(h) * 0.85 + 0.008;
      if (h > 0.6) t += 0.1;
    }
    res = Math.max(res, -1);
    return clamp01(0.25 * (1 + res) * (1 + res) * (2 - res));
  }
  function calcAO(f, px, py, pz, nx, ny, nz) {
    let occ = 0, sca = 1;
    for (let i = 0; i < 5; i++) {
      const hh = 0.02 + (0.14 * i) / 4;
      occ += (hh - f(px + nx * hh, py + ny * hh, pz + nz * hh)) * sca;
      sca *= 0.8;
    }
    return clamp01(1 - 1.8 * occ);
  }
  function snap(nx, ny, nz) {
    let best = -2, bi = 0;
    for (let i = 0; i < FACETS.length; i += 3) {
      const d = nx * FACETS[i] + ny * FACETS[i + 1] + nz * FACETS[i + 2];
      if (d > best) { best = d; bi = i; }
    }
    return [FACETS[bi], FACETS[bi + 1], FACETS[bi + 2]];
  }

  // camera ray for view coords; writes into R6 = [ox, oy, oz, dx, dy, dz]
  function ray(vx, vy, P, R6) {
    if (P.persp) {
      const D = P.persp, l = Math.sqrt(vx * vx + vy * vy + D * D);
      R6[0] = 0; R6[1] = 0; R6[2] = D; R6[3] = vx / l; R6[4] = vy / l; R6[5] = -D / l;
    } else { R6[0] = vx; R6[1] = vy; R6[2] = 4; R6[3] = 0; R6[4] = 0; R6[5] = -1; }
  }
  // ray vs sphere at origin: returns [t0, t1] or null
  function hitSphere(R6, r) {
    const b = R6[0] * R6[3] + R6[1] * R6[4] + R6[2] * R6[5];
    const c = R6[0] * R6[0] + R6[1] * R6[1] + R6[2] * R6[2] - r * r, disc = b * b - c;
    if (disc <= 0) return null;
    const q = Math.sqrt(disc);
    return [-b - q, -b + q];
  }
  function groundT(R6, gy) {
    const den = R6[3] * GN[0] + R6[4] * GN[1] + R6[5] * GN[2];
    if (den >= -1e-6) return -1;
    return ((0 - R6[0]) * GN[0] + (gy - R6[1]) * GN[1] + (0 - R6[2]) * GN[2]) / den;
  }

  const R6 = new Float64Array(6);
  // returns 0 miss, 1 model, 2 compare sphere, 3 ground; out = linear rgb; P.alpha = opacity
  function trace(vx, vy, P, out) {
    P.alpha = 1;
    if (P.compare) {
      const dx = vx - B_CX, dy = vy - B_CY, r2 = dx * dx + dy * dy;
      if (r2 < B_R * B_R) { shade(dx / B_R, dy / B_R, Math.sqrt(B_R * B_R - r2) / B_R, P, P.B, 1, 1, out); return 2; }
    }
    ray(vx, vy, P, R6);
    if (!P.sdf) {
      const h = hitSphere(R6, SR);
      if (!h) return 0;
      const t = h[0];
      shade((R6[0] + R6[3] * t) / SR, (R6[1] + R6[4] * t) / SR, (R6[2] + R6[5] * t) / SR, P, P.A, 1, 1, out);
      return 1;
    }
    const M = P.M, f = P.sdf;
    let tG = Infinity, fade = 0;
    if (P.ground) {
      const t = groundT(R6, P.gy);
      if (t > 0) {
        const dist = len3(R6[0] + R6[3] * t, R6[1] + R6[4] * t - P.gy, R6[2] + R6[5] * t);
        fade = 1 - smooth(0.55, 1.1, dist);
        if (fade > 0.002) tG = t;
      }
    }
    let px = 0, py = 0, pz = 0, hit = false;
    const hb = hitSphere(R6, 1);
    if (hb && hb[1] > 0) {
      const ox = M[0] * R6[0] + M[3] * R6[1] + M[6] * R6[2], oy = M[1] * R6[0] + M[4] * R6[1] + M[7] * R6[2], oz = M[2] * R6[0] + M[5] * R6[1] + M[8] * R6[2];
      const dx = M[0] * R6[3] + M[3] * R6[4] + M[6] * R6[5], dy = M[1] * R6[3] + M[4] * R6[4] + M[7] * R6[5], dz = M[2] * R6[3] + M[5] * R6[4] + M[8] * R6[5];
      let t = Math.max(0, hb[0]);
      const tEnd = Math.min(hb[1], tG), k = P.step;
      for (let i = 0; i < 140; i++) {
        px = ox + dx * t; py = oy + dy * t; pz = oz + dz * t;
        const hd = f(px, py, pz);
        if (hd < 0.0006) { hit = true; break; }
        t += hd * k;
        if (t > tEnd) break;
      }
    }
    if (!hit && tG === Infinity) return 0;
    if (!hit) {
      const wx = R6[0] + R6[3] * tG, wy = R6[1] + R6[4] * tG, wz = R6[2] + R6[5] * tG;
      const gx = M[0] * wx + M[3] * wy + M[6] * wz, gy = M[1] * wx + M[4] * wy + M[7] * wz, gz = M[2] * wx + M[5] * wy + M[8] * wz;
      const n = P.GNobj, ndl = GN[1] * P.L[1] + GN[2] * P.L[2];
      const sh = P.shadows && ndl > 0 ? softShadow(f, gx + n[0] * 0.01, gy + n[1] * 0.01, gz + n[2] * 0.01, P.Lobj) : 1;
      shade(GN[0], GN[1], GN[2], P, P.G, sh, calcAO(f, gx, gy, gz, n[0], n[1], n[2]), out);
      P.alpha = fade;
      return 3;
    }
    const e = 0.0008;
    const a = f(px + e, py - e, pz - e), b = f(px - e, py - e, pz + e), c = f(px - e, py + e, pz - e), d = f(px + e, py + e, pz + e);
    let nx = a - b - c + d, ny = -a - b + c + d, nz = -a + b - c + d;
    const nl = len3(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    const ao = calcAO(f, px, py, pz, nx, ny, nz);
    if (P.planes) { const q = snap(nx, ny, nz); nx = q[0]; ny = q[1]; nz = q[2]; }
    const wx = M[0] * nx + M[1] * ny + M[2] * nz, wy = M[3] * nx + M[4] * ny + M[5] * nz, wz = M[6] * nx + M[7] * ny + M[8] * nz;
    let sh = 1;
    if (P.selfShadow) {
      const ndl = wx * P.L[0] + wy * P.L[1] + wz * P.L[2];
      if (ndl > 0) sh = 1 + (softShadow(f, px + nx * 0.012, py + ny * 0.012, pz + nz * 0.012, P.Lobj) - 1) * smooth(0.0, 0.25, ndl);
    }
    shade(wx, wy, wz, P, P.A, sh, ao, out);
    return 1;
  }

  // ---------------- output encoding + value modes ----------------
  const KNEE = 0.82;
  function enc(x) {
    if (x > KNEE) x = KNEE + (1 - KNEE) * (1 - Math.exp(-(x - KNEE) / (1 - KNEE)));
    return C.toSrgb(x);
  }
  const ACC = [1, 0.71, 0.29];
  // linear rgb -> display sRGB 0..1 in res[], honoring value modes
  function finish(r, g, b, P, res) {
    let er = enc(r), eg = enc(g), eb = enc(b);
    if (P.vmode !== 'off' || P.iso >= 0) {
      const Y = enc(0.2126 * r + 0.7152 * g + 0.0722 * b);
      if (P.vmode !== 'off') {
        let v = Y;
        if (P.vmode === 'notan') v = Y >= P.notan ? 0.92 : 0.1;
        else if (P.vmode === 'v3') v = Y < 0.36 ? 0.1 : Y < 0.68 ? 0.48 : 0.9;
        else if (P.vmode === 'v5') v = 0.08 + Math.min(4, Math.floor(Y * 5)) * 0.215;
        er = eg = eb = v;
      }
      if (P.iso >= 0 && Math.abs(Y - P.iso) < 0.03) { er = er * 0.25 + ACC[0] * 0.75; eg = eg * 0.25 + ACC[1] * 0.75; eb = eb * 0.25 + ACC[2] * 0.75; }
    }
    res[0] = er; res[1] = eg; res[2] = eb;
  }

  // ---------------- SDF / sphere frame (generator) ----------------
  function* genTrace(S, W, H, ss) {
    const P = prepare(S), buf = new Uint8Array(W * H * 4), out = [0, 0, 0], fin = [0, 0, 0], total = ss * ss;
    const id = new Uint8Array(W * H);
    for (let py = 0; py < H; py++) {
      const vy = -(((py + 0.5) / H) * 2 - 1) * VIEW;
      for (let px = 0; px < W; px++) {
        const vx = (((px + 0.5) / W) * 2 - 1) * VIEW, hit = trace(vx, vy, P, out), i = py * W + px;
        id[i] = hit;
        if (!hit) continue;
        finish(out[0], out[1], out[2], P, fin);
        const o = i * 4;
        buf[o] = Math.min(255, fin[0] * 255 + 0.5); buf[o + 1] = Math.min(255, fin[1] * 255 + 0.5); buf[o + 2] = Math.min(255, fin[2] * 255 + 0.5);
        buf[o + 3] = Math.round(P.alpha * 255);
      }
      if ((py & 3) === 3) yield;
    }
    if (ss < 2) return buf;
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const i = py * W + px, c = id[i];
        if (!((px > 0 && id[i - 1] !== c) || (px < W - 1 && id[i + 1] !== c) || (py > 0 && id[i - W] !== c) || (py < H - 1 && id[i + W] !== c))) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (let sy = 0; sy < ss; sy++) {
          const vy = -(((py + (sy + 0.5) / ss) / H) * 2 - 1) * VIEW;
          for (let sx = 0; sx < ss; sx++) {
            const vx = (((px + (sx + 0.5) / ss) / W) * 2 - 1) * VIEW;
            if (trace(vx, vy, P, out)) { finish(out[0], out[1], out[2], P, fin); const w = P.alpha; r += fin[0] * w; g += fin[1] * w; b += fin[2] * w; n += w; }
          }
        }
        const o = i * 4;
        if (n) { buf[o] = Math.min(255, (r / n) * 255 + 0.5); buf[o + 1] = Math.min(255, (g / n) * 255 + 0.5); buf[o + 2] = Math.min(255, (b / n) * 255 + 0.5); }
        buf[o + 3] = Math.round((n / total) * 255);
      }
      if ((py & 7) === 7) yield;
    }
    return buf;
  }

  // ---------------- meshes ----------------
  const B64 = (() => { const t = new Int16Array(128).fill(-1); const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; for (let i = 0; i < 64; i++) t[a.charCodeAt(i)] = i; return t; })();
  function b64bytes(str) {
    let n = str.length; while (n && str[n - 1] === '=') n--;
    const out = new Uint8Array(Math.floor((n * 3) / 4));
    let o = 0, acc = 0, bits = 0;
    for (let i = 0; i < n; i++) { acc = ((acc << 6) | B64[str.charCodeAt(i)]) & 0xffffff; bits += 6; if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; } }
    return out;
  }
  const meshCache = {};
  function meshGet(name) {
    const d = L.meshData && L.meshData[name];
    if (!d) return null;
    if (meshCache[name] && meshCache[name].src === d) return meshCache[name];
    const pb = b64bytes(d.pos), nb = b64bytes(d.nor), ib = b64bytes(d.idx);
    const pv = new DataView(pb.buffer), iv = new DataView(ib.buffer);
    const pos = new Float32Array(d.v * 3), nor = new Float32Array(d.v * 3), idx = new Uint32Array(d.t * 3);
    const fr = MESHES[name] || { s: 1 }, rx = fr.rx || 0;
    const cx = Math.cos(rx), sx = Math.sin(rx);
    for (let i = 0; i < d.v; i++) {
      const x = pv.getInt16(i * 6, true) / 32767, y = pv.getInt16(i * 6 + 2, true) / 32767, z = pv.getInt16(i * 6 + 4, true) / 32767;
      pos[i * 3] = x * fr.s; pos[i * 3 + 1] = (y * cx - z * sx) * fr.s + (fr.dy || 0); pos[i * 3 + 2] = (y * sx + z * cx) * fr.s;
      const a = (nb[i * 3] << 24) >> 24, b = (nb[i * 3 + 1] << 24) >> 24, c = (nb[i * 3 + 2] << 24) >> 24;
      const l = Math.sqrt(a * a + b * b + c * c) || 1;
      nor[i * 3] = a / l; nor[i * 3 + 1] = (b * cx - c * sx) / l; nor[i * 3 + 2] = (b * sx + c * cx) / l;
    }
    for (let i = 0; i < d.t * 3; i++) idx[i] = iv.getUint16(i * 2, true);
    return (meshCache[name] = { src: d, n: d.v, t: d.t, pos, nor, idx });
  }

  // ---------- rigged meshes: skeleton, pose, linear blend skinning ----------
  // Pose = rotations in the BODY frame (x: bend fwd/back, y: turn, z: tilt sideways), so sliders mean the same on every rig.
  const skinCache = {};
  function mul4(a, b) { const o = new Float64Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; }
  function skinBase(name) {
    const d = L.meshData && L.meshData[name];
    if (!d || !d.skinned) return null;
    if (skinCache[name] && skinCache[name].src === d) return skinCache[name];
    const pb = new DataView(b64bytes(d.pos).buffer), nb = b64bytes(d.nor), jb = b64bytes(d.jnt), wb = b64bytes(d.wgt), iv = new DataView(b64bytes(d.idx).buffer);
    const n = d.v, P0 = new Float32Array(n * 3), N0 = new Float32Array(n * 3), W0 = new Float32Array(n * 4), idx = new Uint32Array(d.t * 3);
    for (let i = 0; i < n * 3; i++) P0[i] = d.qo[i % 3] + (pb.getInt16(i * 2, true) / 32767) * d.qs;
    for (let i = 0; i < n; i++) { const a = (nb[i * 3] << 24) >> 24, b = (nb[i * 3 + 1] << 24) >> 24, c = (nb[i * 3 + 2] << 24) >> 24, l = Math.sqrt(a * a + b * b + c * c) || 1; N0[i * 3] = a / l; N0[i * 3 + 1] = b / l; N0[i * 3 + 2] = c / l; }
    for (let i = 0; i < n * 4; i++) W0[i] = wb[i] / 255;
    for (let i = 0; i < d.t * 3; i++) idx[i] = iv.getUint16(i * 2, true);
    const J = d.skel.map((j) => ({ n: j.n, p: j.p, L: Float64Array.from(j.l), B: Float64Array.from(j.b) }));
    const byName = {}; J.forEach((j, k) => { byName[j.n] = k; });
    const RG = [];
    const rg = (k) => RG[k] || (RG[k] = J[k].p >= 0 ? mul4(rg(J[k].p), J[k].L) : J[k].L);
    J.forEach((_, k) => rg(k));
    // rest global rotation (orthonormalised 3x3, column-major)
    const RR = RG.map((m) => { const c = [0, 4, 8].map((o) => { const v = [m[o], m[o + 1], m[o + 2]], l = Math.hypot(v[0], v[1], v[2]) || 1; return v.map((x) => x / l); }); return c; });
    const pos = (k) => [RG[k][12], RG[k][13], RG[k][14]];
    // spread direction per finger (positive = away from the middle finger)
    const rig = d.rig || { fingers: {}, sem: {} };
    const fx = {};
    for (const key in rig.fingers) {
      const F = rig.fingers[key], sfx = key.slice(-2), mid = rig.fingers['middle' + sfx];
      const j1 = byName[F.joints[0]], j2 = byName[F.joints[1]];
      if (j1 == null || j2 == null) continue;
      const dir = norm3([0, 1, 2].map((c) => pos(j2)[c] - pos(j1)[c])), nAx = F.spread;
      const mv = [nAx[1] * dir[2] - nAx[2] * dir[1], nAx[2] * dir[0] - nAx[0] * dir[2], nAx[0] * dir[1] - nAx[1] * dir[0]];
      let sg = 0;
      if (mid && mid !== F && byName[mid.joints[0]] != null) { const off = [0, 1, 2].map((c) => pos(j1)[c] - pos(byName[mid.joints[0]])[c]); sg = Math.sign(mv[0] * off[0] + mv[1] * off[1] + mv[2] * off[2]); }
      fx[key] = sg;
    }
    return (skinCache[name] = { src: d, n, t: d.t, P0, N0, J0: jb, W0, idx, J, byName, RR, rig, fx, frame: d.frame, last: null });
  }
  const D2R = Math.PI / 180;
  function rotAxis(ax, deg) { // 3x3 column-major
    const a = norm3(ax), t = deg * D2R, c = Math.cos(t), s = Math.sin(t), C1 = 1 - c, [x, y, z] = a;
    return [x * x * C1 + c, y * x * C1 + z * s, z * x * C1 - y * s, x * y * C1 - z * s, y * y * C1 + c, z * y * C1 + x * s, x * z * C1 + y * s, y * z * C1 - x * s, z * z * C1 + c];
  }
  const m3 = (a, b) => { const o = new Array(9); for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2]; return o; };
  function eulerBody(e) { return m3(rotAxis([0, 1, 0], e[1] || 0), m3(rotAxis([1, 0, 0], e[0] || 0), rotAxis([0, 0, 1], e[2] || 0))); }
  function posed(name, pose) {
    const K = skinBase(name);
    if (!K) return null;
    const key = JSON.stringify(pose || {});
    if (K.last && K.last.key === key) return K.last.mesh;
    const J = K.J, nj = J.length, deltas = new Array(nj).fill(null);
    const addDelta = (k, Rw) => { if (k == null || k < 0) return; deltas[k] = deltas[k] ? m3(Rw, deltas[k]) : Rw; };
    const base = K.base || (K.base = baselineFrames(K));
    const pj = (pose && pose.j) || {};
    const lx = K.rig.leftX || 1;
    for (const sem in pj) {
      const e = pj[sem]; if (!e || (!e[0] && !e[1] && !e[2])) continue;
      // UI semantics -> body-frame rotation: Bend = natural flexion, Turn / Tilt mirrored between sides
      const base2 = sem.replace(/_[lr]$/, ''), side = /_l$/.test(sem) ? 1 : /_r$/.test(sem) ? -1 : 0;
      const fx = FLEX[base2] || 1, sy = side ? side * lx : lx, sz = side ? side * lx : -lx;
      addDelta(K.byName[K.rig.sem[sem]], eulerBody([(e[0] || 0) * fx, (e[1] || 0) * sy, (e[2] || 0) * sz]));
    }
    const pf = (pose && pose.f) || {};
    for (const key2 in K.rig.fingers) {
      const F = K.rig.fingers[key2], side = key2.slice(-1), h = pf[side]; if (!h) continue;
      const isThumb = key2.indexOf('thumb') === 0, curl = isThumb ? h.thumb || 0 : h.curl || 0;
      const spread = isThumb ? 0 : (h.spread || 0) * ({ index: 1, middle: 0.25, ring: 0.6, pinky: 1.1 }[key2.split('_')[0]] || 0) * (K.fx[key2] || 0) * (F.fused ? 0.2 : 1);
      const share = isThumb ? [0.45, 0.8, 0.75] : [0.85, 1.1, 0.75];
      F.joints.forEach((jn, i) => {
        const k = K.byName[jn]; if (k == null) return;
        let Rw = curl ? rotAxis(F.curl, curl * share[i]) : null;
        if (i === 0 && spread) Rw = Rw ? m3(Rw, rotAxis(F.spread, spread)) : rotAxis(F.spread, spread);
        if (Rw) addDelta(k, Rw);
      });
    }
    // globals: rest local * baseline (common A-pose) * user delta (body-frame rotation seen at the baseline pose)
    const G = new Array(nj);
    const g = (k) => {
      if (G[k]) return G[k];
      let D3 = base.D[k];
      if (deltas[k]) { const Rb = base.R[k], RbT = tr3(Rb); D3 = m3(D3 || I3, m3(RbT, m3(deltas[k], Rb))); }
      const Lm = D3 ? mul4(J[k].L, to4(D3)) : J[k].L;
      return (G[k] = J[k].p >= 0 ? mul4(g(J[k].p), Lm) : Lm);
    };
    const SK = J.map((j, k) => mul4(g(k), j.B));
    const n = K.n, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), P0 = K.P0, N0 = K.N0, JJ = K.J0, WW = K.W0;
    const fk = K.frame.k, fc = K.frame.c;
    for (let v = 0; v < n; v++) {
      let px = 0, py = 0, pz = 0, nx = 0, ny = 0, nz = 0;
      const x = P0[v * 3], y = P0[v * 3 + 1], z = P0[v * 3 + 2], a = N0[v * 3], b = N0[v * 3 + 1], c = N0[v * 3 + 2];
      for (let q = 0; q < 4; q++) {
        const w = WW[v * 4 + q]; if (!w) continue; const Mq = SK[JJ[v * 4 + q]];
        px += w * (Mq[0] * x + Mq[4] * y + Mq[8] * z + Mq[12]); py += w * (Mq[1] * x + Mq[5] * y + Mq[9] * z + Mq[13]); pz += w * (Mq[2] * x + Mq[6] * y + Mq[10] * z + Mq[14]);
        nx += w * (Mq[0] * a + Mq[4] * b + Mq[8] * c); ny += w * (Mq[1] * a + Mq[5] * b + Mq[9] * c); nz += w * (Mq[2] * a + Mq[6] * b + Mq[10] * c);
      }
      pos[v * 3] = (px - fc[0]) * fk; pos[v * 3 + 1] = (py - fc[1]) * fk; pos[v * 3 + 2] = (pz - fc[2]) * fk;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
    }
    const mesh = { n, t: K.t, pos, nor, idx: K.idx, joint: (jn) => { const k = K.byName[jn]; if (k == null) return null; const m = G[k]; return [(m[12] - fc[0]) * fk, (m[13] - fc[1]) * fk, (m[14] - fc[2]) * fk]; } };
    K.last = { key, mesh };
    return mesh;
  }
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  // sign of "Bend" per joint so that positive = natural flexion (limbs hang down, spine points up)
  const FLEX = { arm: -1, elbow: -1, wrist: -1, shoulder: -1, thigh: -1, ankle: -1, knee: 1, hips: 1, spine: 1, chest: 1, neck: 1, head: 1 };
  // pose presets (UI semantics: [bend, turn, tilt] in degrees; tilt on arms = raise sideways)
  const relaxedArms = { arm_l: [4, 0, -14], arm_r: [4, 0, -14], elbow_l: [12, 0, 0], elbow_r: [12, 0, 0] };
  const hands = (c, t, sp) => ({ l: { curl: c, thumb: t, spread: sp }, r: { curl: c, thumb: t, spread: sp } });
  const POSES = {
    'A-pose': { j: {}, f: hands(0, 0, 0) },
    Relaxed: { j: Object.assign({}, relaxedArms), f: hands(25, 15, 5) },
    Contrapposto: { j: Object.assign({}, relaxedArms, { hips: [0, 0, 6], chest: [0, 6, -7], head: [4, 14, 4], thigh_l: [10, 0, 2], knee_l: [22, 0, 0], ankle_l: [-8, 0, 0], thigh_r: [0, 0, -3], elbow_l: [18, 0, 0] }), f: hands(30, 18, 6) },
    'Hand on hip': { j: Object.assign({}, relaxedArms, { arm_r: [-15, 0, 40], elbow_r: [0, 0, -110], hips: [0, 0, 4], chest: [0, -8, -4], head: [0, 12, 0], thigh_l: [6, 0, 0], knee_l: [12, 0, 0] }), f: { l: { curl: 25, thumb: 15, spread: 5 }, r: { curl: 15, thumb: 10, spread: 0 } } },
    Thinking: { j: Object.assign({}, relaxedArms, { arm_l: [30, 0, -30], elbow_l: [150, 0, -55], head: [12, 8, 0], chest: [5, 0, 0] }), f: { l: { curl: 55, thumb: 35, spread: 0 }, r: { curl: 35, thumb: 20, spread: 0 } } },
    Walk: { j: { thigh_l: [24, 0, 0], knee_l: [12, 0, 0], ankle_l: [-6, 0, 0], thigh_r: [-16, 0, 0], knee_r: [28, 0, 0], ankle_r: [12, 0, 0], arm_l: [-18, 0, -12], arm_r: [20, 0, -12], elbow_l: [14, 0, 0], elbow_r: [30, 0, 0], chest: [0, -7, 0], hips: [0, 6, 0] }, f: hands(28, 15, 4) },
    Reach: { j: Object.assign({}, relaxedArms, { arm_r: [25, 0, 135], elbow_r: [10, 0, 0], head: [-18, 10, 0], chest: [-6, 0, 6] }), f: { l: { curl: 25, thumb: 15, spread: 5 }, r: { curl: 5, thumb: 5, spread: 18 } } },
    Fists: { j: Object.assign({}, relaxedArms, { elbow_l: [35, 0, 0], elbow_r: [35, 0, 0] }), f: hands(90, 60, 0) },
  };
  const tr3 = (a) => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
  const to4 = (a) => Float64Array.from([a[0], a[1], a[2], 0, a[3], a[4], a[5], 0, a[6], a[7], a[8], 0, 0, 0, 0, 1]);
  const rot3 = (m) => { const c = [0, 4, 8].map((o) => { const v = [m[o], m[o + 1], m[o + 2]], l = Math.hypot(v[0], v[1], v[2]) || 1; return v.map((x) => x / l); }); return [c[0][0], c[0][1], c[0][2], c[1][0], c[1][1], c[1][2], c[2][0], c[2][1], c[2][2]]; };
  // every rig is first brought to the same relaxed A-pose (upper arms ~22deg from the body) so sliders behave identically
  function baselineFrames(K) {
    const J = K.J, nj = J.length, D = new Array(nj).fill(null), rig = K.rig, A = 22;
    const restR = (k) => { const r = K.RR[k]; return [r[0][0], r[0][1], r[0][2], r[1][0], r[1][1], r[1][2], r[2][0], r[2][1], r[2][2]]; };
    const put = (sem, Rw) => { const k = K.byName[rig.sem[sem]]; if (k == null) return; const Rr = restR(k); D[k] = m3(tr3(Rr), m3(Rw, Rr)); };
    if (rig.armRestDeg) {
      const lx = rig.leftX || 1;
      put('arm_l', rotAxis([0, 0, 1], -lx * (rig.armRestDeg.l - A)));
      put('arm_r', rotAxis([0, 0, 1], lx * (rig.armRestDeg.r - A)));
    }
    const GB = new Array(nj);
    const gb = (k) => GB[k] || (GB[k] = J[k].p >= 0 ? mul4(gb(J[k].p), D[k] ? mul4(J[k].L, to4(D[k])) : J[k].L) : (D[k] ? mul4(J[k].L, to4(D[k])) : J[k].L));
    const Rb = J.map((_, k) => rot3(gb(k)));
    return { D, R: Rb };
  }
  const meshFor = (S) => (MESHES[S.model] && MESHES[S.model].skinned ? posed(S.model, S.pose) : meshGet(S.model));
  const rigOf = (m) => { const K = skinBase(m); return K ? { sem: K.rig.sem, leftX: K.rig.leftX, armRestDeg: K.rig.armRestDeg, hasFingers: Object.keys(K.rig.fingers).length > 0 } : null; };

  // rasterise triangles (projected sx, sy, depth sd) into depth buffer; onPix for each written pixel. Yields periodically.
  function* raster(m, sx, sy, sd, w, h, depth, cull, onPix) {
    const idx = m.idx;
    for (let t = 0; t < idx.length; t += 3) {
      if (t % 4500 === 4497) yield;
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const ax = sx[a], ay = sy[a], bx = sx[b], by = sy[b], cx = sx[c], cy = sy[c];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (area === 0 || (cull && area > 0)) continue;
      const inv = 1 / area;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by, cy)));
      if (x0 > x1 || y0 > y1) continue;
      const za = sd[a], zb = sd[b], zc = sd[c];
      for (let y = y0; y <= y1; y++) {
        const py = y + 0.5;
        for (let x = x0; x <= x1; x++) {
          const px = x + 0.5;
          const w0 = ((cx - bx) * (py - by) - (cy - by) * (px - bx)) * inv;
          if (w0 < -1e-6) continue;
          const w1 = ((ax - cx) * (py - cy) - (ay - cy) * (px - cx)) * inv;
          const w2 = 1 - w0 - w1;
          if (w1 < -1e-6 || w2 < -1e-6) continue;
          const z = w0 * za + w1 * zb + w2 * zc, i = y * w + x;
          if (z <= depth[i]) continue;
          depth[i] = z;
          if (onPix) onPix(i, a, b, c, w0, w1, w2);
        }
      }
    }
  }
  const drain = (g) => { let r; do { r = g.next(); } while (!r.done); return r.value; };

  const SM = 320, SM_EXT = 1.1;
  function* buildShadowMap(m, M, Ld) {
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(Ld[1]) > 0.9) { ux = 1; uy = 0; }
    let ax = uy * Ld[2] - uz * Ld[1], ay = uz * Ld[0] - ux * Ld[2], az = ux * Ld[1] - uy * Ld[0];
    const al = len3(ax, ay, az); ax /= al; ay /= al; az /= al;
    const bx = Ld[1] * az - Ld[2] * ay, by = Ld[2] * ax - Ld[0] * az, bz = Ld[0] * ay - Ld[1] * ax;
    const n = m.n, sx = new Float32Array(n), sy = new Float32Array(n), sd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
      const wx = M[0] * x + M[1] * y + M[2] * z, wy = M[3] * x + M[4] * y + M[5] * z, wz = M[6] * x + M[7] * y + M[8] * z;
      sx[i] = ((wx * ax + wy * ay + wz * az) / SM_EXT + 1) * 0.5 * SM;
      sy[i] = (1 - (wx * bx + wy * by + wz * bz) / SM_EXT) * 0.5 * SM;
      sd[i] = wx * Ld[0] + wy * Ld[1] + wz * Ld[2];
    }
    const depth = new Float32Array(SM * SM).fill(-1e9);
    yield* raster(m, sx, sy, sd, SM, SM, depth, false, null);
    return { depth, a: [ax, ay, az], b: [bx, by, bz], L: Ld };
  }
  function smLookup(sm, wx, wy, wz, bias, r) {
    const u = ((wx * sm.a[0] + wy * sm.a[1] + wz * sm.a[2]) / SM_EXT + 1) * 0.5 * SM;
    const v = (1 - (wx * sm.b[0] + wy * sm.b[1] + wz * sm.b[2]) / SM_EXT) * 0.5 * SM;
    const d = wx * sm.L[0] + wy * sm.L[1] + wz * sm.L[2] + bias;
    let lit = 0, cnt = 0;
    const cu = Math.floor(u), cv = Math.floor(v);
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
      const x = cu + i, y = cv + j; cnt++;
      if (x < 0 || y < 0 || x >= SM || y >= SM || sm.depth[y * SM + x] <= d) lit++;
    }
    return lit / cnt;
  }

  // mesh frame -> linear colour + alpha at (w, h)
  function* genMeshFrame(S, w, h) {
    const P = prepare(S), m = meshFor(S), M = P.M, D = P.persp;
    const n = m.n, sx = new Float32Array(n), sy = new Float32Array(n), sd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
      const wx = M[0] * x + M[1] * y + M[2] * z, wy = M[3] * x + M[4] * y + M[5] * z, wz = M[6] * x + M[7] * y + M[8] * z;
      const k = D ? D / (D - wz) : 1;
      sx[i] = ((wx * k) / VIEW + 1) * 0.5 * w; sy[i] = (1 - (wy * k) / VIEW) * 0.5 * h; sd[i] = wz;
    }
    const N = w * h, depth = new Float32Array(N).fill(-1e9);
    const nx = new Float32Array(N), ny = new Float32Array(N), nz = new Float32Array(N), nor = m.nor;
    yield* raster(m, sx, sy, sd, w, h, depth, true, (i, a, b, c, w0, w1, w2) => {
      nx[i] = w0 * nor[a * 3] + w1 * nor[b * 3] + w2 * nor[c * 3];
      ny[i] = w0 * nor[a * 3 + 1] + w1 * nor[b * 3 + 1] + w2 * nor[c * 3 + 1];
      nz[i] = w0 * nor[a * 3 + 2] + w1 * nor[b * 3 + 2] + w2 * nor[c * 3 + 2];
    });
    const sm = P.shadows || P.ground ? yield* buildShadowMap(m, M, P.L) : null;
    const col = new Float32Array(N * 3), alpha = new Float32Array(N), out = [0, 0, 0];
    for (let py = 0; py < h; py++) {
      const vy = -(((py + 0.5) / h) * 2 - 1) * VIEW;
      for (let px = 0; px < w; px++) {
        const vx = (((px + 0.5) / w) * 2 - 1) * VIEW, i = py * w + px;
        let a = 0;
        if (P.compare && (vx - B_CX) * (vx - B_CX) + (vy - B_CY) * (vy - B_CY) < B_R * B_R) {
          const dx = vx - B_CX, dy = vy - B_CY;
          shade(dx / B_R, dy / B_R, Math.sqrt(Math.max(0, B_R * B_R - dx * dx - dy * dy)) / B_R, P, P.B, 1, 1, out); a = 1;
        } else {
          let gz = -1e9, fade = 0, gwx = 0, gwy = 0;
          if (P.ground) {
            ray(vx, vy, P, R6);
            const t = groundT(R6, P.gy);
            if (t > 0) {
              gwx = R6[0] + R6[3] * t; gwy = R6[1] + R6[4] * t; const wz = R6[2] + R6[5] * t;
              fade = 1 - smooth(0.55, 1.1, len3(gwx, gwy - P.gy, wz));
              if (fade > 0.002) gz = wz;
            }
          }
          if (depth[i] > -1e8 && depth[i] >= gz) {
            let ox = nx[i], oy = ny[i], oz = nz[i];
            const l = Math.sqrt(ox * ox + oy * oy + oz * oz) || 1; ox /= l; oy /= l; oz /= l;
            if (P.planes) { const q = snap(ox, oy, oz); ox = q[0]; oy = q[1]; oz = q[2]; }
            const wx = M[0] * ox + M[1] * oy + M[2] * oz, wy = M[3] * ox + M[4] * oy + M[5] * oz, wz = M[6] * ox + M[7] * oy + M[8] * oz;
            let sh = 1;
            if (P.selfShadow && sm) {
              const ndl = wx * P.L[0] + wy * P.L[1] + wz * P.L[2];
              if (ndl > 0) {
                const z = depth[i], k = D ? (D - z) / D : 1;
                const off = 0.018 + 0.03 * (1 - ndl); // normal-offset + slope bias: no acne at grazing angles
                sh = 1 + (smLookup(sm, vx * k + wx * off, vy * k + wy * off, z + wz * off, 0.012, 1) - 1) * smooth(0.0, 0.25, ndl);
              }
            }
            shade(wx, wy, wz, P, P.A, sh, 0.75 + 0.25 * smooth(-0.2, 0.5, wz), out); a = 1;
          } else if (gz > -1e8) {
            const ndl = GN[1] * P.L[1] + GN[2] * P.L[2];
            const sh = P.shadows && ndl > 0 ? smLookup(sm, gwx, gwy, gz, 0.02, 3) : 1;
            shade(GN[0], GN[1], GN[2], P, P.G, sh, 1, out); a = fade;
          }
        }
        if (a > 0) { col[i * 3] = out[0]; col[i * 3 + 1] = out[1]; col[i * 3 + 2] = out[2]; alpha[i] = a; }
      }
      if ((py & 7) === 7) yield;
    }
    return { col, alpha, w, h, P };
  }
  let meshPickCache = null;
  function pickKey(S) {
    return JSON.stringify([S.model, S.rot, S.light, S.light2, S.ambient, S.bounce, S.rim, S.matA, S.matB, S.compare, S.shadows, S.planes, S.ground, S.groundColor, S.lens, S.shadowTint, S.envCustom, S.envColor, MESHES[S.model] && MESHES[S.model].skinned ? S.pose : 0]);
  }
  function* genMesh(S, W, H, ss) {
    const f = Math.max(1, Math.min(2, ss || 1)), w = W * f, h = H * f;
    const fr = yield* genMeshFrame(S, w, h);
    meshPickCache = { key: pickKey(S), fr };
    const buf = new Uint8Array(W * H * 4), P = fr.P, fin = [0, 0, 0];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) {
          const k = (y * f + j) * w + x * f + i, al = fr.alpha[k];
          if (!al) continue;
          finish(fr.col[k * 3], fr.col[k * 3 + 1], fr.col[k * 3 + 2], P, fin);
          r += fin[0] * al; g += fin[1] * al; b += fin[2] * al; a += al;
        }
        if (a > 0) {
          const o = (y * W + x) * 4;
          buf[o] = Math.min(255, (r / a) * 255 + 0.5); buf[o + 1] = Math.min(255, (g / a) * 255 + 0.5); buf[o + 2] = Math.min(255, (b / a) * 255 + 0.5);
          buf[o + 3] = Math.round((a / (f * f)) * 255);
        }
      }
      if ((y & 15) === 15) yield;
    }
    return buf;
  }
  function pickMesh(S, vx, vy) {
    if (!meshPickCache || meshPickCache.key !== pickKey(S)) meshPickCache = { key: pickKey(S), fr: drain(genMeshFrame(S, 320, 320)) };
    const fr = meshPickCache.fr;
    const x = Math.floor((vx / VIEW + 1) * 0.5 * fr.w), y = Math.floor((1 - vy / VIEW) * 0.5 * fr.h);
    if (x < 0 || y < 0 || x >= fr.w || y >= fr.h) return null;
    const k = y * fr.w + x;
    if (!fr.alpha[k]) return null;
    return { color: [fr.col[k * 3], fr.col[k * 3 + 1], fr.col[k * 3 + 2]].map((v) => clamp01(enc(v))) };
  }

  // ---------------- public API ----------------
  // renderGen(S, W, H, {ss}) -> generator; returns RGBA Uint8Array. render() = synchronous drain.
  function renderGen(S, W, H, opt) {
    const ss = (opt && opt.ss) || 1;
    if (hasMesh(S.model)) return genMesh(S, W, H, ss > 1 ? 2 : 1);
    return genTrace(S, W, H, ss);
  }
  const render = (S, W, H, opt) => drain(renderGen(S, W, H, opt));
  function pick(S, vx, vy) {
    if (hasMesh(S.model)) return pickMesh(S, vx, vy);
    const P = prepare(S), out = [0, 0, 0];
    if (!trace(vx, vy, P, out)) return null;
    return { color: out.map((v) => clamp01(enc(v))) };
  }

  // value ramp across the active material sphere along the projected light axis
  function ramp(S, n) {
    const P = prepare(S), m = S.active === 'B' ? P.B : P.A, out = [0, 0, 0], res = [];
    let ax = P.L[0], ay = P.L[1];
    const al = len2(ax, ay);
    if (al < 0.05) { ax = -0.707; ay = 0.707; } else { ax /= al; ay /= al; }
    for (let i = 0; i < n; i++) {
      const t = 0.97 - (1.94 * i) / (n - 1), x = ax * t, y = ay * t, z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      shade(x, y, z, P, m, 1, 1, out);
      res.push(out.map((v) => clamp01(enc(v))));
    }
    return res;
  }
  // light families: the named colours a painter needs, computed for the active material
  function families(S) {
    const P = prepare(S), m = S.active === 'B' ? P.B : P.A, out = [0, 0, 0], Lv = P.L;
    let b = [-Lv[0] * Lv[2], -Lv[1] * Lv[2], 1 - Lv[2] * Lv[2]];
    if (len3(b[0], b[1], b[2]) < 1e-3) b = [0, 1, 0];
    b = norm3(b);
    const arc = (ndl) => { const th = Math.acos(Math.max(-1, Math.min(1, ndl))); return norm3([Lv[0] * Math.cos(th) + b[0] * Math.sin(th), Lv[1] * Math.cos(th) + b[1] * Math.sin(th), Lv[2] * Math.cos(th) + b[2] * Math.sin(th)]); };
    const col = (N, mat, sh, ao) => { shade(N[0], N[1], N[2], P, mat || m, sh == null ? 1 : sh, ao == null ? 1 : ao, out); return out.map((v) => clamp01(enc(v))); };
    const res = [
      { id: 'highlight', label: 'Highlight', short: 'Highlight', color: col(P.H) },
      { id: 'light', label: 'Light', short: 'Light', color: col(arc(0.82)) },
      { id: 'half', label: 'Halftone', short: 'Halftone', color: col(arc(0.38)) },
      { id: 'term', label: 'Terminator', short: 'Terminator', color: col(arc(0.02)) },
      { id: 'core', label: 'Core shadow', short: 'Core', color: col(arc(-0.32)) },
      { id: 'refl', label: 'Reflected', short: 'Reflected', color: col(norm3([-Lv[0] * 0.5 + b[0] * 0.2, -0.85, -Lv[2] * 0.3 + 0.35])) },
      { id: 'occl', label: 'Occlusion', short: 'Occlusion', color: col(arc(-0.5), null, 1, 0.3) },
      { id: 'cast', label: 'Cast shadow', short: 'Cast', color: col([0, 1, 0], S.ground ? P.G : m, 0, 0.75) },
    ];
    if (P.rimInt > 0) {
      const sx = -Lv[0], sy = -Lv[1], sl = len2(sx, sy) || 1;
      res.splice(5, 0, { id: 'rim', label: 'Rim', short: 'Rim', color: col(norm3([(sx / sl) * 0.99, (sy / sl) * 0.99, 0.12])) });
    }
    return res;
  }

  function lightFromHandle(x, y) {
    const r = len2(x, y);
    if (r <= RS) { const k = r / RS; return norm3([x / RS, y / RS, Math.sqrt(Math.max(0, 1 - k * k))]); }
    const t = Math.min(1, (r - RS) / (EMAX - RS)), th = Math.PI / 2 + t * (Math.PI / 2) * 0.96, s = Math.sin(th);
    return norm3([(x / r) * s, (y / r) * s, Math.cos(th)]);
  }
  function handleFromLight(d) {
    d = norm3(d);
    if (d[2] >= 0) return [d[0] * RS, d[1] * RS];
    const th = Math.acos(Math.max(-1, Math.min(1, d[2]))), t = Math.min(1, (th - Math.PI / 2) / ((Math.PI / 2) * 0.96));
    const r = RS + t * (EMAX - RS), l = len2(d[0], d[1]);
    return l < 1e-4 ? [0, r] : [(d[0] / l) * r, (d[1] / l) * r];
  }
  const dirAE = (az, el) => [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];

  // classic portrait lighting setups (key az/el; optional second light)
  const setups = {
    Rembrandt: { key: dirAE(-0.85, 0.62), l2: null },
    Loop: { key: dirAE(-0.55, 0.42), l2: null },
    Butterfly: { key: dirAE(0, 0.78), l2: null },
    Split: { key: dirAE(-1.55, 0.08), l2: null },
    Rim: { key: dirAE(2.5, 0.35), l2: { dir: dirAE(-0.4, 0.2), intensity: 0.35 } },
    Under: { key: dirAE(0.15, -0.75), l2: null },
  };
  const views = {
    Front: { yaw: 0, pitch: 0.04 }, '3/4': { yaw: 0.62, pitch: 0.06 }, Profile: { yaw: 1.5708, pitch: 0.02 },
    Top: { yaw: 0.45, pitch: 0.6 }, Low: { yaw: 0.35, pitch: -0.42 },
  };

  function defaultState() {
    return {
      model: 'sphere', lens: 'ortho',
      rot: { yaw: 0.62, pitch: 0.42 },
      light: { dir: norm3([-0.5, 0.55, 0.67]), color: [1, 0.95, 0.88], intensity: 1.25, wrap: 0.2, bands: 0, soft: 0.2, kelvin: 5600 },
      light2: { on: false, dir: norm3([0.75, 0.15, 0.6]), color: [0.75, 0.85, 1], intensity: 0.35, kelvin: 9000 },
      shadowTint: { color: [0.42, 0.4, 0.9], amount: 0 },
      envCustom: false, envColor: [0.55, 0.62, 0.8],
      backdrop: 'dark', backdropColor: [0.36, 0.34, 0.32],
      pins: {},
      pose: { j: {}, f: { l: { curl: 0, spread: 0, thumb: 0 }, r: { curl: 0, spread: 0, thumb: 0 } } },
      poseJoint: 'head',
      ambient: { color: [0.36, 0.44, 0.78], intensity: 0.35, temp: 0.2 },
      bounce: { color: [0.62, 0.5, 0.4], intensity: 0.25 },
      rim: { color: [0.45, 0.85, 1], intensity: 0.0, width: 0.35 },
      matA: { base: [0.92, 0.5, 0.36], spec: [1, 1, 1], specInt: 0.35, gloss: 0.45, metal: 0, sss: 0, sssColor: [1, 0.32, 0.22] },
      matB: { base: [0.32, 0.55, 0.95], spec: [1, 1, 1], specInt: 0.6, gloss: 0.75, metal: 0, sss: 0, sssColor: [1, 0.32, 0.22] },
      active: 'A', compare: true, shadows: true,
      valueMode: 'off', notan: 0.5, iso: false, isoLuma: 0.5,
      planes: false, ground: false, groundColor: [0.52, 0.5, 0.48],
      mode: 'pick', live: true, followFG: false, bigPalette: false, target: 'pick',
      pick: [0.92, 0.5, 0.36],
      grid: [[0.42, 0.6, 0.95], [0.75, 0.42, 0.8], [0.45, 0.95, 0.6], [0.1, 0.62, 0.3]],
      gridN: 9, history: [], collapsed: {},
    };
  }

  const mat = (base, specInt, gloss, metal, sss) => ({ base, spec: [1, 1, 1], specInt, gloss, metal: metal || 0, sss: sss || 0, sssColor: [1, 0.32, 0.22] });
  const P_ = (name, light, ambient, rim, m, extra) => Object.assign({ name, light, ambient, rim, mat: m, builtin: true }, extra || {});
  const Lt = (dir, color, intensity, wrap, bands, soft) => ({ dir: norm3(dir), color, intensity, wrap, bands: bands || 0, soft: soft == null ? 0.2 : soft });
  const presets = [
    P_('Warm skin', Lt([-0.55, 0.5, 0.67], [1, 0.92, 0.82], 1.2, 0.3), { color: [0.35, 0.42, 0.72], intensity: 0.36 }, { color: [1, 0.55, 0.4], intensity: 0.2, width: 0.3 },
      mat([0.93, 0.66, 0.54], 0.25, 0.38, 0, 0.75), { bounce: { color: [0.75, 0.5, 0.38], intensity: 0.3 } }),
    P_('Deep skin', Lt([-0.6, 0.45, 0.66], [1, 0.9, 0.78], 1.3, 0.25), { color: [0.4, 0.42, 0.62], intensity: 0.32 }, { color: [1, 0.75, 0.55], intensity: 0.3, width: 0.3 },
      mat([0.45, 0.27, 0.18], 0.45, 0.55, 0, 0.6), { bounce: { color: [0.7, 0.45, 0.3], intensity: 0.3 } }),
    P_('Gold', Lt([-0.4, 0.6, 0.7], [1, 0.97, 0.9], 1.35, 0), { color: [0.32, 0.26, 0.22], intensity: 0.6 }, { color: [1, 0.9, 0.7], intensity: 0.15, width: 0.25 }, mat([1, 0.77, 0.34], 1.0, 0.78, 1)),
    P_('Chrome', Lt([-0.45, 0.6, 0.66], [1, 1, 1], 1.3, 0), { color: [0.4, 0.45, 0.55], intensity: 0.7 }, { color: [0.8, 0.9, 1], intensity: 0.35, width: 0.25 }, mat([0.85, 0.87, 0.9], 1.2, 0.93, 1)),
    P_('Glossy plastic', Lt([-0.5, 0.6, 0.62], [1, 1, 1], 1.2, 0.1), { color: [0.45, 0.5, 0.6], intensity: 0.35 }, { color: [1, 1, 1], intensity: 0, width: 0.3 }, mat([0.18, 0.42, 0.95], 0.85, 0.88)),
    P_('Matte clay', Lt([-0.6, 0.5, 0.62], [1, 0.97, 0.93], 1.1, 0.25), { color: [0.55, 0.55, 0.6], intensity: 0.45 }, { color: [1, 1, 1], intensity: 0, width: 0.3 }, mat([0.72, 0.65, 0.58], 0.05, 0.1)),
    P_('Plaster cast', Lt([-0.7, 0.55, 0.45], [1, 0.97, 0.92], 1.15, 0.15), { color: [0.5, 0.52, 0.58], intensity: 0.3 }, { color: [1, 1, 1], intensity: 0, width: 0.3 }, mat([0.86, 0.84, 0.8], 0.08, 0.2)),
    P_('Anime cel', Lt([-0.55, 0.6, 0.58], [1, 0.97, 0.93], 1.15, 0.1, 2, 0.08), { color: [0.6, 0.42, 0.66], intensity: 0.55 }, { color: [1, 0.9, 0.8], intensity: 0, width: 0.3 }, mat([1, 0.8, 0.72], 0.45, 0.62)),
    P_('Neon rim night', Lt([0.5, 0.7, 0.5], [0.5, 0.62, 1], 0.55, 0.1), { color: [0.15, 0.08, 0.3], intensity: 0.45 }, { color: [1, 0.2, 0.8], intensity: 1.25, width: 0.45 }, mat([0.62, 0.62, 0.72], 0.5, 0.6)),
    P_('Sunset', Lt([-0.85, 0.15, 0.5], [1, 0.58, 0.3], 1.45, 0.25), { color: [0.3, 0.32, 0.72], intensity: 0.5 }, { color: [1, 0.78, 0.5], intensity: 0.45, width: 0.35 }, mat([0.85, 0.8, 0.75], 0.3, 0.45)),
    P_('Overcast', Lt([-0.2, 0.9, 0.35], [0.92, 0.95, 1], 0.7, 0.6), { color: [0.7, 0.74, 0.8], intensity: 0.75 }, { color: [1, 1, 1], intensity: 0, width: 0.3 }, mat([0.8, 0.72, 0.66], 0.15, 0.3)),
    P_('Campfire', Lt([0.3, -0.45, 0.85], [1, 0.5, 0.18], 1.6, 0.2), { color: [0.12, 0.14, 0.3], intensity: 0.35 }, { color: [0.4, 0.55, 1], intensity: 0.35, width: 0.3 }, mat([0.9, 0.7, 0.6], 0.3, 0.45, 0, 0.5)),
  ];

  L.render = {
    VIEW, RS, EMAX, render, renderGen, pick, ramp, families, prepare, lightFromHandle, handleFromLight, defaultState, presets,
    setups, views, kelvin, shadowTemp, dirAE, isMesh: (m) => !!MESHES[m], isRigged: (m) => !!(MESHES[m] && MESHES[m].skinned && L.meshData && L.meshData[m]), rigOf,
    poses: POSES, poseJoints: ['head', 'neck', 'chest', 'spine', 'hips', 'arm_l', 'elbow_l', 'wrist_l', 'arm_r', 'elbow_r', 'wrist_r', 'thigh_l', 'knee_l', 'ankle_l', 'thigh_r', 'knee_r', 'ankle_r'],
    jointPos: (m, pose, sem) => { const K = skinBase(m), ms = posed(m, pose); return K && ms ? ms.joint(K.rig.sem[sem] || sem) : null; },
    models: ['sphere', 'head', 'headF', 'skull', 'bodyF', 'bodyM', 'heroF', 'heroM', 'egg', 'cube', 'cylinder', 'cone', 'torus', 'drape', 'blob'],
    modelRot: { bodyF: { yaw: 0.35, pitch: 0.04 }, bodyM: { yaw: 0.35, pitch: 0.04 }, heroF: { yaw: 0.35, pitch: 0.04 }, heroM: { yaw: 0.35, pitch: 0.04 }, head: { yaw: 0.45, pitch: 0.06 }, headF: { yaw: 0.45, pitch: 0.06 }, skull: { yaw: 0.5, pitch: 0.05 }, drape: { yaw: 0.35, pitch: 0.1 }, egg: { yaw: 0, pitch: 0.2 } },
  };
})((window.Yekta = window.Yekta || {}));
