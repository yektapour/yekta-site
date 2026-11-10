// Yekta Light: character rig. Body-frame posing on top of a common relaxed A-pose.
//  Bend = natural flexion of the joint, Turn = twist around the body's vertical axis,
//  Tilt = sideways. Left / right values are mirrored, so the same numbers give a symmetric pose.
import { Quaternion, Vector3, Euler } from './vendor/three.module.js';

export const BONES = {
  hips: 'Hips', spine: 'Spine01', chest: 'Spine', neck: 'neck', head: 'Head',
  shoulder_l: 'LeftShoulder', arm_l: 'LeftArm', elbow_l: 'LeftForeArm', wrist_l: 'LeftHand',
  shoulder_r: 'RightShoulder', arm_r: 'RightArm', elbow_r: 'RightForeArm', wrist_r: 'RightHand',
  thigh_l: 'LeftUpLeg', knee_l: 'LeftLeg', ankle_l: 'LeftFoot', thigh_r: 'RightUpLeg', knee_r: 'RightLeg', ankle_r: 'RightFoot',
};
export const LABEL = {
  head: 'Head', neck: 'Neck', chest: 'Chest', spine: 'Spine', hips: 'Hips',
  shoulder_l: 'L shoulder', arm_l: 'L arm', elbow_l: 'L elbow', wrist_l: 'L wrist', shoulder_r: 'R shoulder', arm_r: 'R arm', elbow_r: 'R elbow', wrist_r: 'R wrist',
  thigh_l: 'L thigh', knee_l: 'L knee', ankle_l: 'L ankle', thigh_r: 'R thigh', knee_r: 'R knee', ankle_r: 'R ankle',
};
// flexion sign per joint type (positive Bend = the way the joint naturally bends)
const FLEX = { arm: -1, elbow: -1, wrist: -1, shoulder: -1, thigh: -1, ankle: -1, knee: 1, hips: 1, spine: 1, chest: 1, neck: 1, head: 1 };
// anatomical limits in degrees: [bend], [turn], [tilt]
export const LIMITS = {
  head: [[-45, 50], [-75, 75], [-35, 35]], neck: [[-35, 40], [-45, 45], [-25, 25]],
  chest: [[-30, 40], [-40, 40], [-30, 30]], spine: [[-30, 45], [-35, 35], [-25, 25]], hips: [[-35, 35], [-50, 50], [-25, 25]],
  shoulder: [[-25, 25], [-25, 25], [-15, 35]],
  arm: [[-70, 180], [-90, 90], [-40, 175]], elbow: [[-10, 155], [-90, 90], [-130, 130]], wrist: [[-80, 80], [-60, 60], [-45, 45]],
  thigh: [[-45, 125], [-50, 50], [-45, 70]], knee: [[0, 150], [-25, 25], [-10, 10]], ankle: [[-45, 50], [-30, 30], [-25, 25]],
};
export const limitsOf = (sem) => LIMITS[sem.replace(/_[lr]$/, '')];
export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

const D2R = Math.PI / 180;
const qAxis = (ax, deg) => new Quaternion().setFromAxisAngle(new Vector3(...ax).normalize(), deg * D2R);
const wp = (b) => b.getWorldPosition(new Vector3());
const wq = (b) => b.getWorldQuaternion(new Quaternion());

export class Rig {
  constructor(root, opts = {}) {
    this.root = root;
    this.bones = {};
    root.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.all = Object.values(this.bones);
    this.fused = new Set(opts.fused || []);
    root.updateMatrixWorld(true);
    this.rest = new Map(this.all.map((b) => [b, b.quaternion.clone()]));
    const B = (sem) => this.bones[BONES[sem] || sem];
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
    // finger curl / spread axes, measured in the baseline pose
    this.fingers = {};
    for (const sfx of ['_l', '_r']) {
      const pj = (n) => wp(this.bones[n + sfx]);
      if (!this.bones['index_01' + sfx]) continue;
      const across = pj('index_01').sub(pj('pinky_01')).normalize();
      const handDir = pj('middle_01').sub(wp(B('wrist' + sfx))).normalize();
      const pn = new Vector3().crossVectors(handDir, across).normalize();
      const knC = pj('index_01').add(pj('pinky_01')).multiplyScalar(0.5);
      if (pj('thumb_03').sub(knC).dot(pn) < 0) pn.negate();
      for (const f of FINGERS) {
        const d = pj(f + '_03').sub(pj(f + '_01')).normalize();
        const ax = new Vector3().crossVectors(d, pn).normalize();
        if (new Vector3().crossVectors(ax, d).dot(pn) < 0) ax.negate();
        // spread sign: moving away from the middle finger
        let sg = 0;
        if (f !== 'middle' && f !== 'thumb') { const mv = new Vector3().crossVectors(pn, d), off = pj(f + '_01').sub(pj('middle_01')); sg = Math.sign(mv.dot(off)); }
        this.fingers[f + sfx] = { curl: ax.toArray(), spread: pn.toArray(), sg, joints: [1, 2, 3].map((k) => this.bones[`${f}_0${k}${sfx}`]) };
      }
    }
    // joint handle positions are read from these bones
    this.joints = Object.keys(BONES).filter((s) => B(s));
  }
  // semantic euler (degrees) -> world-frame delta quaternion
  bodyDelta(sem, e) {
    const base = sem.replace(/_[lr]$/, ''), side = /_l$/.test(sem) ? 1 : /_r$/.test(sem) ? -1 : 0, lx = this.leftX;
    const fx = FLEX[base] || 1, sy = side ? side * lx : lx, sz = side ? side * lx : -lx;
    return new Quaternion().setFromEuler(new Euler(e[0] * fx * D2R, e[1] * sy * D2R, e[2] * sz * D2R, 'YXZ'));
  }
  // inverse of bodyDelta (for the viewport gizmo)
  semFromDelta(sem, q) {
    const base = sem.replace(/_[lr]$/, ''), side = /_l$/.test(sem) ? 1 : /_r$/.test(sem) ? -1 : 0, lx = this.leftX;
    const fx = FLEX[base] || 1, sy = side ? side * lx : lx, sz = side ? side * lx : -lx;
    const e = new Euler().setFromQuaternion(q, 'YXZ');
    return [e.x / D2R / fx, e.y / D2R / sy, e.z / D2R / sz];
  }
  apply(pose) {
    const delta = new Map();
    const add = (b, q) => { if (!b) return; delta.set(b, delta.has(b) ? q.clone().multiply(delta.get(b)) : q); };
    for (const sem in pose.j) {
      const e = pose.j[sem]; if (!e || (!e[0] && !e[1] && !e[2])) continue;
      add(this.B(sem), this.bodyDelta(sem, e));
    }
    for (const key in this.fingers) {
      const F = this.fingers[key], side = key.slice(-1), h = pose.f[side]; if (!h) continue;
      const name = key.slice(0, -2), isThumb = name === 'thumb';
      const curl = (isThumb ? h.thumb : h.curl) + ((h.fc && h.fc[name]) || 0);
      const spread = isThumb ? 0 : h.spread * ({ index: 1, middle: 0.25, ring: 0.6, pinky: 1.1 }[name]) * F.sg * (this.fused.has(key) ? 0.2 : 1);
      const share = isThumb ? [0.45, 0.8, 0.75] : [0.85, 1.1, 0.75];
      F.joints.forEach((b, i) => {
        let q = curl ? qAxis(F.curl, curl * share[i]) : null;
        if (i === 0 && spread) q = q ? q.multiply(qAxis(F.spread, spread)) : qAxis(F.spread, spread);
        if (q) add(b, q);
      });
    }
    for (const b of this.all) {
      b.quaternion.copy(this.rest.get(b));
      if (this.base.has(b)) b.quaternion.multiply(this.base.get(b));
      const d = delta.get(b);
      if (d) { const Rb = this.Rb.get(b); b.quaternion.multiply(Rb.clone().invert().multiply(d).multiply(Rb)); }
    }
    this.root.updateMatrixWorld(true);
  }
  // read a bone's current local rotation back into semantic angles (after the gizmo moved it)
  readSem(sem) {
    const b = this.B(sem), Rb = this.Rb.get(b);
    const pre = this.rest.get(b).clone(); if (this.base.has(b)) pre.multiply(this.base.get(b));
    const local = pre.invert().multiply(b.quaternion);
    return this.semFromDelta(sem, Rb.clone().multiply(local).multiply(Rb.clone().invert()));
  }
  pos(sem) { return wp(this.B(sem)); }
}

export const clampSem = (sem, e) => limitsOf(sem).map(([a, b], i) => Math.round(Math.max(a, Math.min(b, e[i] || 0))));

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
  Crouch: { j: { hips: [0, 0, 0], spine: [25, 0, 0], chest: [10, 0, 0], head: [-25, 0, 0], thigh_l: [95, 0, 8], knee_l: [120, 0, 0], ankle_l: [-30, 0, 0], thigh_r: [95, 0, 8], knee_r: [120, 0, 0], ankle_r: [-30, 0, 0], arm_l: [40, 0, -10], arm_r: [40, 0, -10], elbow_l: [50, 0, 0], elbow_r: [50, 0, 0] }, f: hands(40, 20, 5) },
  Fists: { j: { ...relaxedArms, elbow_l: [35, 0, 0], elbow_r: [35, 0, 0] }, f: hands(90, 60, 0) },
};
