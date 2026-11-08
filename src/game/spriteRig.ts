/**
 * Parça tabanlı (kemik/rig) sprite sistemi.
 *
 * Her birim public/assets/units/<id>/rig.json + parça PNG'lerinden oluşur.
 * Animasyonlar kodla üretilir (yürüme, saldırı, ölüm); görsel parçalar döndürülerek,
 * zıplatılarak, squash/stretch yapılarak hareket ettirilir.
 *
 * Kullanım:
 *   const rig = await loadRig('era0_swarmer');
 *   const pose = computePose(rig, { mode: 'walk', phase });      // ya da mode:'attack', u: 0..1
 *   drawRig(ctx, rig, pose, { x, y, height: 60, flip: false });
 */

export interface RigNodeDef {
  name: string;
  parent: string | null;
  att: [number, number];
  piv: [number, number];
  z: number;
  role: string;
  rest: number;
  tip: [number, number] | null;
  nb: boolean;
  scale: number;
  vis: boolean;
  trail: boolean;
  files: string[];
  w: number;
  h: number;
}

export interface RigDef {
  id: string;
  label: string;
  loco: 'biped' | 'mount' | 'sway' | 'vehicle' | 'tower' | 'hover' | 'walker';
  attack: string;
  params: Record<string, any>;
  nodes: RigNodeDef[];
}

export interface NodePose {
  rot?: number; // kalıtımsal açı ekle (derece, saat yönü +)
  abs?: number; // mutlak açı (gövde eksenine göre), rot'u ezer
  dx?: number; // ebeveyn ekseninde kaydırma (rig yüksekliği oranı)
  dy?: number;
  ldx?: number; // düğümün kendi ekseninde kaydırma
  ldy?: number;
  sx?: number;
  sy?: number;
  vis?: boolean;
  frame?: number;
  flip?: boolean;
  alpha?: number;
}

export interface Pose {
  gx: number; // genel yatay kayma (H oranı)
  gy: number; // genel dikey kayma (H oranı, negatif = yukarı)
  lean: number; // ayak noktası etrafında eğim (derece)
  sx: number;
  sy: number;
  alpha: number;
  trailOn: boolean;
  nodes: Record<string, NodePose>; // anahtar: rol ya da düğüm adı
}

export interface Rig {
  def: RigDef;
  imgs: Record<string, HTMLImageElement[]>;
  byName: Record<string, RigNodeDef>;
  children: Record<string, RigNodeDef[]>;
  root: RigNodeDef;
  bounds: { minX: number; maxX: number; minY: number; maxY: number; cx: number; w: number; h: number };
}

export interface TrailState {
  pts: { x: number; y: number; t: number }[];
}

const rigCache = new Map<string, Promise<Rig>>();
export const RIG_BASE = '/assets/units/';

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('görsel yüklenemedi: ' + src));
    i.src = src;
  });
}

export function loadRig(id: string, base = RIG_BASE): Promise<Rig> {
  const key = base + id;
  const hit = rigCache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const def: RigDef = await (await fetch(`${base}${id}/rig.json`)).json();
    const imgs: Record<string, HTMLImageElement[]> = {};
    await Promise.all(
      def.nodes.map(async (n) => {
        imgs[n.name] = await Promise.all(n.files.map((f) => loadImg(`${base}${id}/${f}`)));
      }),
    );
    const byName: Record<string, RigNodeDef> = {};
    const children: Record<string, RigNodeDef[]> = {};
    for (const n of def.nodes) {
      byName[n.name] = n;
      if (n.parent) (children[n.parent] ||= []).push(n);
    }
    for (const k of Object.keys(children)) children[k].sort((a, b) => a.z - b.z);
    const root = def.nodes.find((n) => !n.parent)!;
    const rig: Rig = { def, imgs, byName, children, root, bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, cx: 0, w: 0, h: 0 } };
    rig.bounds = computeBounds(rig);
    return rig;
  })();
  rigCache.set(key, p);
  return p;
}

// ------------------------------------------------------------------ geometri
type M = [number, number, number, number, number, number]; // a b c d e f
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const trans = (x: number, y: number): M => [1, 0, 0, 1, x, y];
const rotM = (deg: number): M => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
};
const scaleM = (s: number): M => [s, 0, 0, s, 0, 0];
const apply = (m: M, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

function attachOffset(rig: Rig, n: RigNodeDef) {
  const p = rig.byName[n.parent!];
  return { x: (n.att[0] - p.piv[0]) * p.w, y: (n.att[1] - p.piv[1]) * p.h };
}

function computeBounds(rig: Rig) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  const walk = (n: RigNodeDef, m: M) => {
    let mm = m;
    if (n.parent) {
      const o = attachOffset(rig, n);
      mm = mul(mm, trans(o.x, o.y));
    }
    mm = mul(mm, rotM(n.rest));
    mm = mul(mm, scaleM(n.scale));
    if (!n.nb) {
      for (const [cx, cy] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const pt = apply(mm, (cx - n.piv[0]) * n.w, (cy - n.piv[1]) * n.h);
        minX = Math.min(minX, pt.x); maxX = Math.max(maxX, pt.x);
        minY = Math.min(minY, pt.y); maxY = Math.max(maxY, pt.y);
      }
    }
    for (const c of rig.children[n.name] || []) walk(c, mm);
  };
  walk(rig.root, [1, 0, 0, 1, 0, 0]);
  return { minX, maxX, minY, maxY, cx: (minX + maxX) / 2, w: maxX - minX, h: maxY - minY };
}

// ------------------------------------------------------------------ eğriler
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const E = {
  lin: (t: number) => t,
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  in: (t: number) => t * t * t,
  io: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};
type Ease = keyof typeof E;
type Key = [number, number, Ease?];

/** Anahtar kare enterpolasyonu: [[u, değer, ease], ...]; ease segmentin bitiş anahtarına aittir. */
function kf(u: number, keys: Key[]): number {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i];
      const t = (u - a[0]) / Math.max(1e-6, b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * E[b[2] || 'io'](clamp01(t));
    }
  }
  return keys[keys.length - 1][1];
}
const between = (u: number, a: number, b: number) => u >= a && u <= b;

function emptyPose(): Pose {
  return { gx: 0, gy: 0, lean: 0, sx: 1, sy: 1, alpha: 1, trailOn: false, nodes: {} };
}
function np(p: Pose, key: string): NodePose {
  return (p.nodes[key] ||= {});
}

// ------------------------------------------------------------------ hareket
export interface PoseInput {
  mode: 'idle' | 'walk' | 'attack' | 'die';
  /** yürüme/bekleme faz sayacı (saniye cinsinden zaman da olur) */
  phase?: number;
  /** saldırı ilerlemesi 0..1 (windup + vuruş + toparlanma) */
  u?: number;
}

export function computePose(rig: Rig, inp: PoseInput): Pose {
  const def = rig.def;
  const p = emptyPose();
  const t = inp.phase || 0;
  baseMotion(def, p, inp.mode === 'walk', t);
  if (inp.mode === 'attack') attackMotion(def, p, clamp01(inp.u || 0));
  if (inp.mode === 'die') dieMotion(p, clamp01(inp.u || 0));
  return p;
}

function baseMotion(def: RigDef, p: Pose, walking: boolean, t: number) {
  const hasWeaponArm = !!def.params.weaponIsArm;
  if (!walking) {
    // bekleme: nefes alma
    const b = Math.sin(t * 2.4);
    if (def.loco === 'hover') {
      p.gy = -0.03 + 0.01 * Math.sin(t * 2.0);
      np(p, 'pad').sx = 1 + 0.05 * Math.sin(t * 5);
      np(p, 'flame').frame = Math.floor(t * 8) % 3;
    } else if (def.loco === 'vehicle' || def.loco === 'tower') {
      p.gy = 0.002 * Math.sin(t * 9);
      np(p, 'steam').sy = 1 + 0.15 * Math.sin(t * 3);
    } else {
      p.sy = 1 + 0.012 * b;
      p.sx = 1 - 0.008 * b;
      np(p, 'armF').rot = 3 * b;
      np(p, 'armB').rot = -3 * b;
      np(p, 'rider').dy = 0.004 * b;
      np(p, 'legsPair').frame = 1;
      np(p, 'tail').rot = 5 * Math.sin(t * 2.0);
      np(p, 'steam').sy = 1 + 0.15 * Math.sin(t * 3);
    }
    return;
  }
  const ph = t * 2 * Math.PI * (def.loco === 'mount' ? 2.2 : def.loco === 'walker' ? 0.9 : def.loco === 'sway' ? 1.1 : 1.6);
  const s = Math.sin(ph), a = Math.abs(s);
  switch (def.loco) {
    case 'biped': {
      np(p, 'legF').rot = 30 * s;
      np(p, 'legB').rot = -30 * s;
      if (!hasWeaponArm) {
        np(p, 'armF').rot = -20 * s;
        np(p, 'armB').rot = 20 * s;
      }
      const seq = Math.floor(ph / Math.PI) % 4;
      const lp = np(p, 'legsPair');
      lp.frame = seq === 1 || seq === 3 ? 1 : 0;
      lp.flip = seq === 2;
      p.gy = -a * 0.022;
      p.sy = 1 + 0.045 * (1 - a);
      p.sx = 1 - 0.03 * (1 - a);
      p.lean = 3;
      np(p, 'weapon').rot = 5 * s;
      break;
    }
    case 'mount': {
      p.gy = -a * 0.018;
      p.lean = 2.0 * s;
      p.sy = 1 + 0.03 * (1 - a);
      p.sx = 1 - 0.02 * (1 - a);
      np(p, 'mlegF').rot = 22 * s;
      np(p, 'mlegB').rot = -26 * s;
      np(p, 'tail').rot = 14 * Math.sin(ph * 2);
      np(p, 'rider').dy = a * 0.012;
      np(p, 'rider').rot = -2 * s;
      break;
    }
    case 'sway': {
      p.gy = -a * 0.014;
      p.lean = 1.6 * s;
      p.sy = 1 + 0.03 * (1 - a);
      p.sx = 1 - 0.02 * (1 - a);
      np(p, 'rider').dy = a * 0.01;
      np(p, 'rider').rot = -1.5 * s;
      if (!hasWeaponArm) np(p, 'armF').rot = -8 * s;
      break;
    }
    case 'vehicle': {
      p.gy = 0.003 * Math.sin(ph * 8) - 0.002;
      p.lean = 0.8 * Math.sin(ph * 2.2);
      np(p, 'wheel').rot = ph * 60;
      np(p, 'antenna').rot = 8 * Math.sin(ph * 5);
      np(p, 'puff').vis = Math.floor(ph * 1.2) % 2 === 0;
      np(p, 'puff').sy = 1 + 0.2 * s;
      np(p, 'steam').sy = 1 + 0.25 * Math.sin(ph * 2);
      np(p, 'gunner').dy = a * 0.008;
      break;
    }
    case 'tower': {
      p.gy = 0.002 * Math.sin(ph * 6);
      p.lean = 0.8 * s;
      np(p, 'wheel').rot = ph * 40;
      np(p, 'pusher').dy = -a * 0.012;
      np(p, 'pusher2').dy = -Math.abs(Math.sin(ph + 1.4)) * 0.012;
      np(p, 'pusher').rot = 2 * s;
      np(p, 'pusher2').rot = -2 * s;
      break;
    }
    case 'hover': {
      p.gy = -0.03 + 0.012 * Math.sin(ph * 0.8);
      p.lean = 1.5 * Math.sin(ph * 0.6);
      np(p, 'pad').sx = 1 + 0.08 * Math.sin(ph * 2);
      np(p, 'flame').frame = Math.floor(ph * 3) % 3;
      np(p, 'flame').sx = 1 + 0.12 * Math.sin(ph * 9);
      break;
    }
    case 'walker': {
      np(p, 'legF').rot = 16 * s;
      np(p, 'legB').rot = -16 * s;
      np(p, 'armF').rot = -5 * s;
      np(p, 'armB').rot = 5 * s;
      p.gy = -a * 0.018;
      p.lean = 1.2 * s;
      p.sy = 1 + 0.02 * (1 - a);
      np(p, 'puff').vis = a < 0.12;
      np(p, 'rack').dy = 0.004 * s;
      break;
    }
  }
}

function attackMotion(def: RigDef, p: Pose, u: number) {
  const P = def.params.attackParams || {};
  switch (def.attack) {
    case 'smash':
    case 'slash':
    case 'smashUp': {
      // Revize: belirgin hazırlık (anticipation) -> kısa bekleme -> hızlı, ağır vuruş -> toparlanma
      const d: any =
        def.attack === 'smash' ? { aW: 150, aS: -70, wW: -35, wS: 120, lW: -8, lS: 13 }
        : def.attack === 'slash' ? { aW: 115, aS: -55, wW: -25, wS: 115, lW: -6, lS: 10 }
        : { aW: -40, aS: 115, wW: 0, wS: 0, lW: -7, lS: 12 };
      const c = { ...d, ...P };
      const arm = kf(u, [[0, 0], [0.30, c.aW, 'out'], [0.38, c.aW + (c.aW > 0 ? 6 : -6), 'io'], [0.50, c.aS, 'in'], [0.60, c.aS + (c.aS < 0 ? 8 : -8), 'out'], [1, 0, 'io']]);
      np(p, 'armF').rot = arm;
      np(p, 'armB').rot = -arm * 0.25 + 8;
      if (def.attack !== 'smashUp') {
        const restAbs = findRest(def, 'weapon');
        np(p, 'weapon').abs = kf(u, [[0, restAbs], [0.30, c.wW, 'out'], [0.38, c.wW, 'io'], [0.50, c.wS, 'in'], [1, restAbs, 'io']]);
      }
      p.lean = kf(u, [[0, 0], [0.30, c.lW, 'out'], [0.38, c.lW, 'io'], [0.50, c.lS, 'in'], [0.62, c.lS * 0.6, 'out'], [1, 0, 'io']]);
      p.gx = kf(u, [[0, 0], [0.30, -0.02, 'out'], [0.38, -0.02], [0.50, 0.05, 'in'], [1, 0, 'io']]);
      const squash = kf(u, [[0, 1], [0.30, 1.03, 'out'], [0.50, 0.95, 'in'], [0.62, 1.0, 'out'], [1, 1]]);
      p.sy = squash; p.sx = 2 - squash;
      const k = Math.abs(p.lean) / 12;
      np(p, 'legF').rot = 18 * k;
      np(p, 'legB').rot = -18 * k;
      if (between(u, 0.5, 0.64)) p.gy = Math.sin(u * 90) * 0.008 * (1 - (u - 0.5) / 0.14);
      p.trailOn = between(u, 0.40, 0.56);
      break;
    }
    case 'stab': {
      const c = { aW: 28, aS: -32, thrust: 0.11, lean: 5, ...P };
      np(p, 'armF').rot = kf(u, [[0, 0], [0.30, c.aW, 'out'], [0.40, c.aW, 'io'], [0.50, c.aS, 'in'], [0.62, c.aS + 6, 'out'], [1, 0, 'io']]);
      np(p, 'armB').rot = kf(u, [[0, 0], [0.30, 35, 'out'], [0.50, -40, 'in'], [1, 0, 'io']]);
      np(p, 'weapon').ldy = -kf(u, [[0, 0], [0.38, 0], [0.50, c.thrust, 'in'], [0.62, c.thrust * 0.8], [1, 0, 'io']]);
      np(p, 'weapon').ldx = 0;
      p.lean = kf(u, [[0, 0], [0.30, -4, 'out'], [0.38, -4], [0.50, c.lean, 'in'], [1, 0, 'io']]);
      p.gx = kf(u, [[0, 0], [0.30, -0.02, 'out'], [0.50, 0.07, 'in'], [1, 0, 'io']]);
      np(p, 'rider').dy = kf(u, [[0, 0], [0.30, 0.012, 'out'], [0.50, -0.01, 'in'], [1, 0, 'io']]);
      np(p, 'mlegF').rot = kf(u, [[0, 0], [0.50, 30, 'io'], [1, 0, 'io']]);
      np(p, 'mlegB').rot = kf(u, [[0, 0], [0.50, -30, 'io'], [1, 0, 'io']]);
      p.trailOn = between(u, 0.42, 0.58);
      break;
    }
    case 'shoot': {
      const fire = 0.14;
      const kick = kf(u, [[0, 0], [fire, 0, 'in'], [fire + 0.03, -1, 'out'], [0.45, 0, 'io']]);
      np(p, 'weapon').rot = kick * 7;
      np(p, 'weapon').ldx = kick * 0.03;
      np(p, 'armF').rot = kick * 5 + kf(u, [[0, 0], [0.1, -6, 'out'], [0.8, -6], [1, 0, 'io']]);
      np(p, 'armB').rot = kick * 3 - 4;
      p.gx = kick * 0.012;
      p.lean = kick * 2;
      np(p, 'flash').vis = between(u, fire, fire + 0.09);
      np(p, 'flash').sx = np(p, 'flash').sy = 0.8 + 0.4 * Math.sin((u - fire) * 30);
      const bv = between(u, fire + 0.01, fire + 0.22);
      np(p, 'proj').vis = bv;
      np(p, 'proj').ldx = (u - fire) * 1.5;
      np(p, 'proj').alpha = bv ? 1 - (u - fire) / 0.22 : 1;
      np(p, 'legF').rot = 8; np(p, 'legB').rot = -8;
      break;
    }
    case 'rpg': {
      const fire = 0.18;
      const kick = kf(u, [[0, 0], [fire, 0, 'in'], [fire + 0.04, -1, 'out'], [0.55, 0, 'io']]);
      np(p, 'armF').rot = kick * 8 + kf(u, [[0, 0], [0.12, -6, 'out'], [0.8, -6], [1, 0, 'io']]);
      np(p, 'armB').rot = kick * 5;
      np(p, 'weapon').rot = kick * 5;
      p.lean = kick * 3; p.gx = kick * 0.02;
      const rv = between(u, fire, 0.7);
      np(p, 'proj').vis = rv;
      np(p, 'proj').ldx = (u - fire) * 2.4;
      np(p, 'puff').vis = between(u, fire, fire + 0.25);
      np(p, 'puff').sx = np(p, 'puff').sy = 0.7 + (u - fire) * 3;
      np(p, 'puff').alpha = 1 - (u - fire) / 0.25;
      np(p, 'legF').rot = 8; np(p, 'legB').rot = -8;
      break;
    }
    case 'bow': {
      np(p, 'armB').rot = kf(u, [[0, 0], [0.45, 14, 'io'], [0.52, 14], [0.58, -4, 'out'], [1, 0, 'io']]);
      np(p, 'armB').dx = -kf(u, [[0, 0], [0.45, 0.07, 'io'], [0.52, 0.07], [0.58, 0, 'out'], [1, 0]]);
      np(p, 'armF').rot = kf(u, [[0, 0], [0.5, -2], [0.56, 3, 'out'], [1, 0, 'io']]);
      np(p, 'bow').sx = kf(u, [[0, 1], [0.45, 0.93, 'io'], [0.52, 0.93], [0.58, 1, 'out'], [1, 1]]);
      p.lean = kf(u, [[0, 0], [0.45, -2, 'io'], [0.58, 1, 'out'], [1, 0, 'io']]);
      const flying = between(u, 0.52, 0.82);
      const nock = u < 0.52 || u > 0.88;
      const ar = np(p, 'arrow');
      ar.vis = flying || nock;
      if (flying) { ar.ldy = -(u - 0.52) * 3.2; ar.alpha = 1 - clamp01((u - 0.66) / 0.16); }
      np(p, 'legF').rot = 6; np(p, 'legB').rot = -6;
      break;
    }
    case 'sling': {
      np(p, 'armF').rot = kf(u, [[0, 0], [0.14, -58, 'out'], [0.58, -58], [0.66, 20, 'out'], [1, 0, 'io']]);
      np(p, 'armB').rot = kf(u, [[0, 0], [0.14, -10, 'out'], [0.66, 10, 'out'], [1, 0, 'io']]);
      const spin = u > 0.14 && u < 0.62 ? 360 * 3 * E.in((u - 0.14) / 0.48) * 0.5 + 360 * 1.5 * ((u - 0.14) / 0.48) : 0;
      np(p, 'sling').rot = spin;
      np(p, 'stone').vis = u < 0.62 || u > 0.88;
      p.lean = kf(u, [[0, 0], [0.14, -4, 'out'], [0.58, -4], [0.66, 6, 'out'], [1, 0, 'io']]);
      np(p, 'legF').rot = 8; np(p, 'legB').rot = -8;
      break;
    }
    case 'cannon': {
      const fire = 0.2;
      const rec = kf(u, [[0, 0], [fire, 0, 'in'], [fire + 0.03, 1, 'out'], [0.55, 0, 'io']]);
      np(p, 'barrel').ldx = -rec * 0.05;
      np(p, 'turret').ldx = -rec * (def.loco === 'hover' ? 0.03 : 0.015);
      p.gx = -rec * 0.012;
      p.lean = -rec * 1.2;
      np(p, 'flash').vis = between(u, fire, fire + 0.10);
      np(p, 'flash').sx = np(p, 'flash').sy = 0.8 + 0.5 * Math.sin((u - fire) * 25);
      np(p, 'puff').vis = between(u, fire + 0.02, 0.6);
      np(p, 'puff').alpha = 1 - clamp01((u - fire) / 0.4);
      np(p, 'puff').sx = np(p, 'puff').sy = 0.6 + (u - fire) * 1.4;
      const bv = between(u, fire + 0.01, 0.55);
      np(p, 'proj').vis = bv;
      np(p, 'proj').ldx = (u - fire) * 3.5;
      np(p, 'steam').sy = 1 + 0.5 * rec;
      np(p, 'gunner').rot = kf(u, [[0, 0], [0.1, -8, 'out'], [fire, 6, 'in'], [0.6, 0, 'io']]);
      np(p, 'gunner').dx = kf(u, [[0, 0], [0.1, -0.01, 'out'], [fire, 0.012, 'in'], [0.6, 0, 'io']]);
      np(p, 'wheel').rot = -rec * 12;
      if (def.loco === 'hover') {
        np(p, 'pad').sx = 1.1;
        np(p, 'flame').frame = Math.floor(u * 24) % 3;
        p.gy = -0.03 + 0.008 * Math.sin(u * 20);
      }
      break;
    }
    case 'mech': {
      const burst = between(u, 0.15, 0.58) ? Math.sin(u * 140) : 0;
      np(p, 'armF').rot = kf(u, [[0, 0], [0.15, -14, 'out'], [0.6, -14], [1, 0, 'io']]) + burst * 1.6;
      np(p, 'armB').rot = kf(u, [[0, 0], [0.18, -12, 'out'], [0.6, -12], [1, 0, 'io']]) - burst * 1.4;
      np(p, 'rack').rot = kf(u, [[0, 0], [0.3, -8, 'out'], [0.7, -8], [1, 0, 'io']]);
      np(p, 'rack').dy = between(u, 0.3, 0.45) ? -0.01 : 0;
      np(p, 'flash').vis = between(u, 0.3, 0.55);
      np(p, 'flash').sx = np(p, 'flash').sy = 0.5 + (u - 0.3) * 3;
      np(p, 'flash').alpha = 1 - clamp01((u - 0.3) / 0.25);
      p.lean = kf(u, [[0, 0], [0.15, -3, 'out'], [0.6, -3], [1, 0, 'io']]);
      p.gx = burst * 0.002;
      np(p, 'legF').rot = 10; np(p, 'legB').rot = -10;
      break;
    }
    case 'ram': {
      np(p, 'ramp').rot = kf(u, [[0, 0], [0.22, 6, 'out'], [0.38, -90, 'in'], [0.48, -86, 'out'], [0.85, -90], [1, 0, 'io']]);
      p.gx = kf(u, [[0, 0], [0.22, -0.012, 'out'], [0.38, 0.035, 'in'], [0.55, 0.01, 'out'], [1, 0, 'io']]);
      p.lean = kf(u, [[0, 0], [0.22, -1.5, 'out'], [0.38, 2.5, 'in'], [0.55, 0.5, 'out'], [1, 0, 'io']]);
      if (between(u, 0.38, 0.55)) p.gy = Math.sin(u * 120) * 0.006 * (1 - (u - 0.38) / 0.17);
      np(p, 'wheel').rot = kf(u, [[0, 0], [1, 40, 'lin']]);
      np(p, 'pusher').rot = 6; np(p, 'pusher2').rot = 6;
      break;
    }
  }
}

function findRest(def: RigDef, role: string) {
  const n = def.nodes.find((x) => x.role === role);
  return n ? n.rest : 0;
}

function dieMotion(p: Pose, u: number) {
  p.lean = -80 * E.in(clamp01(u / 0.55));
  p.gx = -0.12 * E.out(u);
  p.gy = -0.03 * Math.sin(Math.min(1, u / 0.3) * Math.PI) + 0.02 * E.in(clamp01(u / 0.55));
  p.alpha = 1 - clamp01((u - 0.65) / 0.35);
}

// ------------------------------------------------------------------ çizim
export interface DrawOpts {
  x: number; // zemin noktası (ayakların altı), canvas birimi
  y: number;
  height: number; // rig'in çizilecek yüksekliği (ayak-baş)
  flip?: boolean; // true: sola bak
  trail?: TrailState;
  now?: number;
  debug?: boolean;
  filter?: string; // ctx.filter (renk tonu vb.)
}

export function drawRig(ctx: CanvasRenderingContext2D, rig: Rig, pose: Pose, o: DrawOpts) {
  const B = rig.bounds;
  const S = o.height / B.h;
  const H = B.h;
  ctx.save();
  if (o.filter) (ctx as any).filter = o.filter;
  ctx.globalAlpha *= pose.alpha;
  ctx.translate(o.x, o.y);
  if (o.flip) ctx.scale(-1, 1);
  ctx.scale(S, S);
  ctx.translate(pose.gx * H, pose.gy * H);
  ctx.rotate((pose.lean * Math.PI) / 180);
  ctx.scale(pose.sx, pose.sy);
  ctx.translate(-B.cx, -B.maxY);
  drawNode(ctx, rig, rig.root, pose, 0, H, o);
  ctx.restore();
  if (o.trail) drawTrail(ctx, o.trail, o.now || performance.now());
}

function nodePose(pose: Pose, n: RigNodeDef): NodePose {
  const a = pose.nodes[n.role];
  const b = n.role !== n.name ? pose.nodes[n.name] : undefined;
  return a && b ? { ...a, ...b } : a || b || {};
}

function drawNode(ctx: CanvasRenderingContext2D, rig: Rig, n: RigNodeDef, pose: Pose, accRot: number, H: number, o: DrawOpts) {
  const q = nodePose(pose, n);
  const visible = q.vis !== undefined ? q.vis : n.vis;
  ctx.save();
  if (n.parent) {
    const off = attachOffset(rig, n);
    ctx.translate(off.x, off.y);
  }
  if (q.dx || q.dy) ctx.translate((q.dx || 0) * H, (q.dy || 0) * H);
  let rot = n.rest + (q.rot || 0);
  if (q.abs !== undefined) rot = q.abs - accRot;
  ctx.rotate((rot * Math.PI) / 180);
  if (q.ldx || q.ldy) ctx.translate((q.ldx || 0) * H, (q.ldy || 0) * H);
  const sc = n.scale;
  ctx.scale(sc * (q.sx ?? 1), sc * (q.sy ?? 1));
  const kids = rig.children[n.name] || [];
  const nextAcc = accRot + rot;
  for (const c of kids) if (c.z < 0) drawNode(ctx, rig, c, pose, nextAcc, H, o);
  if (visible) {
    const frames = rig.imgs[n.name];
    const img = frames[Math.min(q.frame || 0, frames.length - 1)];
    const prevAlpha = ctx.globalAlpha;
    if (q.alpha !== undefined) ctx.globalAlpha *= q.alpha;
    if (q.flip) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(img, -n.piv[0] * n.w, -n.piv[1] * n.h);
      ctx.restore();
    } else {
      ctx.drawImage(img, -n.piv[0] * n.w, -n.piv[1] * n.h);
    }
    ctx.globalAlpha = prevAlpha;
    if (o.debug) {
      ctx.fillStyle = '#ff2d55';
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, 7);
      ctx.fill();
    }
    if (o.trail && n.trail && n.tip && pose.trailOn) {
      const wp = (ctx.getTransform() as DOMMatrix).transformPoint({ x: (n.tip[0] - n.piv[0]) * n.w, y: (n.tip[1] - n.piv[1]) * n.h });
      o.trail.pts.push({ x: wp.x, y: wp.y, t: o.now || performance.now() });
    }
  }
  for (const c of kids) if (c.z >= 0) drawNode(ctx, rig, c, pose, nextAcc, H, o);
  ctx.restore();
}

function drawTrail(ctx: CanvasRenderingContext2D, tr: TrailState, now: number) {
  const life = 170;
  tr.pts = tr.pts.filter((p) => now - p.t < life);
  if (tr.pts.length < 2) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineCap = 'round';
  for (let i = 1; i < tr.pts.length; i++) {
    const a = tr.pts[i - 1], b = tr.pts[i];
    const f = 1 - (now - b.t) / life;
    ctx.strokeStyle = `rgba(255,255,255,${0.7 * f})`;
    ctx.lineWidth = 10 * f + 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

export function rigAspect(rig: Rig) {
  return rig.bounds.w / rig.bounds.h;
}
