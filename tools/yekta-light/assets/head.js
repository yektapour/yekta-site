// Yekta Light: expressive heads (ICT-FaceKit, MIT) with swappable hair and eyebrows (MakeHuman assets).
// Hair and eyebrows follow the face: each of their vertices rides on the nearest skin vertex's expression offset.
import * as THREE from './vendor/three.module.js';

const HB = '/tools/yekta-light/assets/heads/';
const P2 = (k) => [k + '_L', k + '_R'];

// facial controls shown to the user (pairs are driven together unless asymmetric)
export const CONTROLS = [
  ['Brows', [['Inner up', 'browInnerUp', 1], ['Outer up', 'browOuterUp', 1], ['Down / frown', 'browDown', 1]]],
  ['Eyes', [['Blink', 'eyeBlink', 1], ['Wide', 'eyeWide', 1], ['Squint', 'eyeSquint', 1]]],
  ['Cheeks & nose', [['Cheek raise', 'cheekSquint', 1], ['Puff', 'cheekPuff', 1], ['Nose sneer', 'noseSneer', 1]]],
  ['Mouth', [['Smile', 'mouthSmile', 1], ['Frown', 'mouthFrown', 1], ['Dimple', 'mouthDimple', 1], ['Stretch', 'mouthStretch', 1], ['Press', 'mouthPress', 1], ['Upper lip up', 'mouthUpperUp', 1], ['Lower lip down', 'mouthLowerDown', 1], ['Pucker', 'mouthPucker', 0], ['Funnel', 'mouthFunnel', 0], ['Roll lips in', 'mouthRollLower', 0], ['Shrug lower', 'mouthShrugLower', 0], ['Mouth left', 'mouthLeft', 0], ['Mouth right', 'mouthRight', 0]]],
  ['Jaw', [['Open', 'jawOpen', 0], ['Forward', 'jawForward', 0], ['Left', 'jawLeft', 0], ['Right', 'jawRight', 0]]],
];

const pair = (o, k, v) => { o[k + '_L'] = v; o[k + '_R'] = v; return o; };
const E = (spec) => { const o = {}; for (const [k, v] of Object.entries(spec)) { if (/^(jaw|mouthFunnel|mouthPucker|mouthRoll|mouthShrug|mouthClose|mouthLeft|mouthRight)/.test(k)) o[k] = v; else pair(o, k, v); } return o; };
export const EXPRESSIONS = {
  Neutral: {},
  Smile: E({ mouthSmile: 0.65, cheekSquint: 0.35, eyeSquint: 0.2, mouthDimple: 0.2 }),
  Joy: E({ mouthSmile: 1, cheekSquint: 0.7, eyeSquint: 0.45, jawOpen: 0.1, mouthUpperUp: 0.25, mouthDimple: 0.3 }),
  Laugh: E({ mouthSmile: 1, cheekSquint: 1, eyeSquint: 0.8, jawOpen: 0.45, mouthUpperUp: 0.5, browInnerUp: 0.3 }),
  Sadness: E({ browInnerUp: 0.9, browDown: 0.25, mouthFrown: 0.8, mouthShrugLower: 0.45, eyeSquint: 0.2, eyeLookDown: 0.25, eyeBlink: 0.15 }),
  Crying: E({ browInnerUp: 1, browDown: 0.35, eyeSquint: 0.7, cheekSquint: 0.5, mouthFrown: 0.9, mouthStretch: 0.5, jawOpen: 0.25, mouthShrugLower: 0.6, noseSneer: 0.3 }),
  Anger: E({ browDown: 1, eyeSquint: 0.5, noseSneer: 0.7, mouthPress: 0.5, mouthUpperUp: 0.3, mouthFrown: 0.4, eyeWide: 0.2 }),
  Rage: E({ browDown: 1, eyeWide: 0.5, noseSneer: 1, mouthUpperUp: 0.9, mouthStretch: 0.6, jawOpen: 0.35, mouthLowerDown: 0.6 }),
  Fear: E({ browInnerUp: 1, browOuterUp: 0.4, eyeWide: 1, mouthStretch: 0.75, jawOpen: 0.25, browDown: 0.2 }),
  Surprise: E({ browInnerUp: 1, browOuterUp: 1, eyeWide: 0.9, jawOpen: 0.55, mouthFunnel: 0.25 }),
  Disgust: E({ noseSneer: 1, mouthUpperUp: 0.7, browDown: 0.6, eyeSquint: 0.55, mouthFrown: 0.35, cheekSquint: 0.4 }),
  Contempt: Object.assign(E({ eyeSquint: 0.2, browDown: 0.15 }), { mouthSmile_L: 0.7, mouthDimple_L: 0.5, cheekSquint_L: 0.3, mouthPress_R: 0.3 }),
  Thinking: Object.assign(E({ browDown: 0.35, eyeSquint: 0.3, mouthPress: 0.35, eyeLookUp: 0.35 }), { browOuterUp_R: 0.4, mouthLeft: 0.3 }),
  Doubt: Object.assign(E({ mouthPress: 0.5, mouthFrown: 0.2 }), { browOuterUp_L: 0.8, browDown_R: 0.6, eyeSquint_R: 0.4, mouthLeft: 0.2 }),
  Smirk: Object.assign(E({}), { mouthSmile_R: 0.8, cheekSquint_R: 0.35, eyeSquint_R: 0.2, mouthDimple_R: 0.4, mouthRight: 0.2 }),
  Sleepy: E({ eyeBlink: 0.6, browInnerUp: 0.2, jawOpen: 0.05, mouthShrugLower: 0.15 }),
  Pain: E({ browDown: 0.8, browInnerUp: 0.6, eyeSquint: 0.9, eyeBlink: 0.4, noseSneer: 0.6, mouthStretch: 0.8, mouthUpperUp: 0.5, jawOpen: 0.15 }),
  Scream: E({ browInnerUp: 1, eyeWide: 0.8, jawOpen: 1, mouthStretch: 0.7, mouthFunnel: 0.2 }),
  Kiss: E({ mouthPucker: 1, mouthFunnel: 0.2, eyeBlink: 0.5 }),
};
EXPRESSIONS.Wink = Object.assign(E({ mouthSmile: 0.3 }), { eyeBlink_L: 1, cheekSquint_L: 0.6, mouthSmile_L: 0.8 });

export function faceWeights(f) {
  const out = {};
  const add = (o, k) => { for (const n in o) out[n] = (out[n] || 0) + o[n] * k; };
  add(EXPRESSIONS[f.expr] || {}, f.amt == null ? 1 : f.amt);
  if (f.mix && EXPRESSIONS[f.mix]) add(EXPRESSIONS[f.mix], f.mixAmt || 0);
  for (const k in f.custom || {}) {
    const v = f.custom[k]; if (!v) continue;
    if (/_[LR]$/.test(k) || !/^(brow(InnerUp|OuterUp|Down)|eye(Blink|Wide|Squint|LookUp|LookDown)|cheek(Squint|Puff)|noseSneer|mouth(Smile|Frown|Dimple|Stretch|Press|UpperUp|LowerDown))$/.test(k)) out[k] = (out[k] || 0) + v;
    else { const [a, b] = P2(k); const s = f.asym || 0; out[a] = (out[a] || 0) + v * (1 + s); out[b] = (out[b] || 0) + v * (1 - s); }
  }
  const [lx, ly] = f.look || [0, 0];
  if (lx > 0) { out.eyeLookOut_L = (out.eyeLookOut_L || 0) + lx; out.eyeLookIn_R = (out.eyeLookIn_R || 0) + lx; }
  if (lx < 0) { out.eyeLookIn_L = (out.eyeLookIn_L || 0) - lx; out.eyeLookOut_R = (out.eyeLookOut_R || 0) - lx; }
  if (ly > 0) { out.eyeLookUp_L = (out.eyeLookUp_L || 0) + ly * 0.8; out.eyeLookUp_R = (out.eyeLookUp_R || 0) + ly * 0.8; }
  if (ly < 0) { out.eyeLookDown_L = (out.eyeLookDown_L || 0) - ly * 0.5; out.eyeLookDown_R = (out.eyeLookDown_R || 0) - ly * 0.5; }
  if (f.blink) { out.eyeBlink_L = (out.eyeBlink_L || 0) + f.blink; out.eyeBlink_R = (out.eyeBlink_R || 0) + f.blink; }
  for (const k in out) out[k] = Math.max(0, Math.min(1, out[k]));
  return out;
}

// nearest source vertex for each attached vertex (uniform grid)
function nearestMap(src, pts) {
  const cs = 0.006, grid = new Map(), key = (x, y, z) => `${Math.floor(x / cs)},${Math.floor(y / cs)},${Math.floor(z / cs)}`;
  for (let i = 0; i < src.length; i += 3) { const k = key(src[i], src[i + 1], src[i + 2]); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(i / 3); }
  const out = new Int32Array(pts.length / 3);
  // coarse fallback set for points far from the skin (long hair, braids)
  const step = Math.max(1, Math.floor(src.length / 3 / 1500)), coarse = [];
  for (let i = 0; i < src.length / 3; i += step) coarse.push(i);
  for (let j = 0; j < pts.length; j += 3) {
    const x = pts[j], y = pts[j + 1], z = pts[j + 2], gx = Math.floor(x / cs), gy = Math.floor(y / cs), gz = Math.floor(z / cs);
    let best = -1, bd = Infinity;
    for (let r = 1; r <= 3 && best < 0; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        const a = grid.get(`${gx + dx},${gy + dy},${gz + dz}`); if (!a) continue;
        for (const i of a) { const d = (src[i * 3] - x) ** 2 + (src[i * 3 + 1] - y) ** 2 + (src[i * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = i; } }
      }
    }
    if (best < 0) for (const i of coarse) { const d = (src[i * 3] - x) ** 2 + (src[i * 3 + 1] - y) ** 2 + (src[i * 3 + 2] - z) ** 2; if (d < bd) { bd = d; best = i; } }
    out[j / 3] = Math.max(0, best);
  }
  return out;
}

export class Head {
  constructor(gltf, makeMat) {
    this.root = gltf.scene; this.makeMat = makeMat;
    this.meshes = []; this.skin = null;
    this.root.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; this.meshes.push(o); if (o.material.name === 'M_Face') this.skin = o; } });
    this.root.updateMatrixWorld(true);
    // source surface for attachments: face + back of head
    const parts = this.meshes.filter((m) => /M_Face|M_BackHead/.test(m.material.name));
    this.parts = parts.map((m) => ({ mesh: m, pos: m.geometry.attributes.position.array, morph: m.geometry.morphAttributes.position || [] }));
    const tot = this.parts.reduce((s, p) => s + p.pos.length, 0), all = new Float32Array(tot);
    this.partOf = new Int32Array(tot / 3); this.idxIn = new Int32Array(tot / 3);
    let o = 0; this.parts.forEach((p, pi) => { all.set(p.pos, o); for (let i = 0; i < p.pos.length / 3; i++) { this.partOf[o / 3 + i] = pi; this.idxIn[o / 3 + i] = i; } o += p.pos.length; });
    this.srcAll = all;
    this.names = this.skin.morphTargetDictionary;
    const box = new THREE.Box3(); parts.forEach((m) => box.expandByObject(m)); this.box = box;
    this.center = box.getCenter(new THREE.Vector3());
    this.attached = {};
    this.weights = {};
  }
  attach(slot, mesh) {
    if (this.attached[slot]) { this.root.remove(this.attached[slot].mesh); this.attached[slot].mesh.geometry.dispose(); }
    if (!mesh) { delete this.attached[slot]; return; }
    mesh.updateMatrixWorld(true);
    const g = mesh.geometry, base = g.attributes.position.array.slice();
    const map = nearestMap(this.srcAll, base);
    this.attached[slot] = { mesh, base, map };
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    this.root.add(mesh);
    this.follow(slot);
  }
  // darken / tint the scalp under the hair so the hairline reads as hair, not as a hard edge
  // Scalp cap: a hair-coloured layer on the skin under the hair (fills gaps between hair cards).
  // Coverage per skin vertex = hair present just above it; smoothed over the skin, soft (dithered) edge.
  buildCap(hairMesh) {
    const res = { geo: null };
    if (!hairMesh) return null;
    const hp = hairMesh.geometry.attributes.position.array, cs = 0.006, grid = new Map(), key = (x, y, z) => `${Math.floor(x / cs)},${Math.floor(y / cs)},${Math.floor(z / cs)}`;
    for (let i = 0; i < hp.length; i += 3) { const k = key(hp[i], hp[i + 1], hp[i + 2]); let a = grid.get(k); if (!a) grid.set(k, (a = [])); if (a.length < 24) a.push(i); }
    const parts = this.parts, outPos = [], outIdx = [], outA = [], outSrc = [];
    const scl = this.meshes.filter((m) => /Sclera/.test(m.material.name)), eb = new THREE.Box3(); scl.forEach((m) => eb.expandByObject(m));
    const eyeY = eb.getCenter(new THREE.Vector3()).y, cz = this.center.z;
    for (let pi = 0; pi < parts.length; pi++) {
      const p = parts[pi], g = p.mesh.geometry, pos = p.pos, na = g.attributes.normal, n = pos.length / 3;
      const cov = new Float32Array(n), allow = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        let nx = na.getX(i), ny = na.getY(i), nz = na.getZ(i); const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        const gx = Math.floor(x / cs), gy = Math.floor(y / cs), gz = Math.floor(z / cs); let hit = 0;
        for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1 && !hit; dy++) for (let dz = -1; dz <= 1 && !hit; dz++) {
          const a = grid.get(`${gx + dx},${gy + dy},${gz + dz}`); if (!a) continue;
          for (const j of a) { const ox = hp[j] - x, oy = hp[j + 1] - y, oz = hp[j + 2] - z, up = ox * nx + oy * ny + oz * nz; if (up > -0.001 && up < 0.03 && ox * ox + oy * oy + oz * oz - up * up < 0.0045 * 0.0045) { hit = 1; break; } }
        }
        // scalp only: above the ears on the sides, lower only at the back of the head
        const ok = y > eyeY + 0.03 || (z < cz - 0.035 && y > eyeY - 0.05);
        cov[i] = hit && ok ? 1 : 0; allow[i] = ok ? 1 : 0;
      }
      // morphological closing over mesh adjacency: fills holes in the hair without growing past the hairline
      const idx = g.index.array, nbS = new Float32Array(n), nbC = new Float32Array(n);
      const adj = Array.from({ length: n }, () => []);
      for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = idx[t + e], bb = idx[t + (e + 1) % 3]; adj[a].push(bb); adj[bb].push(a); }
      const step = (src, dil) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) { let v = src[i]; for (const j of adj[i]) v = dil ? Math.max(v, src[j]) : Math.min(v, src[j]); o[i] = v; } return o; };
      let c = cov; for (let it = 0; it < 7; it++) c = step(c, true); for (let it = 0; it < 7; it++) c = step(c, false);
      for (let i = 0; i < n; i++) if (!allow[i]) c[i] = 0;
      for (let it = 0; it < 3; it++) {
        nbS.fill(0); nbC.fill(0);
        for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = idx[t + e], bb = idx[t + (e + 1) % 3]; nbS[a] += c[bb]; nbC[a]++; nbS[bb] += c[a]; nbC[bb]++; }
        const nc = new Float32Array(n); for (let i = 0; i < n; i++) nc[i] = nbC[i] ? (c[i] + nbS[i] / nbC[i]) / 2 : c[i]; c = nc;
      }
      const sm = (v) => { const t = Math.min(1, Math.max(0, (v - 0.12) / 0.33)); return t * t * (3 - 2 * t); };
      const base = outPos.length / 3, remap = new Int32Array(n).fill(-1);
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t], bb = idx[t + 1], cc = idx[t + 2];
        if (c[a] < 0.08 && c[bb] < 0.08 && c[cc] < 0.08) continue;
        for (const v of [a, bb, cc]) if (remap[v] < 0) {
          remap[v] = outPos.length / 3;
          const nx = na.getX(v), ny = na.getY(v), nz = na.getZ(v), nl = Math.hypot(nx, ny, nz) || 1;
          outPos.push(pos[v * 3] + nx / nl * 0.0006, pos[v * 3 + 1] + ny / nl * 0.0006, pos[v * 3 + 2] + nz / nl * 0.0006);
          outA.push(sm(c[v])); outSrc.push(v);
        }
        outIdx.push(remap[a], remap[bb], remap[cc]);
      }
      void base;
    }
    if (!outIdx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
    const cols = new Float32Array(outA.length * 4); outA.forEach((a, i) => { cols[i * 4] = cols[i * 4 + 1] = cols[i * 4 + 2] = 1; cols[i * 4 + 3] = a; });
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 4));
    geo.setIndex(outIdx); geo.computeVertexNormals();
    res.geo = geo; void outSrc;
    return geo;
  }
  setWeights(w) {
    this.weights = w;
    for (const m of this.meshes) { const inf = m.morphTargetInfluences, d = m.morphTargetDictionary; if (!inf) continue; inf.fill(0); for (const k in w) { const i = d[k]; if (i != null) inf[i] = w[k]; } }
    for (const s in this.attached) this.follow(s);
  }
  follow(slot) {
    const A = this.attached[slot], pos = A.mesh.geometry.attributes.position, out = pos.array, n = out.length / 3;
    const act = Object.entries(this.weights).filter(([k, v]) => v > 1e-3 && this.names[k] != null).map(([k, v]) => [this.names[k], v]);
    if (!act.length) { out.set(A.base); pos.needsUpdate = true; return; }
    const cache = new Map();
    for (let i = 0; i < n; i++) {
      const g = A.map[i];
      let d = cache.get(g);
      if (!d) {
        const p = this.parts[this.partOf[g]], j = this.idxIn[g]; d = [0, 0, 0];
        for (const [t, v] of act) { const m = p.morph[t]; if (!m) continue; d[0] += m.array[j * 3] * v; d[1] += m.array[j * 3 + 1] * v; d[2] += m.array[j * 3 + 2] * v; }
        cache.set(g, d);
      }
      out[i * 3] = A.base[i * 3] + d[0]; out[i * 3 + 1] = A.base[i * 3 + 1] + d[1]; out[i * 3 + 2] = A.base[i * 3 + 2] + d[2];
    }
    pos.needsUpdate = true;
  }
}

export const headUrl = (g) => `${HB}head${g}.glb`;
export const partUrl = (kind, id, g) => `${HB}${kind}/${id}_${g}.glb`;
export const texUrl = (id, n) => `${HB}tex/${id}${n ? '_n' : ''}.webp`;
export const thumbUrl = (id) => `${HB}thumbs/${id}.webp`;
export const eyeUrl = (c) => `${HB}eyes/${c}.webp`;
export const catalogUrl = `${HB}catalog.json`;
