import { loadRig, computePose, drawRig, type Rig, type TrailState } from './game/spriteRig';

const manifest = await (await fetch('/assets/manifest.json')).json();
const grid = document.getElementById('grid')!;
const cells: { id: string; rig: Rig; ctx: CanvasRenderingContext2D; trail: TrailState; el: HTMLElement; enemy: boolean }[] = [];
let mode = 'auto';
const dpr = 2;

for (const id of manifest.units as string[]) {
  const rig = await loadRig(id);
  const el = document.createElement('div');
  el.className = 'cell';
  const cv = document.createElement('canvas');
  cv.width = 250 * dpr; cv.height = 280 * dpr;
  const lab = document.createElement('div');
  lab.textContent = `${id} · ${rig.def.label}`;
  el.append(cv, lab);
  grid.append(el);
  cells.push({ id, rig, ctx: cv.getContext('2d')!, trail: { pts: [] }, el, enemy: false });
}

const bar = document.getElementById('modes')!;
for (const [k, l] of [['auto', 'Karışık'], ['walk', 'Yürü'], ['attack', 'Saldır'], ['idle', 'Bekle'], ['die', 'Ölüm']]) {
  const b = document.createElement('button');
  b.textContent = l; b.dataset.k = k;
  b.onclick = () => { mode = k; t0 = performance.now(); upd(); };
  bar.append(b);
}
function upd() { [...bar.children].forEach((b: any) => b.classList.toggle('on', b.dataset.k === mode)); }
upd();
let t0 = performance.now();
const $ = (id: string) => document.getElementById(id) as any;
function filt() {
  const era = $('era').value, kind = $('kind').value;
  for (const c of cells) {
    const okE = era === 'all' || c.id.startsWith('era' + era);
    const okK = kind === 'all' || c.id.endsWith(kind);
    c.el.style.display = okE && okK ? '' : 'none';
  }
}
$('era').onchange = filt; $('kind').onchange = filt;

function frame(now: number) {
  const t = (now - t0) / 1000, sp = +$('speed').value, dbg = $('dbg').checked;
  for (const c of cells) {
    if (c.el.style.display === 'none') continue;
    const { ctx, rig } = c;
    ctx.clearRect(0, 0, 250 * dpr, 280 * dpr);
    let m = mode, tt = t * sp;
    if (mode === 'auto') { const cyc = tt % 6; if (cyc < 2.5) { m = 'walk'; tt = cyc; } else { m = 'attack'; tt = cyc - 2.5; } }
    let pose;
    if ($('freeze').checked && (m === 'attack' || mode === 'attack')) pose = computePose(rig, { mode: 'attack', u: +$('u').value, phase: 0 });
    else if (m === 'attack') pose = computePose(rig, { mode: 'attack', u: (tt % 1.0) / 1.0, phase: tt });
    else if (m === 'die') pose = computePose(rig, { mode: 'die', u: (tt % 2.5) / 2.0 });
    else pose = computePose(rig, { mode: m as any, phase: tt });
    const maxH = 185 * dpr, maxW = 225 * dpr;
    const h = Math.min(maxH, (maxW / rig.bounds.w) * rig.bounds.h);
    ctx.fillStyle = 'rgba(0,0,0,.22)';
    ctx.beginPath(); ctx.ellipse(125 * dpr, 236 * dpr, h * rig.bounds.w / rig.bounds.h * 0.3, 9 * dpr, 0, 0, 7); ctx.fill();
    drawRig(ctx, rig, pose, { x: 125 * dpr, y: 236 * dpr, height: h, trail: c.trail, now, debug: dbg });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
