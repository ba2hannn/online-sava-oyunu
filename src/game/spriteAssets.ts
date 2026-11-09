/**
 * Oyun görselleri (birim rig'leri, üs/kule sprite'ları, mermi ve efektler) için tek noktadan yükleme.
 * Görseller yüklenene kadar motor eski çizim (geometrik şekiller) ile devam eder.
 */
import { loadRig, type Rig } from './spriteRig';

const BASE = '/assets/';

export interface SpriteImg {
  img: HTMLImageElement;
  w: number;
  h: number;
}

function loadSprite(src: string): Promise<SpriteImg> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res({ img, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => rej(new Error('görsel yüklenemedi: ' + src));
    img.src = src;
  });
}

/** turret_eraX_Y -> kule klasörü */
export const TOWER_FOR_TURRET: Record<string, string> = {
  turret_era0_0: 'tower_bone_arrow',
  turret_era0_1: 'tower_volcano',
  turret_era1_0: 'tower_crossbow',
  turret_era1_1: 'tower_trebuchet',
  turret_era2_0: 'tower_organ',
  turret_era2_1: 'tower_mortar',
  turret_era3_0: 'tower_vulcan',
  turret_era3_1: 'tower_patriot',
  turret_era4_0: 'tower_ion',
  turret_era4_1: 'tower_tesla',
};

/** Kulenin hareketli üst parçası (yay/arbalet/kristal): kulenin gövdesine göre bağlantı noktası */
export const TOWER_WEAPON: Record<string, { att: [number, number]; piv: [number, number]; scale: number; aim: boolean; bob?: boolean }> = {
  tower_bone_arrow: { att: [0.5, 0.06], piv: [0.5, 0.55], scale: 0.62, aim: true },
  tower_crossbow: { att: [0.5, 0.03], piv: [0.3, 0.5], scale: 0.62, aim: true },
  tower_ion: { att: [0.5, -0.1], piv: [0.5, 0.5], scale: 0.9, aim: false, bob: true },
};

const FX_NAMES = [
  'stone', 'arrow', 'arrow_fire', 'bullet_a', 'cannonball', 'rocket', 'laser', 'plasma_a', 'plasma_b',
  'meteor', 'explosion_a', 'explosion_b', 'spark', 'smoke_purple', 'flame', 'dust', 'puff',
];
const BASE_PARTS: string[] = [];
for (let e = 0; e < 5; e++) for (const k of ['intact', 'damaged', 'ruined', 'flag']) BASE_PARTS.push(`era${e}_${k}`);

export class SpriteAssets {
  rigs = new Map<string, Rig>();
  bases = new Map<string, SpriteImg>();
  towers = new Map<string, { base: SpriteImg; weapon?: SpriteImg }>();
  fx = new Map<string, SpriteImg>();
  backgrounds = new Map<number, SpriteImg>();
  ready = false;
  private started = false;

  /** Tarayıcıda bir kez çağrılır; hatalar sessizce eski çizime düşer. */
  preload(unitIds: string[]): Promise<void> {
    if (this.started || typeof window === 'undefined') return Promise.resolve();
    this.started = true;
    const jobs: Promise<unknown>[] = [];
    for (let e = 0; e < 5; e++) {
      jobs.push(
        loadSprite(`${BASE}backgrounds/era${e}.jpg`)
          .then((s) => void this.backgrounds.set(e, s))
          .catch(() => undefined)
      );
    }
    for (const id of unitIds) {
      jobs.push(loadRig(id).then((r) => void this.rigs.set(id, r)).catch(() => undefined));
    }
    for (const n of BASE_PARTS) {
      jobs.push(loadSprite(`${BASE}bases/${n}.png`).then((s) => void this.bases.set(n, s)).catch(() => undefined));
    }
    for (const tid of new Set(Object.values(TOWER_FOR_TURRET))) {
      jobs.push(
        (async () => {
          const base = await loadSprite(`${BASE}towers/${tid}/base.png`);
          let weapon: SpriteImg | undefined;
          if (TOWER_WEAPON[tid]) weapon = await loadSprite(`${BASE}towers/${tid}/weapon.png`);
          this.towers.set(tid, { base, weapon });
        })().catch(() => undefined),
      );
    }
    for (const n of FX_NAMES) {
      jobs.push(loadSprite(`${BASE}fx/${n}.png`).then((s) => void this.fx.set(n, s)).catch(() => undefined));
    }
    return Promise.all(jobs).then(() => {
      this.ready = true;
    });
  }
}

export const spriteAssets = new SpriteAssets();
