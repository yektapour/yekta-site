// Yekta Light: self-collision. Each bone gets a few spheres fitted to the skin it moves (k-means on
// the vertices it owns). Spheres live in bone space, so they follow any pose. A pose change that pushes
// body parts deeper into each other is stopped at the point of contact (see app.js: guarded()).
import { Vector3, Matrix4 } from './vendor/three.module.js';

const COUNT = (name) => (/^(thumb|index|middle|ring|pinky)_/.test(name) ? 1 : /Hips|Spine/.test(name) ? 9 : /Head/.test(name) ? 5 : /UpLeg/.test(name) ? 5 : /Shoulder|neck|ToeBase/.test(name) ? 2 : /end|front/.test(name) ? 0 : 3);

export class Collider {
  constructor(rig, mesh) {
    this.rig = rig;
    const g = mesh.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const bones = mesh.skeleton.bones;
    // skinned vertices in world space (current pose), grouped by their main bone
    mesh.updateMatrixWorld(true); mesh.skeleton.update();
    const groups = bones.map(() => []), v = new Vector3();
    const step = Math.max(1, Math.floor(pos.count / 60000));
    for (let i = 0; i < pos.count; i += step) {
      let bj = 0, bw = -1;
      for (let c = 0; c < 4; c++) { const w = sw.getComponent(i, c); if (w > bw) { bw = w; bj = si.getComponent(i, c); } }
      if (bw < 0.5) continue;
      v.fromBufferAttribute(pos, i); mesh.applyBoneTransform(i, v); v.applyMatrix4(mesh.matrixWorld);
      groups[bj].push(v.x, v.y, v.z);
    }
    this.spheres = []; // { bone, local: Vector3, r, w: Vector3 }
    bones.forEach((bone, j) => {
      const P = groups[j], n = P.length / 3, k = Math.min(COUNT(bone.name), Math.floor(n / 25));
      if (k < 1) return;
      const pt = (i) => new Vector3(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
      // farthest-point init + k-means
      const C = [pt(0)];
      while (C.length < k) { let bi = 0, bd = -1; for (let i = 0; i < n; i += 3) { const p = pt(i); const d = Math.min(...C.map((c) => c.distanceToSquared(p))); if (d > bd) { bd = d; bi = i; } } C.push(pt(bi)); }
      const lab = new Int32Array(n);
      for (let it = 0; it < 10; it++) {
        const S = C.map(() => [0, 0, 0, 0]);
        for (let i = 0; i < n; i++) { const p = pt(i); let bc = 0, bd = Infinity; C.forEach((c, ci) => { const d = c.distanceToSquared(p); if (d < bd) { bd = d; bc = ci; } }); lab[i] = bc; const s = S[bc]; s[0] += p.x; s[1] += p.y; s[2] += p.z; s[3]++; }
        S.forEach((s, ci) => { if (s[3]) C[ci].set(s[0] / s[3], s[1] / s[3], s[2] / s[3]); });
      }
      const toLocal = bone.matrixWorld.clone().invert();
      // bone axis: joint -> main child joint (leaf bones: extend along the parent direction)
      const A = new Vector3().setFromMatrixPosition(bone.matrixWorld);
      const kids = bone.children.filter((o) => o.isBone && !/end|front/.test(o.name));
      let E;
      if (kids.length) { E = new Vector3(); kids.forEach((o) => E.add(new Vector3().setFromMatrixPosition(o.matrixWorld))); E.multiplyScalar(1 / kids.length); }
      else { const pp = new Vector3().setFromMatrixPosition(bone.parent.matrixWorld); E = A.clone().add(A.clone().sub(pp).multiplyScalar(0.6)); }
      const ax = E.clone().sub(A), L2 = Math.max(1e-9, ax.lengthSq());
      const onAxis = (p) => A.clone().addScaledVector(ax, Math.max(-0.1, Math.min(1.1, p.clone().sub(A).dot(ax) / L2)));
      C.forEach((c, ci) => {
        const d = []; for (let i = 0; i < n; i++) if (lab[i] === ci) d.push(pt(i));
        if (d.length < 8) return;
        // spheres sit inside the body: from the bone axis toward this patch of skin
        const a = onAxis(c), dist = d.map((p) => p.distanceTo(onAxis(p))).sort((x, y) => x - y), surf = dist[Math.floor(dist.length * 0.5)];
        const off = c.distanceTo(a);
        let center, r;
        if (off < surf * 0.35) { center = a; r = surf * 0.92; }
        else { center = a.clone().addScaledVector(c.clone().sub(a).normalize(), surf * 0.45); r = surf * 0.55; }
        this.spheres.push({ bone, local: center.applyMatrix4(toLocal), r, w: new Vector3() });
      });
    });
    // pairs to test: skip a bone against itself, its close relatives, and finger / hand parts of the same hand
    const depth = new Map(), up = (b) => (b.parent && b.parent.isBone ? b.parent : null);
    const near = (a, b) => {
      for (let x = a, k = 0; x && k <= 2; x = up(x), k++) if (x === b) return true;
      for (let x = b, k = 0; x && k <= 2; x = up(x), k++) if (x === a) return true;
      const pa = up(a), pb = up(b); if (pa && pa === pb && /Shoulder|neck/.test(a.name + b.name)) return true;
      const hand = (x) => { for (; x; x = up(x)) if (/Hand$/.test(x.name)) return x; return null; };
      const ha = hand(a); if (ha && ha === hand(b)) return true;
      return false;
    };
    void depth;
    const sp = this.spheres;
    this.pairs = [];
    for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) if (!near(sp[i].bone, sp[j].bone)) this.pairs.push([i, j, 0]);
    // overlap that already exists in the neutral pose is allowed (soft tissue touching at rest)
    this.update();
    this.pairs.forEach((p) => { p[2] = Math.max(0, this.overlap(p[0], p[1])); });
  }
  update() { for (const s of this.spheres) s.w.copy(s.local).applyMatrix4(s.bone.matrixWorld); }
  overlap(i, j) { const a = this.spheres[i], b = this.spheres[j]; return a.r + b.r - a.w.distanceTo(b.w); }
  // total extra penetration of the current pose (bones must be updated)
  pen() {
    this.update();
    let t = 0;
    for (const [i, j, allow] of this.pairs) { const o = this.overlap(i, j) - allow; if (o > 0.002) t += o; }
    return t;
  }
  // push a point (with radius) out of every sphere whose bone is not in skip
  pushOut(p, r, skip) {
    this.update();
    for (let it = 0; it < 4; it++) {
      let moved = false;
      for (const s of this.spheres) {
        if (skip.has(s.bone)) continue;
        const d = p.distanceTo(s.w), m = s.r + r;
        if (d < m) { const dir = d > 1e-6 ? p.clone().sub(s.w).normalize() : new Vector3(0, 0, 1); p.copy(s.w).addScaledVector(dir, m); moved = true; }
      }
      if (!moved) break;
    }
    return p;
  }
}
