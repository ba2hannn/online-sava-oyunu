"""
UI görsellerini ve arka planları hazırlar:
- Magenta (#FF00FF) arka planı siler (yumuşak alfa + despill)
- Parçaları keser ve public/assets/ui/ ve public/assets/backgrounds/ altına kaydeder.
"""
import glob, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets_source')
OUT_UI = os.path.join(ROOT, 'public', 'assets', 'ui')
OUT_BG = os.path.join(ROOT, 'public', 'assets', 'backgrounds')

os.makedirs(OUT_UI, exist_ok=True)
os.makedirs(OUT_BG, exist_ok=True)

for sub in ['portraits', 'cards', 'towers', 'turret_actions', 'actions', 'powers', 'doctrines', 'system', 'modals', 'icons']:
    os.makedirs(os.path.join(OUT_UI, sub), exist_ok=True)

# -------------------------------------------------------------
# 1. ARKA PLANLARI HAZIRLA (5 ÇAĞ - 3-TILE AYNALI PANORAMA)
# -------------------------------------------------------------
print("[-] Arka planlar işleniyor (3-tile aynalama)...")

bg_map = {
    'era0': os.path.join(SRC, 'Generated Image November 09, 2026 - 2_35AM.jpg'), # Taş Devri
    'era1': os.path.join(SRC, 'Generated Image November 09, 2026 - 2_36AM.jpg'), # Orta Çağ
    'era2': os.path.join(SRC, 'Generated Image November 09, 2026 - 2_37AM.jpg'), # Barut Çağı
    'era3': os.path.join(SRC, 'Generated Image November 09, 2026 - 2_37AM.jpg'), # Modern Çağ
    'era4': os.path.join(SRC, 'Generated Image November 09, 2026 - 2_38AM.jpg'), # Siber Çağ
}

target_h = 560  # GROUND_Y = 560 ile tam hizalanacak doğal yükseklik

for era, src_path in bg_map.items():
    if os.path.exists(src_path):
        im = Image.open(src_path).convert('RGB')
        w, h = im.size
        tile_w = int(w * (target_h / h))
        im_scaled = im.resize((tile_w, target_h), Image.Resampling.LANCZOS)
        im_flipped = im_scaled.transpose(Image.FLIP_LEFT_RIGHT)
        
        # 3-tile aynalama: A -> Ters A -> A (dikişsiz / seamless)
        if era == 'era3':
            p1, p2, p3 = im_flipped, im_scaled, im_flipped
        else:
            p1, p2, p3 = im_scaled, im_flipped, im_scaled
            
        total_w = tile_w * 3
        pano = Image.new('RGB', (total_w, target_h))
        pano.paste(p1, (0, 0))
        pano.paste(p2, (tile_w, 0))
        pano.paste(p3, (tile_w * 2, 0))
        
        out_path = os.path.join(OUT_BG, f'{era}.jpg')
        pano.save(out_path, 'JPEG', quality=90)
        print(f" [+] 3-Tile Aynalı Arka plan hazır: {out_path} ({total_w}x{target_h})")

# -------------------------------------------------------------
# 2. MAGENTA ARKA PLAN TEMİZLEME VE PARÇA KESİCİ
# -------------------------------------------------------------
def clean_and_cut_components(sheet_path, min_area=2500, thr=75):
    im = Image.open(sheet_path).convert('RGB')
    a = np.asarray(im).astype(float)
    R, G, B = a[..., 0], a[..., 1], a[..., 2]
    
    # Magenta metriği
    m = np.minimum(R, B) - G
    
    # Ön plan maskesi
    fg = (m < thr)
    fg_clean = ndi.binary_opening(fg, iterations=2)
    lab, n = ndi.label(ndi.binary_dilation(fg_clean, iterations=2))
    objs = ndi.find_objects(lab)
    
    # Yumuşak alfa ve magenta despill
    alpha = np.clip((140 - m) / 45.0, 0, 1)
    spill = np.clip(np.minimum(R, B) - G, 0, None)
    near_bg = ndi.binary_dilation(m > thr, iterations=3)
    ring = near_bg & (alpha > 0)
    
    R_clean = np.where(ring, R - spill * 0.95, R)
    B_clean = np.where(ring, B - spill * 0.95, B)
    rgb = np.dstack([R_clean, G, B_clean]).clip(0, 255)
    rgba = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    
    valid_items = []
    for li, s in enumerate(objs, start=1):
        h = s[0].stop - s[0].start
        w = s[1].stop - s[1].start
        if w * h < min_area:
            continue
        
        # Parçayı al ve izole et
        sub = rgba[s].copy()
        mask = (lab[s] == li)
        mask = ndi.binary_dilation(mask, iterations=2)
        sub[..., 3] = np.where(mask, sub[..., 3], 0)
        
        pimg = Image.fromarray(sub)
        bbox = pimg.getchannel('A').point(lambda v: 255 if v > 15 else 0).getbbox()
        if bbox:
            pimg = pimg.crop(bbox)
        
        valid_items.append({
            'img': pimg,
            'x': s[1].start,
            'y': s[0].start,
            'w': pimg.width,
            'h': pimg.height
        })
    
    # Sırala: önce Y satırı, sonra X sütunu
    valid_items.sort(key=lambda it: (it['y'] // 60, it['x']))
    return valid_items

# -------------------------------------------------------------
# 3. PORTRELER (ERA 0 - ERA 4)
# -------------------------------------------------------------
print("[-] Portreler işleniyor...")

portrait_sheets = [
    (0, os.path.join(SRC, 'Generated Image November 09, 2026 - 3_02AM (1).jpg')), # Era 0
    (1, os.path.join(SRC, 'Generated Image November 09, 2026 - 3_02AM (2).jpg')), # Era 1
    (2, os.path.join(SRC, 'Generated Image November 09, 2026 - 3_02AM (3).jpg')), # Era 2
    (3, os.path.join(SRC, 'Generated Image November 09, 2026 - 3_02AM (4).jpg')), # Era 3 & 4
]

archetypes = ['swarmer', 'ranger', 'charger', 'tank']

for era, sheet_file in portrait_sheets:
    if not os.path.exists(sheet_file):
        continue
    items = clean_and_cut_components(sheet_file, min_area=3500)
    print(f" [+] Era {era} sayfasında {len(items)} portre kesildi.")
    if era < 3:
        for idx, arch in enumerate(archetypes):
            if idx < len(items):
                pimg = items[idx]['img'].resize((128, 128), Image.Resampling.LANCZOS)
                out_path = os.path.join(OUT_UI, 'portraits', f'era{era}_{arch}.png')
                pimg.save(out_path, 'PNG')
    else:
        # Sheet 4 contains Era 3 and Era 4
        # First row / first 4 items: Era 3
        # Second row / next 4 items: Era 4
        for idx, arch in enumerate(archetypes):
            if idx < len(items):
                pimg = items[idx]['img'].resize((128, 128), Image.Resampling.LANCZOS)
                pimg.save(os.path.join(OUT_UI, 'portraits', f'era3_{arch}.png'), 'PNG')
            if idx + 4 < len(items):
                pimg = items[idx + 4]['img'].resize((128, 128), Image.Resampling.LANCZOS)
                pimg.save(os.path.join(OUT_UI, 'portraits', f'era4_{arch}.png'), 'PNG')

# -------------------------------------------------------------
# 4. KULE İKONLARI (TOWERS) & KULE EYLEMLERİ
# -------------------------------------------------------------
print("[-] Kuleler ve slotlar işleniyor...")

tower_sheet = os.path.join(SRC, 'Generated Image November 09, 2026 - 2_33AM.jpg')
if os.path.exists(tower_sheet):
    items = clean_and_cut_components(tower_sheet, min_area=2000)
    tower_ids = [
        'tower_bone_arrow', 'tower_volcano',
        'tower_crossbow', 'tower_trebuchet',
        'tower_organ', 'tower_mortar',
        'tower_vulcan', 'tower_patriot',
        'tower_ion', 'tower_tesla'
    ]
    for idx, tid in enumerate(tower_ids):
        if idx < len(items):
            pimg = items[idx]['img'].resize((120, 120), Image.Resampling.LANCZOS)
            pimg.save(os.path.join(OUT_UI, 'towers', f'{tid}.png'), 'PNG')
    print(f" [+] {min(len(items), len(tower_ids))} adet kule ikonu kaydedildi.")

# -------------------------------------------------------------
# 5. KULE EYLEM BUTONLARI (Build, Upgrade, Unlock, Sell)
# -------------------------------------------------------------
btn_sheet = os.path.join(SRC, 'Generated Image November 09, 2026 - 3_03AM.jpg')
if os.path.exists(btn_sheet):
    items = clean_and_cut_components(btn_sheet, min_area=2500)
    actions = ['build', 'upgrade', 'unlock', 'sell']
    for idx, act in enumerate(actions):
        if idx < len(items):
            pimg = items[idx]['img'].resize((160, 48), Image.Resampling.LANCZOS)
            pimg.save(os.path.join(OUT_UI, 'turret_actions', f'{act}.png'), 'PNG')
    print(f" [+] Kule eylem butonları kesildi.")

# -------------------------------------------------------------
# 6. ANA EYLEM BUTONLARI & ÖZEL GÜÇ İKONLARI
# -------------------------------------------------------------
action_sheet = os.path.join(SRC, 'Generated Image November 09, 2026 - 3_02AM (6).jpg')
if os.path.exists(action_sheet):
    items = clean_and_cut_components(action_sheet, min_area=2000)
    # İlk büyük butonlar
    action_names = ['btn_towers', 'btn_doctrine', 'btn_evolve', 'btn_power']
    for idx, name in enumerate(action_names):
        if idx < len(items):
            pimg = items[idx]['img'].resize((96, 96), Image.Resampling.LANCZOS)
            pimg.save(os.path.join(OUT_UI, 'actions', f'{name}.png'), 'PNG')
    
    # Özel güç ikonları
    power_names = ['power_meteor', 'power_arrows', 'power_cannon', 'power_bombs', 'power_orbital']
    for pidx, pname in enumerate(power_names):
        item_idx = 4 + pidx
        if item_idx < len(items):
            pimg = items[item_idx]['img'].resize((80, 80), Image.Resampling.LANCZOS)
            pimg.save(os.path.join(OUT_UI, 'powers', f'{pname}.png'), 'PNG')
    print(f" [+] Ana butonlar ve özel güç ikonları kaydedildi.")

# -------------------------------------------------------------
# 7. DOKTRİN KARTLARI
# -------------------------------------------------------------
doc_sheet = os.path.join(SRC, 'Generated Image November 09, 2026 - 3_02AM (5).jpg')
if os.path.exists(doc_sheet):
    items = clean_and_cut_components(doc_sheet, min_area=3000)
    doc_names = ['doc_logistics', 'doc_tactics', 'doc_fortification']
    for idx, dname in enumerate(doc_names):
        if idx < len(items):
            pimg = items[idx]['img'].resize((180, 100), Image.Resampling.LANCZOS)
            pimg.save(os.path.join(OUT_UI, 'doctrines', f'{dname}.png'), 'PNG')
    print(f" [+] Doktrin kartları kaydedildi.")

# -------------------------------------------------------------
# 8. SİSTEM BUTONLARI & MODAL ÖĞELERİ & LOGO
# -------------------------------------------------------------
logo_sheet = os.path.join(SRC, 'Generated Image November 09, 2026 - 2_32AM.jpg')
if os.path.exists(logo_sheet):
    items = clean_and_cut_components(logo_sheet, min_area=3500)
    if len(items) > 0:
        # En büyük öğe genellikle logodur
        items_by_area = sorted(items, key=lambda it: it['w'] * it['h'], reverse=True)
        logo_img = items_by_area[0]['img']
        logo_img.save(os.path.join(OUT_UI, 'modals', 'title_logo.png'), 'PNG')
        print(f" [+] Başlık logosu kaydedildi: title_logo.png ({logo_img.size})")

cta_sheet = os.path.join(SRC, 'Generated Image November 09, 2026 - 3_06AM.jpg')
if os.path.exists(cta_sheet):
    items = clean_and_cut_components(cta_sheet, min_area=3000)
    items_by_area = sorted(items, key=lambda it: it['w'] * it['h'], reverse=True)
    if len(items_by_area) > 0:
        items_by_area[0]['img'].save(os.path.join(OUT_UI, 'modals', 'cta_start.png'), 'PNG')
    if len(items_by_area) > 1:
        items_by_area[1]['img'].save(os.path.join(OUT_UI, 'modals', 'banner_victory.png'), 'PNG')
    if len(items_by_area) > 2:
        items_by_area[2]['img'].save(os.path.join(OUT_UI, 'modals', 'banner_defeat.png'), 'PNG')
    print(f" [+] CTA butonu ve Zafer/Yenilgi bannerları kaydedildi.")

# -------------------------------------------------------------
# 9. BİRİM KART ÇERÇEVELERİ (4 RENK: Swarmer, Ranger, Charger, Tank)
# -------------------------------------------------------------
card_sheet = os.path.join(SRC, 'Generated Image November 09, 2026 - 3_02AM.jpg')
if os.path.exists(card_sheet):
    items = clean_and_cut_components(card_sheet, min_area=2000)
    for idx, arch in enumerate(archetypes):
        if idx < len(items):
            pimg = items[idx]['img'].resize((120, 160), Image.Resampling.LANCZOS)
            pimg.save(os.path.join(OUT_UI, 'cards', f'card_{arch}.png'), 'PNG')
    print(f" [+] Birim kart çerçeveleri kaydedildi.")

print("\n[OK] Tüm UI parçaları ve arka planlar başarıyla hazırlandı!")
