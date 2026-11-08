"""
Gemini parça sayfalarını (karaktergorselleri/*.jpg) keser, magenta arka planı siler
ve her birim için public/assets/units/<id>/ altına parça PNG'leri + rig.json yazar.

Çalıştır:  python tools/build_sprites.py
Gereken:   pip install pillow numpy scipy
"""
import glob, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'karaktergorselleri')
OUT = os.path.join(ROOT, 'public', 'assets')
FILES = sorted(glob.glob(os.path.join(SRC, '*.jpg')))
SCALE = 0.34  # kaynak sayfa 2752px; parçalar bu oranda küçültülür

# ---------------------------------------------------------------- kesme
_cache = {}

def load_sheet(idx, minarea=4000, sortmode='x'):
    key = (idx, minarea, sortmode)
    if key in _cache:
        return _cache[key]
    im = Image.open(FILES[idx]).convert('RGB')
    a = np.asarray(im).astype(float)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    m = np.minimum(R, B) - G
    thr = 90 if sortmode == 'x' else 150
    fg = ndi.binary_opening(~(m > thr), iterations=2)
    lab, n = ndi.label(ndi.binary_dilation(fg, iterations=3))
    objs = ndi.find_objects(lab)
    items = []
    for li, s in enumerate(objs, start=1):
        h = s[0].stop - s[0].start
        w = s[1].stop - s[1].start
        if h * w < minarea:
            continue
        items.append((li, s))
    if sortmode == 'x':
        items.sort(key=lambda it: it[1][1].start)
    else:
        items.sort(key=lambda it: (it[1][0].start // 80, it[1][1].start))
    # yumuşak alfa (neon mor/pembe parçaları silmeyecek kadar sıkı)
    alpha = np.clip((200 - m) / 60.0, 0, 1)
    alpha[~((np.minimum(R, B) > 170) | (m < 120))] = alpha[~((np.minimum(R, B) > 170) | (m < 120))]
    spill = np.clip(np.minimum(R, B) - G, 0, None)
    near_bg = ndi.binary_dilation(m > thr, iterations=3)
    ring = near_bg & (alpha > 0)
    R2 = np.where(ring, R - spill * 0.9, R)
    B2 = np.where(ring, B - spill * 0.9, B)
    rgb = np.dstack([R2, G, B2]).clip(0, 255)
    rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    dil = ndi.binary_dilation(lab > 0, iterations=1)
    res = (rgba, lab, items, im.size)
    _cache[key] = res
    return res


def cut(idx, comp, mirror=False, minarea=4000, sortmode='x', crop=None):
    rgba, lab, items, size = load_sheet(idx, minarea, sortmode)
    li, s = items[comp]
    sub = rgba[s].copy()
    mask = (lab[s] == li)
    mask = ndi.binary_dilation(mask, iterations=2)
    sub[..., 3] = np.where(mask, sub[..., 3], 0)
    im = Image.fromarray(sub)
    bb = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if bb:
        im = im.crop(bb)
    if mirror:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    if crop:
        w, h = im.size
        im = im.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
    # Oyun içi boyutlar küçük olduğu için parçaları küçült (dosya boyutu ~10x düşer)
    w, h = im.size
    im = im.resize((max(1, round(w * SCALE)), max(1, round(h * SCALE))), Image.LANCZOS)
    return im


# ---------------------------------------------------------------- rig tanımı
def N(name, comp, parent=None, att=(0.5, 0.5), piv=(0.5, 0.5), z=1, role=None,
      rest=0, tip=None, nb=False, scale=1.0, vis=True, mirror=False, frames=None,
      tint=None, trail=False):
    return dict(name=name, comp=comp, parent=parent, att=list(att), piv=list(piv), z=z,
                role=role or name, rest=rest, tip=tip, nb=nb, scale=scale, vis=vis,
                mirror=mirror, frames=frames, tint=tint, trail=trail)


UNITS = {}

def U(uid, label, sheet, loco, attack, nodes, params=None, minarea=4000):
    UNITS[uid] = dict(id=uid, label=label, sheet=sheet, loco=loco, attack=attack,
                      nodes=nodes, params=params or {}, minarea=minarea)

# ============================ ÇAĞ 0 ============================
U('era0_swarmer', 'Sopalı Avcı', 17, 'biped', 'smash', [
    N('body', 0, role='body'),
    N('legB', 2, 'body', (0.41, 0.85), (0.345, 0.11), -2, 'legB'),
    N('armB', 3, 'body', (0.24, 0.46), (0.61, 0.13), -3, 'armB'),
    N('legF', 1, 'body', (0.41, 0.85), (0.37, 0.115), 2, 'legF'),
    N('armF', 4, 'body', (0.44, 0.46), (0.40, 0.175), 3, 'armF'),
    N('club', 5, 'armF', (0.77, 0.81), (0.53, 0.875), 1, 'weapon', rest=35, tip=(0.5, 0.04), nb=True, trail=True),
])
U('era0_ranger', 'Sapancı İzci', 14, 'biped', 'sling', [
    N('body', 0, role='body'),
    N('legB', 1, 'body', (0.50, 0.80), (0.5, 0.10), -2, 'legB'),
    N('armB', 4, 'body', (0.38, 0.42), (0.43, 0.12), -3, 'armB'),
    N('legF', 2, 'body', (0.50, 0.80), (0.5, 0.10), 2, 'legF'),
    N('armF', 3, 'body', (0.55, 0.42), (0.14, 0.35), 3, 'armF', rest=-12),
    N('sling', 5, 'armF', (0.86, 0.40), (0.5, 0.04), 1, 'sling', nb=True),
    N('stone', 6, 'sling', (0.5, 0.78), (0.5, 0.5), 2, 'stone', nb=True),
])
U('era0_charger', 'Raptor Süvarisi', 15, 'mount', 'stab', [
    N('body', 0, role='body'),
    N('legH', 2, 'body', (0.54, 0.63), (0.35, 0.10), -1, 'mlegF'),
    N('clawF', 5, 'body', (0.72, 0.84), (0.08, 0.5), 1, 'mlegB'),
    N('rider', 4, 'body', (0.60, 0.49), (0.5, 0.78), 1, 'rider'),
    N('armR', 6, 'rider', (0.55, 0.42), (0.30, 0.12), 2, 'armF'),
    N('spear', 7, 'armR', (0.80, 0.85), (0.5, 0.55), 1, 'weapon', rest=78, tip=(0.5, 0.0), nb=True),
])
U('era0_colossus', 'Mamut & Kaya Devi', 16, 'sway', 'smashUp', [
    N('body', 0, role='body'),
    N('giant', 4, 'body', (0.46, 0.10), (0.5, 0.93), 1, 'rider'),
    N('giantArm', 7, 'giant', (0.78, 0.45), (0.10, 0.30), 2, 'armF', tip=(0.78, 0.06), nb=True, trail=True),
], params=dict(weaponIsArm=True))

# ============================ ÇAĞ 1 ============================
U('era1_swarmer', 'Kılıçlı Piyade', 13, 'biped', 'slash', [
    N('body', 0, role='body'),
    N('legB', 2, 'body', (0.5, 0.85), (0.5, 0.10), -2, 'legB'),
    N('armB', 4, 'body', (0.40, 0.45), (0.35, 0.12), -3, 'armB'),
    N('legF', 1, 'body', (0.5, 0.85), (0.5, 0.10), 2, 'legF'),
    N('shield', 3, 'armB', (0.75, 0.90), (0.5, 0.5), 1, 'shield', nb=True),
    N('armF', 6, 'body', (0.56, 0.45), (0.20, 0.12), 3, 'armF'),
    N('sword', 7, 'armF', (0.88, 0.76), (0.5, 0.86), 1, 'weapon', rest=40, tip=(0.5, 0.0), nb=True, trail=True),
])
U('era1_ranger', 'Uzun Yaycı', 10, 'biped', 'bow', [
    N('body', 0, role='body'),
    N('legB', 2, 'body', (0.5, 0.82), (0.5, 0.10), -2, 'legB'),
    N('legF', 1, 'body', (0.5, 0.82), (0.5, 0.10), 2, 'legF'),
    N('armF', 3, 'body', (0.56, 0.45), (0.10, 0.50), 3, 'armF'),
    N('bow', 5, 'armF', (0.95, 0.45), (0.5, 0.5), 1, 'bow', nb=True, scale=0.75),
    N('armB', 4, 'body', (0.52, 0.45), (0.10, 0.35), 3, 'armB'),
    N('arrow', 7, 'armB', (0.95, 0.60), (0.5, 0.75), 1, 'arrow', rest=90, tip=(0.5, 0.0), nb=True),
])
U('era1_charger', 'Ağır Mızraklı Şövalye', 11, 'mount', 'stab', [
    N('body', 0, role='body'),
    N('tail', 3, 'body', (0.04, 0.38), (0.5, 0.05), -1, 'tail'),
    N('rider', 4, 'body', (0.42, 0.30), (0.45, 0.95), 1, 'rider'),
    N('shield', 7, 'rider', (0.62, 0.62), (0.5, 0.5), 3, 'shield', scale=0.8, nb=True),
    N('armR', 5, 'rider', (0.55, 0.45), (0.15, 0.25), 2, 'armF'),
    N('lance', 6, 'armR', (0.90, 0.55), (0.5, 0.62), 4, 'weapon', rest=82, tip=(0.5, 0.0), nb=True),
])
U('era1_colossus', 'Demir Kuşatma Kulesi', 12, 'tower', 'ram', [
    N('tower', 0, role='body'),
    N('pusher2', 6, 'tower', (0.03, 0.97), (0.5, 1.0), -2, 'pusher2'),
    N('pusher', 4, 'tower', (-0.04, 0.97), (0.5, 1.0), -2, 'pusher'),
    N('wheelA', 1, 'tower', (0.147, 0.89), (0.5, 0.5), 3, 'wheel', scale=0.74),
    N('wheelB', 1, 'tower', (0.50, 0.89), (0.5, 0.5), 3, 'wheel', scale=0.74),
    N('ramp', 2, 'tower', (0.97, 0.20), (0.08, 0.10), 2, 'ramp', rest=40, nb=True),
])

# ============================ ÇAĞ 2 ============================
U('era2_swarmer', 'Yatağanlı Muhafız', 4, 'biped', 'slash', [
    N('body', 0, role='body'),
    N('legs', 2, 'body', (0.5, 0.80), (0.5, 0.10), -2, 'legsPair', frames=[2, 1]),
    N('armB', 3, 'body', (0.45, 0.40), (0.5, 0.10), -3, 'armB'),
    N('armF', 4, 'body', (0.55, 0.40), (0.12, 0.15), 3, 'armF'),
    N('sword', 5, 'armF', (0.95, 0.75), (0.5, 0.85), 1, 'weapon', rest=50, tip=(0.5, 0.0), nb=True, trail=True),
])
U('era2_ranger', 'Yeniçeri Tüfekçisi', 1, 'sway', 'shoot', [
    N('body', 0, role='body'),
    N('gun', 4, 'body', (0.78, 0.42), (0.66, 0.40), 3, 'weapon', rest=72, tip=(0.62, 0.0), nb=True),
    N('flash', 5, 'gun', (0.66, 0.0), (0.5, 1.0), 4, 'flash', vis=False, nb=True, scale=0.9),
], params=dict(weaponIsArm=True, noLegs=True))
U('era2_charger', 'Kraliyet Dragoonu', 2, 'mount', 'slash', [
    N('body', 0, role='body', mirror=True),
    N('rear', 1, 'body', (0.04, 0.50), (0.85, 0.20), -1, 'mlegF', mirror=True),
    N('tail', 2, 'body', (0.02, 0.35), (0.85, 0.15), -2, 'tail', mirror=True),
    N('rider', 3, 'body', (0.52, 0.28), (0.5, 0.98), 1, 'rider'),
    N('armR', 5, 'rider', (0.55, 0.55), (0.35, 0.10), 2, 'armF'),
    N('saber', 7, 'armR', (0.45, 0.72), (0.5, 0.85), 3, 'weapon', rest=40, tip=(0.5, 0.0), nb=True, trail=True),
])
U('era2_colossus', 'Şahi Buharlı Topu', 3, 'vehicle', 'cannon', [
    N('wagon', 0, role='body'),
    N('wheelA', 2, 'wagon', (0.26, 0.80), (0.5, 0.5), 3, 'wheel'),
    N('wheelB', 2, 'wagon', (0.68, 0.81), (0.5, 0.5), 3, 'wheel'),
    N('gunner', 3, 'wagon', (1.03, 0.97), (0.5, 1.0), 1, 'gunner'),
    N('barrel', 1, 'wagon', (0.78, 0.45), (0.20, 0.5), 2, 'barrel'),
    N('steam', 5, 'wagon', (0.36, 0.0), (0.5, 1.0), -1, 'steam', nb=True, scale=0.6),
    N('smoke', 5, 'barrel', (0.99, 0.5), (0.1, 0.9), 3, 'puff', vis=False, nb=True, scale=0.7),
    N('ball', 7, 'barrel', (0.99, 0.5), (0.5, 0.5), 3, 'proj', vis=False, nb=True, scale=0.9),
])

# ============================ ÇAĞ 3 ============================
U('era3_swarmer', 'Taarruz Komandosu', 9, 'biped', 'stab', [
    N('body', 0, role='body'),
    N('legs', 2, 'body', (0.55, 0.93), (0.5, 0.05), -2, 'legsPair', frames=[2, 1]),
    N('armF', 5, 'body', (0.55, 0.42), (0.10, 0.15), 3, 'armF', rest=-8),
    N('rifle', 3, 'armF', (0.90, 0.62), (0.38, 0.6), 1, 'rifle', rest=-5, nb=True),
    N('armB', 4, 'body', (0.45, 0.42), (0.5, 0.10), 4, 'armB'),
    N('knife', 6, 'armB', (0.5, 0.95), (0.5, 0.80), 1, 'weapon', rest=60, tip=(0.5, 0.0), nb=True, trail=True),
])
U('era3_ranger', 'Güdümlü RPG Uzmanı', 20, 'biped', 'rpg', [
    N('body', 0, role='body'),
    N('legB', 4, 'body', (0.55, 0.90), (0.5, 0.10), -2, 'legB'),
    N('legF', 2, 'body', (0.55, 0.90), (0.5, 0.10), 2, 'legF'),
    N('armB', 5, 'body', (0.50, 0.42), (0.2, 0.15), 3, 'armB', rest=-35),
    N('armF', 7, 'body', (0.58, 0.42), (0.15, 0.15), 4, 'armF', rest=-25),
    N('launcher', 1, 'armF', (0.92, 0.65), (0.57, 0.80), 1, 'weapon', rest=-8, nb=True),
    N('rocket', 3, 'launcher', (1.0, 0.45), (0.5, 0.5), 2, 'proj', scale=0.5, vis=False, nb=True),
    N('blast', 6, 'launcher', (0.0, 0.5), (1.0, 0.5), 2, 'puff', scale=0.4, vis=False, nb=True),
])
U('era3_charger', 'Zırhlı Kruvazör Tankı', 18, 'vehicle', 'cannon', [
    N('hull', 0, role='body'),
    N('exhaust', 7, 'hull', (0.04, 0.40), (0.9, 0.5), -1, 'puff', nb=True, vis=False),
    N('antenna', 6, 'hull', (0.12, 0.06), (0.5, 0.98), -1, 'antenna', scale=0.8, nb=True),
    N('barrel', 5, 'hull', (0.78, 0.14), (0.02, 0.5), -1, 'barrel', scale=0.6),
    N('turret', 4, 'hull', (0.55, 0.07), (0.35, 0.95), 2, 'turret'),
    N('flash', 8, 'barrel', (0.99, 0.5), (0.05, 0.5), 3, 'flash', vis=False, nb=True, scale=1.2),
])
U('era3_colossus', 'Goliath Savaş Yürüyücüsü', 19, 'walker', 'mech', [
    N('torso', 0, role='body'),
    N('legB', 4, 'torso', (0.62, 0.78), (0.45, 0.10), -2, 'legB'),
    N('armB', 5, 'torso', (0.40, 0.55), (0.20, 0.20), -1, 'armB'),
    N('legF', 1, 'torso', (0.40, 0.78), (0.42, 0.10), 2, 'legF'),
    N('rack', 7, 'torso', (0.50, 0.05), (0.5, 0.9), 1, 'rack'),
    N('armF', 6, 'torso', (0.55, 0.55), (0.10, 0.30), 3, 'armF'),
    N('puffL', 9, 'torso', (0.02, 0.85), (0.8, 0.9), 3, 'puff', vis=False, nb=True, scale=0.8),
    N('rocketPuff', 11, 'rack', (0.5, 0.0), (0.5, 1.0), 2, 'flash', vis=False, nb=True, scale=0.8),
])

# ============================ ÇAĞ 4 ============================
U('era4_swarmer', 'Plazma Muhafızı', 5, 'biped', 'smashUp', [
    N('body', 0, role='body'),
    N('legB', 2, 'body', (0.5, 0.88), (0.5, 0.10), -2, 'legB'),
    N('armB', 3, 'body', (0.45, 0.45), (0.5, 0.12), -3, 'armB'),
    N('legF', 1, 'body', (0.5, 0.88), (0.5, 0.10), 2, 'legF'),
    N('shield', 5, 'armB', (0.55, 0.95), (0.5, 0.70), 1, 'shield', nb=True),
    N('armF', 4, 'body', (0.56, 0.45), (0.08, 0.20), 3, 'armF', tip=(0.97, 0.0), nb=False, trail=True),
], params=dict(weaponIsArm=True, attackParams=dict(aW=-45, aS=105)))
U('era4_ranger', 'Kuantum Railgun Nişancısı', 21, 'biped', 'shoot', [
    N('body', 0, role='body'),
    N('legB', 3, 'body', (0.55, 0.90), (0.5, 0.12), -2, 'legB'),
    N('armB', 5, 'body', (0.50, 0.42), (0.35, 0.10), 3, 'armB', rest=-30),
    N('legF', 2, 'body', (0.55, 0.90), (0.5, 0.12), 2, 'legF'),
    N('armF', 6, 'body', (0.58, 0.42), (0.05, 0.15), 4, 'armF', rest=-25),
    N('rifle', 1, 'armF', (0.95, 0.78), (0.30, 0.62), 1, 'weapon', rest=-8, nb=True),
    N('beam', 4, 'rifle', (1.0, 0.35), (0.0, 0.5), 3, 'proj', vis=False, nb=True, scale=0.8),
    N('orb', 7, 'rifle', (1.0, 0.35), (0.5, 0.5), 3, 'flash', vis=False, nb=True, scale=0.6),
])
U('era4_charger', 'Siber Hover-Tank', 0, 'hover', 'cannon', [
    N('hull', 0, role='body'),
    N('padA', 2, 'hull', (0.18, 0.92), (0.5, 0.15), -1, 'pad'),
    N('padB', 4, 'hull', (0.50, 0.92), (0.5, 0.15), -1, 'pad'),
    N('padC', 8, 'hull', (0.82, 0.92), (0.5, 0.15), -1, 'pad'),
    N('flame', 1, 'hull', (0.02, 0.55), (1.0, 0.5), -2, 'flame', frames=[1, 3, 5], nb=True),
    N('turret', 6, 'hull', (0.45, 0.10), (0.31, 0.85), 2, 'turret'),
])

# ---------------------------------------------------------------- üretim
def build_units():
    manifest = []
    for uid, u in UNITS.items():
        d = os.path.join(OUT, 'units', uid)
        os.makedirs(d, exist_ok=True)
        nodes = []
        for n in u['nodes']:
            files = []
            comps = n['frames'] if n['frames'] else [n['comp']]
            for k, c in enumerate(comps):
                im = cut(u['sheet'], c, mirror=n['mirror'], minarea=u['minarea'])
                fn = f"{n['name']}.png" if k == 0 else f"{n['name']}_{k}.png"
                im.save(os.path.join(d, fn), optimize=True)
                files.append(fn)
                if k == 0:
                    w, h = im.size
            node = {k: v for k, v in n.items() if k not in ('comp', 'frames', 'mirror')}
            node['files'] = files
            node['w'], node['h'] = w, h
            nodes.append(node)
        rig = dict(id=uid, label=u['label'], loco=u['loco'], attack=u['attack'],
                   params=u['params'], nodes=nodes)
        with open(os.path.join(d, 'rig.json'), 'w', encoding='utf-8') as f:
            json.dump(rig, f, ensure_ascii=False, indent=1)
        manifest.append(uid)
        print('ok', uid, len(nodes), 'parça')
    return manifest


def build_effects():
    names = {0: 'stone', 1: 'arrow_fire', 2: 'bullet_a', 3: 'bullet_b', 4: 'cannonball', 5: 'arrow',
             6: 'bullet_c', 7: 'plasma_a', 8: 'rocket', 9: 'plasma_b', 10: 'laser', 11: 'meteor',
             12: 'explosion_a', 13: 'explosion_b', 14: 'explosion_c1', 15: 'explosion_c2',
             16: 'explosion_c3', 17: 'spark', 18: 'smoke_purple', 19: 'flame', 20: 'dust', 21: 'puff'}
    d = os.path.join(OUT, 'fx'); os.makedirs(d, exist_ok=True)
    out = []
    for i, nm in names.items():
        im = cut(8, i, minarea=6000, sortmode='y')
        im.save(os.path.join(d, nm + '.png'), optimize=True); out.append(dict(name=nm, file=nm + '.png', w=im.size[0], h=im.size[1]))
    json.dump(out, open(os.path.join(d, 'fx.json'), 'w'), indent=1)
    print('fx', len(out))


def build_bases():
    rgba, lab, items, size = load_sheet(6, 3000, 'y')
    k = 1000 / size[0]
    d = os.path.join(OUT, 'bases'); os.makedirs(d, exist_ok=True)
    cols = ['intact', 'damaged', 'ruined', 'flag', 'gate']
    used = {}
    out = []
    for i, (li, s) in enumerate(items):
        cx = (s[1].start + s[1].stop) / 2 * k
        cy = (s[0].start + s[0].stop) / 2 * k
        row = sum(cy > t for t in (125, 252, 338, 448))
        col = sum(cx > t for t in (272, 540, 790, 871))
        nm = f"era{row}_{cols[col]}"
        if nm in used:
            nm += '_extra'
        used[nm] = 1
        im = cut(6, i, minarea=3000, sortmode='y')
        im.save(os.path.join(d, nm + '.png'), optimize=True); out.append(dict(name=nm, file=nm + '.png', w=im.size[0], h=im.size[1]))
    json.dump(sorted(out, key=lambda o: o['name']), open(os.path.join(d, 'bases.json'), 'w'), indent=1)
    print('bases', len(out))


TOWERS = {
    'tower_bone_arrow': ('Kemik Ok Kulesi', [('base', 3), ('weapon', 0), ('proj', 8)]),
    'tower_volcano': ('Volkanik Kaya Mancınığı', [('base', 4), ('proj', 6)]),
    'tower_crossbow': ('Kraliyet Arbalet Kulesi', [('base', 1), ('weapon', 5), ('proj', 7)]),
    'tower_trebuchet': ('Kuşatma Trebuchet', [('base', 2)]),
    'tower_organ': ('Çoklu Organ Topu', [('base', 18), ('weapon', 19)]),
    'tower_mortar': ('İmparatorluk Havan Topu', [('base', 20), ('proj', 21)]),
    'tower_vulcan': ('Vulcan Otomatik Top', [('base', 22)]),
    'tower_patriot': ('Patriot Füze Bataryası', [('base', 16), ('proj', 17)]),
    'tower_ion': ('İyon Foton Kulesi', [('base', 30), ('weapon', 32), ('proj', 35)]),
    'tower_tesla': ('Kuantum Tesla Bobini', [('base', 31), ('weapon', 33), ('proj', 34)]),
}

def build_towers():
    # etiket yazıları (ince) elenir: yükseklik >= 40 olan parçalar tutulur
    rgba, lab, items, size = load_sheet(7, 6000, 'y')
    kept = [it for it in items if (it[1][0].stop - it[1][0].start) * 1000 / size[0] >= 20]
    # load_sheet sırası ile cut() aynı listeyi kullanır; etiketler minarea ile zaten eleniyor
    out = []
    for tid, (label, parts) in TOWERS.items():
        d = os.path.join(OUT, 'towers', tid); os.makedirs(d, exist_ok=True)
        nodes = []
        for pname, ci in parts:
            im = cut(7, ci, minarea=6000, sortmode='y')
            im.save(os.path.join(d, pname + '.png'), optimize=True)
            nodes.append(dict(name=pname, file=pname + '.png', w=im.size[0], h=im.size[1]))
        json.dump(dict(id=tid, label=label, nodes=nodes), open(os.path.join(d, 'tower.json'), 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=1)
        out.append(tid)
    print('towers', len(out))
    return out


if __name__ == '__main__':
    only = sys.argv[1:]
    mani = build_units()
    build_effects(); build_bases(); towers = build_towers()
    json.dump(dict(units=mani, towers=towers), open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
    print('bitti')
