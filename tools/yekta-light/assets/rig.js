// Yekta Light: character rig. Every bone of the skeleton is posable.
//  Body bones use the body frame: Bend = natural flexion, Turn = twist around the vertical axis, Tilt = sideways.
//  Finger bones use the finger frame: Bend = curl toward the palm, Turn = spread, Tilt = twist.
//  Left / right values are mirrored, so the same numbers give a symmetric pose.
//  Move is done with IK: two-bone solver for arms / legs, CCD for spine, neck, toes and fingers.
import { Quaternion, Vector3, Euler, Matrix4 } from './vendor/three.module.js';

export const BONES = {
  hips: 'Hips', spine: 'Spine01', chest: 'Spine', neck: 'neck', head: 'Head',
  shoulder_l: 'LeftShoulder', arm_l: 'LeftArm', elbow_l: 'LeftForeArm', wrist_l: 'LeftHand',
  shoulder_r: 'RightShoulder', arm_r: 'RightArm', elbow_r: 'RightForeArm', wrist_r: 'RightHand',
  thigh_l: 'LeftUpLeg', knee_l: 'LeftLeg', ankle_l: 'LeftFoot', toe_l: 'LeftToeBase',
  thigh_r: 'RightUpLeg', knee_r: 'RightLeg', ankle_r: 'RightFoot', toe_r: 'RightToeBase',
};
export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const BODYLABEL = { head: 'Head', neck: 'Neck', chest: 'Chest', spine: 'Spine', hips: 'Hips', shoulder: 'shoulder', arm: 'upper arm', elbow: 'elbow', wrist: 'wrist', thigh: 'thigh', knee: 'knee', ankle: 'ankle', toe: 'toes' };
export function labelOf(key) {
  const side = /_l$/.test(key) ? 'L ' : /_r$/.test(key) ? 'R ' : '';
  const m = key.match(/^(thumb|index|middle|ring|pinky)_0(\d)_[lr]$/);
  if (m) return `${side}${m[1]} ${m[2]}`;
  return side + BODYLABEL[key.replace(/_[lr]$/, '')];
}
// flexion sign per body joint type (positive Bend = the way the joint naturally bends)
const FLEX = { arm: -1, elbow: -1, wrist: -1, shoulder: -1, thigh: -1, ankle: -1, toe: -1, knee: 1, hips: 1, spine: 1, chest: 1, neck: 1, head: 1 };
// anatomical limits in degrees: [bend], [turn], [tilt]
export const LIMITS = {
  head: [[-45, 50], [-75, 75], [-35, 35]], neck: [[-35, 40], [-45, 45], [-25, 25]],
  chest: [[-30, 40], [-40, 40], [-30, 30]], spine: [[-30, 45], [-35, 35], [-25, 25]], hips: [[-90, 90], [-180, 180], [-60, 60]],
  shoulder: [[-25, 25], [-25, 25], [-15, 35]],
  arm: [[-70, 180], [-90, 90], [-40, 175]], elbow: [[-10, 155], [-90, 90], [-130, 130]], wrist: [[-80, 80], [-60, 60], [-45, 45]],
  thigh: [[-45, 125], [-50, 50], [-45, 70]], knee: [[0, 150], [-25, 25], [-10, 10]], ankle: [[-45, 50], [-30, 30], [-25, 25]],
  toe: [[-40, 60], [-15, 15], [-10, 10]],
  finger: [[-25, 110], [-30, 30], [-20, 20]], thumb: [[-40, 90], [-45, 45], [-40, 40]],
};
const typeOf = (key) => { const m = key.match(/^(thumb|index|middle|ring|pinky)_/); return m ? (m[1] === 'thumb' ? 'thumb' : 'finger') : key.replace(/_[lr]$/, ''); };
export const limitsOf = (key) => LIMITS[typeOf(key)] || [[-90, 90], [-90, 90], [-90, 90]];
export const clampSem = (key, e) => limitsOf(key).map(([a, b], i) => Math.round(Math.max(a, Math.min(b, e[i] || 0))));

const D2R = Math.PI / 180;
const qAxis = (ax, deg) => new Quaternion().setFromAxisAngle(new Vector3(...ax).normalize(), deg * D2R);
const wp = (b) => b.getWorldPosition(new Vector3());
const wq = (b) => b.getWorldQuaternion(new Quaternion());
const ID = new Quaternion();

export class Rig {
  constructor(root, opts = {}) {
    this.root = root;
    this.bones = {};
    root.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.all = Object.values(this.bones);
    this.fused = new Set(opts.fused || []);
    root.updateMatrixWorld(true);
    this.rest = new Map(this.all.map((b) => [b, b.quaternion.clone()]));
    const B = (key) => this.bones[BONES[key] || key];
    this.B = B;
    this.leftX = Math.sign(wp(B('arm_l')).x - wp(B('arm_r')).x) || 1;
    // common baseline: upper arms ~22deg from the body
    this.base = new Map();
    const armDeg = (s) => { const d = wp(B('elbow_' + s)).sub(wp(B('arm_' + s))).normalize(); return Math.acos(Math.max(-1, Math.min(1, -d.y))) / D2R; };
    const lx = this.leftX;
    for (const [s, sg] of [['l', -1], ['r', 1]]) {
      const b = B('arm_' + s), Wr = wq(b), Rw = qAxis([0, 0, 1], sg * lx * (armDeg(s) - 22));
      this.base.set(b, Wr.clone().invert().multiply(Rw).multiply(Wr));
    }
    this.all.forEach((b) => { b.quaternion.copy(this.rest.get(b)); if (this.base.has(b)) b.quaternion.multiply(this.base.get(b)); });
    root.updateMatrixWorld(true);
    this.Rb = new Map(this.all.map((b) => [b, wq(b)]));
    // finger frames, measured in the baseline pose
    this.fingers = {};
    this.frame = {}; // key -> { B: Quaternion (frame -> world), s: [signs] }
    for (const sfx of ['_l', '_r']) {
      const pj = (n) => wp(this.bones[n + sfx]);
      if (!this.bones['index_01' + sfx]) continue;
      const across = pj('index_01').sub(pj('pinky_01')).normalize();
      const handDir = pj('middle_01').sub(wp(B('wrist' + sfx))).normalize();
      const pn = new Vector3().crossVectors(handDir, across).normalize();
      const knC = pj('index_01').add(pj('pinky_01')).multiplyScalar(0.5);
      if (pj('thumb_03').sub(knC).dot(pn) < 0) pn.negate();
      const side = sfx === '_l' ? 1 : -1;
      for (const f of FINGERS) {
        const d = pj(f + '_03').sub(pj(f + '_01')).normalize();
        const ax = new Vector3().crossVectors(d, pn).normalize();
        if (new Vector3().crossVectors(ax, d).dot(pn) < 0) ax.negate();
        let sg = 0;
        if (f !== 'middle' && f !== 'thumb') { const mv = new Vector3().crossVectors(pn, d), off = pj(f + '_01').sub(pj('middle_01')); sg = Math.sign(mv.dot(off)); }
        this.fingers[f + sfx] = { curl: ax.toArray(), spread: pn.toArray(), sg, joints: [1, 2, 3].map((k) => this.bones[`${f}_0${k}${sfx}`]) };
        // orthonormal frame: x = curl axis, z = along the finger, y = z cross x
        const y = new Vector3().crossVectors(d, ax).normalize(), z = new Vector3().crossVectors(ax, y).normalize();
        const Bq = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(ax, y, z));
        for (let k = 1; k <= 3; k++) this.frame[`${f}_0${k}${sfx}`] = { B: Bq, s: [1, sg || side, side] };
      }
    }
    // controllable keys: body joints + every finger bone
    this.keys = Object.keys(BONES).filter((k) => B(k)).concat(Object.keys(this.frame).filter((k) => this.bones[k]));
    this.keyOfBone = new Map();
    this.keys.forEach((k) => this.keyOfBone.set(B(k), k));
    // skeleton lines: every bone to its parent bone
    this.links = this.all.filter((b) => b.parent && b.parent.isBone).map((b) => [b.parent, b]);
    this.restLen = new Map(this.all.map((b) => [b, b.position.length()]));
  }
  // nearest controllable key for any bone (end bones map to their parent)
  keyFor(bone) { let b = bone; while (b && b.isBone) { const k = this.keyOfBone.get(b); if (k) return k; b = b.parent; } return 'hips'; }

  // semantic euler (degrees) -> world-frame delta quaternion, and back
  frameOf(key) {
    if (this.frame[key]) return this.frame[key];
    const base = typeOf(key), side = /_l$/.test(key) ? 1 : /_r$/.test(key) ? -1 : 0, lx = this.leftX;
    return { B: ID, s: [FLEX[base] || 1, side ? side * lx : lx, side ? side * lx : -lx] };
  }
  bodyDelta(key, e) {
    const F = this.frameOf(key);
    const E = new Quaternion().setFromEuler(new Euler(e[0] * F.s[0] * D2R, e[1] * F.s[1] * D2R, e[2] * F.s[2] * D2R, 'YXZ'));
    return F.B.clone().multiply(E).multiply(F.B.clone().invert());
  }
  semFromDelta(key, q) {
    const F = this.frameOf(key);
    const E = F.B.clone().invert().multiply(q).multiply(F.B);
    const e = new Euler().setFromQuaternion(E, 'YXZ');
    return [e.x / D2R / F.s[0], e.y / D2R / F.s[1], e.z / D2R / F.s[2]];
  }
  // delta that the hand sliders (curl / spread / thumb / per-finger) give a finger bone
  handDeltas(pose) {
    const out = new Map();
    for (const key in this.fingers) {
      const F = this.fingers[key], side = key.slice(-1), h = pose.f && pose.f[side]; if (!h) continue;
      const name = key.slice(0, -2), isThumb = name === 'thumb';
      const curl = (isThumb ? h.thumb : h.curl) + ((h.fc && h.fc[name]) || 0);
      const spread = isThumb ? 0 : h.spread * ({ index: 1, middle: 0.25, ring: 0.6, pinky: 1.1 }[name]) * F.sg * (this.fused.has(key) ? 0.2 : 1);
      const share = isThumb ? [0.45, 0.8, 0.75] : [0.85, 1.1, 0.75];
      F.joints.forEach((b, i) => {
        if (!b) return;
        let q = curl ? qAxis(F.curl, curl * share[i]) : null;
        if (i === 0 && spread) q = q ? q.multiply(qAxis(F.spread, spread)) : qAxis(F.spread, spread);
        if (q) out.set(b, q);
      });
    }
    return out;
  }
  apply(pose) {
    const delta = this.handDeltas(pose);
    for (const key in pose.j) {
      const e = pose.j[key], b = this.B(key); if (!b || !e || (!e[0] && !e[1] && !e[2])) continue;
      const J = this.bodyDelta(key, e);
      delta.set(b, delta.has(b) ? J.multiply(delta.get(b)) : J);
    }
    for (const b of this.all) {
      b.quaternion.copy(this.rest.get(b));
      if (this.base.has(b)) b.quaternion.multiply(this.base.get(b));
      const d = delta.get(b);
      if (d) { const Rb = this.Rb.get(b); b.quaternion.multiply(Rb.clone().invert().multiply(d).multiply(Rb)); }
    }
    this.root.updateMatrixWorld(true);
  }
  // read a bone's current rotation back into the pose (clamped to its limits)
  bake(key, pose) {
    const b = this.B(key), Rb = this.Rb.get(b);
    const pre = this.rest.get(b).clone(); if (this.base.has(b)) pre.multiply(this.base.get(b));
    const local = pre.invert().multiply(b.quaternion);
    let T = Rb.clone().multiply(local).multiply(Rb.clone().invert());
    const H = this.handDeltas(pose).get(b);
    if (H) T = T.multiply(H.clone().invert());
    const e = clampSem(key, this.semFromDelta(key, T));
    if (e.some((x) => x)) pose.j[key] = e; else delete pose.j[key];
    return e;
  }
  readSem(key) { return this.semFromDelta(key, (() => { const b = this.B(key), Rb = this.Rb.get(b), pre = this.rest.get(b).clone(); if (this.base.has(b)) pre.multiply(this.base.get(b)); return Rb.clone().multiply(pre.invert().multiply(b.quaternion)).multiply(Rb.clone().invert()); })()); }
  pos(key) { return wp(this.B(key)); }
  // rotate a bone by a world-space quaternion (keeps its children attached)
  worldRotate(b, qw) {
    const pw = b.parent ? wq(b.parent) : new Quaternion();
    b.quaternion.copy(pw.clone().invert().multiply(qw).multiply(wq(b)));
    b.updateMatrixWorld(true);
  }

  // ---------- IK ----------
  // two-bone limb: [upper, mid, end] keys reach target (world).
  // The mid joint (elbow / knee) only bends along its natural axis; the upper joint swings to aim.
  // endQ: world orientation to keep for the hand / foot (pins); otherwise it follows the forearm / shin.
  solveLimb(keys, target, pose, endQ, iters = 3) {
    const [ku, km, ke] = keys, bu = this.B(ku), be = this.B(ke);
    const [lo, hi] = limitsOf(km)[0];
    const cur = pose.j[km] || [0, 0, 0];
    for (let it = 0; it < iters; it++) {
      const a = wp(bu), want = a.distanceTo(target);
      // reach distance falls as the joint bends: bisection on the bend angle
      const reach = (bend) => { pose.j[km] = [bend, cur[1] || 0, cur[2] || 0]; this.apply(pose); return wp(be).distanceTo(a); };
      let l = Math.max(lo, 0), r = hi;
      if (reach(l) <= want) r = l;
      else if (reach(r) >= want) l = r;
      else for (let k = 0; k < 18; k++) { const m = (l + r) / 2; if (reach(m) > want) l = m; else r = m; }
      pose.j[km] = [Math.round((l + r) / 2), cur[1] || 0, cur[2] || 0];
      if (!pose.j[km].some((x) => x)) delete pose.j[km];
      this.apply(pose);
      const c = wp(be);
      this.worldRotate(bu, new Quaternion().setFromUnitVectors(c.sub(a).normalize(), target.clone().sub(a).normalize()));
      this.bake(ku, pose); this.apply(pose);
    }
    if (endQ) { this.worldRotate(be, endQ.clone().multiply(wq(be).invert())); this.bake(ke, pose); this.apply(pose); }
  }
  // CCD chain: rotate the chain bones (root-most first in the list) so the effector bone reaches target
  solveChain(chain, effKey, target, pose, iters = 10) {
    const eb = this.B(effKey);
    for (let it = 0; it < iters; it++) {
      for (let i = chain.length - 1; i >= 0; i--) {
        const b = this.B(chain[i]); if (!b) continue;
        const p = wp(b), e = wp(eb).sub(p), t = target.clone().sub(p);
        if (e.lengthSq() < 1e-10 || t.lengthSq() < 1e-10) continue;
        const q = new Quaternion().setFromUnitVectors(e.normalize(), t.normalize());
        this.worldRotate(b, new Quaternion().slerp(q, 0.7));
        this.bake(chain[i], pose); this.apply(pose);
      }
      if (wp(eb).distanceTo(target) < 0.002) break;
    }
  }
  // which bones move when a bone is dragged
  moveChain(key) {
    const s = key.slice(-2);
    if (key === 'wrist_l' || key === 'wrist_r') return { limb: ['arm' + s, 'elbow' + s, 'wrist' + s] };
    if (key === 'ankle_l' || key === 'ankle_r') return { limb: ['thigh' + s, 'knee' + s, 'ankle' + s] };
    const m = key.match(/^(thumb|index|middle|ring|pinky)_0(\d)(_[lr])$/);
    if (m) { const k = +m[2]; return { chain: k === 1 ? ['wrist' + m[3]] : Array.from({ length: k - 1 }, (_, i) => `${m[1]}_0${i + 1}${m[3]}`) }; }
    return { chain: ({
      head: ['spine', 'chest', 'neck'], neck: ['spine', 'chest'], chest: ['spine'], spine: ['hips'],
      shoulder_l: ['chest'], shoulder_r: ['chest'], arm_l: ['shoulder_l'], arm_r: ['shoulder_r'], elbow_l: ['arm_l'], elbow_r: ['arm_r'],
      thigh_l: ['hips'], thigh_r: ['hips'], knee_l: ['thigh_l'], knee_r: ['thigh_r'], toe_l: ['ankle_l'], toe_r: ['ankle_r'],
    })[key] || [] };
  }
  moveTo(key, target, pose, endQ) {
    const mc = this.moveChain(key);
    if (mc.limb) this.solveLimb(mc.limb, target, pose, endQ); else this.solveChain(mc.chain, key, target, pose);
  }
  // pin record: world position + world orientation
  pinOf(key) { const b = this.B(key); return wp(b).toArray().concat(wq(b).toArray()); }
}

const relaxedArms = { arm_l: [4, 0, -14], arm_r: [4, 0, -14], elbow_l: [12, 0, 0], elbow_r: [12, 0, 0] };
const hands = (curl, thumb, spread) => ({ l: { curl, thumb, spread, fc: {} }, r: { curl, thumb, spread, fc: {} } });
export const POSES = {
  'A-pose': { j: {}, f: hands(0, 0, 0) },
  Relaxed: { j: { ...relaxedArms }, f: hands(25, 15, 5) },
  Contrapposto: { j: { ...relaxedArms, hips: [0, 0, 6], chest: [0, 6, -7], head: [4, 14, 4], thigh_l: [10, 0, 2], knee_l: [22, 0, 0], ankle_l: [-8, 0, 0], thigh_r: [0, 0, -3], elbow_l: [18, 0, 0] }, f: hands(30, 18, 6) },
  'Hand on hip': { j: { ...relaxedArms, arm_r: [-15, 0, 40], elbow_r: [0, 0, -110], hips: [0, 0, 4], chest: [0, -8, -4], head: [0, 12, 0], thigh_l: [6, 0, 0], knee_l: [12, 0, 0] }, f: { l: { curl: 25, thumb: 15, spread: 5, fc: {} }, r: { curl: 15, thumb: 10, spread: 0, fc: {} } } },
  Thinking: { j: { ...relaxedArms, arm_l: [30, 0, -30], elbow_l: [150, 0, -55], head: [12, 8, 0], chest: [5, 0, 0] }, f: { l: { curl: 55, thumb: 35, spread: 0, fc: { index: -30 } }, r: { curl: 35, thumb: 20, spread: 0, fc: {} } } },
  Walk: { j: { thigh_l: [24, 0, 0], knee_l: [12, 0, 0], ankle_l: [-6, 0, 0], thigh_r: [-16, 0, 0], knee_r: [28, 0, 0], ankle_r: [12, 0, 0], arm_l: [-18, 0, -12], arm_r: [20, 0, -12], elbow_l: [14, 0, 0], elbow_r: [30, 0, 0], chest: [0, -7, 0], hips: [0, 6, 0] }, f: hands(28, 15, 4) },
  Reach: { j: { ...relaxedArms, arm_r: [25, 0, 135], elbow_r: [10, 0, 0], head: [-18, 10, 0], chest: [-6, 0, 6] }, f: { l: { curl: 25, thumb: 15, spread: 5, fc: {} }, r: { curl: 5, thumb: 5, spread: 18, fc: {} } } },
  Pointing: { j: { ...relaxedArms, arm_r: [80, 0, 10], elbow_r: [5, 0, 0], head: [0, -12, 0], chest: [0, -10, 0] }, f: { l: { curl: 25, thumb: 15, spread: 5, fc: {} }, r: { curl: 85, thumb: 40, spread: 0, fc: { index: -85 } } } },
  Crouch: { j: { spine: [25, 0, 0], chest: [10, 0, 0], head: [-25, 0, 0], thigh_l: [95, 0, 8], knee_l: [120, 0, 0], ankle_l: [-30, 0, 0], thigh_r: [95, 0, 8], knee_r: [120, 0, 0], ankle_r: [-30, 0, 0], arm_l: [40, 0, -10], arm_r: [40, 0, -10], elbow_l: [50, 0, 0], elbow_r: [50, 0, 0] }, f: hands(40, 20, 5) },
  Fists: { j: { ...relaxedArms, elbow_l: [35, 0, 0], elbow_r: [35, 0, 0] }, f: hands(90, 60, 0) },
};
