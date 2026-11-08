# Karakter Görsel Promptları (Gemini Nano Banana)

Oyundaki tüm birimler, kuleler ve üsler `src/game/catalog.ts` dosyasından çıkarıldı:
**20 birim + 10 kule + 5 üs = 35 görsel grubu.**

## Nasıl kullanılacak?

Animasyonu kodla (tweening) yapacağımız için her karakteri **parçalara ayrılmış** üretiyoruz.
Her birim için ayrı bir "parça sayfası" (part sheet) istiyoruz: gövde, silah kolu, silah vb. aynı görselde, yan yana, arası boşluklu.
Sonra bu parçaları kesip ayrı PNG yapacağız, kodda `pivot` (dönme noktası) ayarlayıp döndüreceğiz.

**İş akışı:**
1. Önce aşağıdaki **ORTAK STİL BLOĞU**'nu her promptun başına yapıştır (stil tutarlılığı için en önemli şey).
2. İlk birimi üret, beğendiysen onu **referans görsel** olarak yükleyip diğerlerinde "aynı çizim stilinde" de.
3. Arka plan düz magenta (#FF00FF) istiyoruz, sonra kolayca silinir (remove.bg / Photoshop / Photopea).
4. Düşman takım için ayrı çizim gerekmez; kodda yatay çevirip (flip) renk tonu (tint) veririz.
5. Çıktıları `public/assets/units/<id>/` altına koy. Dosya adı: `<id>_body.png`, `<id>_arm.png`, `<id>_weapon.png` ...

---

## ORTAK STİL BLOĞU (her promptun başına ekle)

```
2D side-view game sprite parts sheet, flat vector cartoon style with bold clean dark outlines, soft cel shading, vibrant saturated colors, slightly chunky proportions (big head, small body, cute but battle-ready), character faces RIGHT in a pure side profile. Each separate body part is drawn individually, fully visible, NOT overlapping, laid out in a row with wide gaps on a solid flat pure magenta (#FF00FF) background. No shadows on the ground, no text, no labels, no border, no scenery. Consistent lighting from the top-left. High resolution, crisp edges.
```

> İpucu: Parçalar eklem yerlerinde (omuz, kalça) biraz taşmalı çizilsin; böylece döndürünce boşluk görünmez. Prompta "limbs slightly overextend at joints so they can be rotated without gaps" ekledim.

## Boyut referansı (oyundaki hitbox)
Görseller kare üretilir, ama oyundaki oran bu: swarmer 32x48, ranger/charger/colossus daha büyük (catalog.ts `width/height`). Colossus'lar normal birimin ~2-3 katı büyük çizilsin.

---

# TAŞ DEVRİ (Era 0)

Renk paleti: toprak kahve, kemik beyazı, yeşil yosun, turuncu ateş.

### 1. Sopalı Avcı (`era0_swarmer`) — hızlı yakın hücum
Parçalar: gövde+bacaklar (ayrı sol/sağ bacak), silah kolu, sopa, diğer kol.
```
[ORTAK STİL BLOĞU] Parts sheet of a caveman hunter: (1) torso with head wearing a fur loincloth and a bone necklace, messy black hair, angry grin, (2) front leg, (3) back leg, (4) back arm, (5) front arm gripping with fist open, (6) big knobbly wooden club with bone spikes. Orange-brown (#c27838) fur clothing with pale yellow (#fde68a) bone accents. Limbs slightly overextend at joints so they can be rotated without gaps.
```

### 2. Sapancı İzci (`era0_ranger`) — menzilli
Parçalar: gövde+baş, bacaklar, sapan kolu, sapan ipi, taş.
```
[ORTAK STİL BLOĞU] Parts sheet of a young caveman scout slinger: (1) torso with head wearing a leather headband with a feather, lean build, (2) front leg, (3) back leg, (4) throwing arm, (5) support arm, (6) leather sling with two cords drawn straight, (7) small round grey stone projectile. Brown leather and fur, light tan accents. Limbs slightly overextend at joints so they can be rotated without gaps.
```

### 3. Raptor Süvarisi (`era0_charger`) — hızlı hücum
Parçalar: raptor gövde, raptor ön/arka bacak, kuyruk, çene (alt çene ayrı), binici gövdesi, binici mızrak kolu, taş mızrak.
```
[ORTAK STİL BLOĞU] Parts sheet of a caveman riding a raptor dinosaur: (1) raptor body with head (upper jaw), sharp teeth, orange-green scales with stripes, (2) raptor lower jaw separate, (3) raptor front leg, (4) raptor back leg with large claw, (5) raptor tail separate, (6) caveman rider torso with head in fur, (7) rider spear arm, (8) stone-tipped wooden spear. Limbs slightly overextend at joints so they can be rotated without gaps.
```

### 4. Mamut & Kaya Devi (`era0_colossus`) — dev (büyük çiz)
Parçalar: mamut gövdesi, hortum (ayrı), 4 ayak (ön/arka), kulak, dev binici/kaya devi gövdesi, dev taş kol, dev kaya gürzü.
```
[ORTAK STİL BLOĞU] Parts sheet of a huge woolly mammoth carrying a rock giant: (1) mammoth body with long brown shaggy fur and big curved ivory tusks, head included, (2) separate trunk curled upward, (3) front leg, (4) back leg, (5) ear, (6) stone-skinned rock giant torso with head sitting on the mammoth, mossy boulder skin, glowing orange eyes, (7) giant rock arm with fist, (8) enormous boulder club. Massive and imposing proportions. Limbs slightly overextend at joints so they can be rotated without gaps.
```

---

# ORTA ÇAĞ (Era 1)

Renk paleti: çelik gri, kraliyet mavisi/kırmızısı, altın.

### 5. Kılıçlı Piyade (`era1_swarmer`)
```
[ORTAK STİL BLOĞU] Parts sheet of a medieval footman: (1) torso with head in an open nasal helmet and chainmail tunic with a red tabard, (2) front leg with leather boot, (3) back leg, (4) back arm holding a small round wooden shield (shield as separate part), (5) sword arm, (6) straight steel longsword with golden crossguard. Limbs slightly overextend at joints so they can be rotated without gaps.
```

### 6. Uzun Yaycı (`era1_ranger`)
```
[ORTAK STİL BLOĞU] Parts sheet of a medieval longbow archer: (1) torso with head in a green hood, leather jerkin, quiver on the back, (2) front leg, (3) back leg, (4) bow arm extended, (5) string-pulling arm, (6) tall wooden longbow in relaxed state, (7) same bow fully drawn (string pulled back), (8) single arrow with feather fletching.
```

### 7. Ağır Mızraklı Şövalye (`era1_charger`)
```
[ORTAK STİL BLOĞU] Parts sheet of a heavy lance knight on a warhorse: (1) armored warhorse body with head and a red-and-gold caparison cloth, (2) horse front leg, (3) horse back leg, (4) horse tail separate, (5) knight torso with full great-helm with plume and plate armor, (6) knight lance arm, (7) very long jousting lance with a pennant flag, (8) kite shield.
```

### 8. Demir Kuşatma Kulesi (`era1_colossus`) — dev
```
[ORTAK STİL BLOĞU] Parts sheet of a massive iron-clad medieval siege tower on large wooden wheels, pushed by soldiers: (1) tower body made of timber reinforced with iron plates and rivets, slits for archers, a banner on top, (2) front wheel, (3) back wheel, (4) a drop-down iron-spiked battering ramp/bridge on the front as a separate part, (5) two soldier pushers behind (separate small figures), (6) hanging banner. Massive and imposing.
```

---

# BARUT ÇAĞI (Era 2)

Renk paleti: lacivert, krem, bakır, barut dumanı grisi.

### 9. Yatağanlı Muhafız (`era2_swarmer`)
```
[ORTAK STİL BLOĞU] Parts sheet of an Ottoman-style janissary guard with a curved yatagan sword: (1) torso with head wearing a tall white felt hat, mustache, blue coat with gold buttons, (2) front leg with boots, (3) back leg, (4) back arm, (5) sword arm, (6) curved yatagan blade with ornate brass hilt.
```

### 10. Yeniçeri Tüfekçisi (`era2_ranger`)
```
[ORTAK STİL BLOĞU] Parts sheet of a musketeer: (1) torso with head wearing a tricorn-like hat with a cockade, white cross belts with powder flasks, blue coat, (2) front leg, (3) back leg, (4) rear arm holding the musket stock, (5) front arm holding the barrel, (6) long flintlock musket with brass fittings, (7) separate small muzzle flash burst (orange-yellow), (8) lead bullet.
```

### 11. Kraliyet Dragoonu (`era2_charger`)
```
[ORTAK STİL BLOĞU] Parts sheet of a royal dragoon cavalry on a brown horse: (1) horse body with head, red saddle blanket, (2) front leg, (3) back leg, (4) tail, (5) rider torso with head wearing a plumed helmet and blue-red uniform, (6) rider arm with raised saber, (7) cavalry saber, (8) pistol in hand.
```

### 12. Şahi Buharlı Topu (`era2_colossus`) — dev
```
[ORTAK STİL BLOĞU] Parts sheet of a huge steam-powered royal cannon on armored wheels: (1) heavy iron and brass wagon body with a boiler, rivets and a smokestack, (2) big cannon barrel as separate part (will recoil), (3) front wheel with gear spokes, (4) back wheel, (5) smokestack puff of steam (separate soft cloud), (6) crew gunner figure standing on a platform, (7) cannonball.
```

---

# MODERN ÇAĞ (Era 3)

Renk paleti: haki yeşil, kum, çelik, turuncu patlama.

### 13. Taarruz Komandosu (`era3_swarmer`)
```
[ORTAK STİL BLOĞU] Parts sheet of a modern assault commando: (1) torso with head wearing helmet, goggles and face mask, tactical vest, (2) front leg with combat boot, (3) back leg, (4) rear arm, (5) front arm, (6) compact assault rifle, (7) combat knife, (8) small muzzle flash.
```

### 14. Güdümlü RPG Uzmanı (`era3_ranger`)
```
[ORTAK STİL BLOĞU] Parts sheet of a guided-rocket specialist: (1) torso with head in a helmet, backpack with extra rockets, (2) front leg, (3) back leg, (4) rear arm, (5) front arm, (6) shoulder-fired rocket launcher tube, (7) rocket projectile with a flame tail, (8) backblast smoke puff.
```

### 15. Zırhlı Kruvazör Tankı (`era3_charger`)
```
[ORTAK STİL BLOĞU] Parts sheet of a modern armored cruiser tank, side view: (1) tank hull with olive-drab armor plating, (2) turret separate, (3) long gun barrel separate (will recoil), (4) track/tread assembly with wheels (separate), (5) front and rear small road wheel pieces, (6) antenna, (7) muzzle flash and exhaust smoke puffs.
```

### 16. Goliath Savaş Yürüyücüsü (`era3_colossus`) — dev
```
[ORTAK STİL BLOĞU] Parts sheet of a gigantic bipedal military war-walker mech: (1) torso cockpit with a glass canopy and armor, (2) front leg with big hydraulic knee and foot (upper leg and lower leg separate), (3) back leg (upper and lower separate), (4) left arm with a rocket pod, (5) right arm with heavy autocannon, (6) shoulder missile rack, (7) exhaust puffs. Olive green and steel with orange warning stripes. Massive proportions.
```

---

# SİBER ÇAĞ (Era 4)

Renk paleti: koyu mor/lacivert zemin, neon camgöbeği, neon mor, parlayan detaylar.

### 17. Plazma Muhafızı (`era4_swarmer`)
```
[ORTAK STİL BLOĞU] Parts sheet of a cyber guard: (1) torso with head in a sleek visor helmet with a glowing cyan visor, black-and-purple power armor with neon lines, (2) front leg, (3) back leg, (4) back arm, (5) sword arm, (6) glowing plasma energy blade, (7) small energy shield.
```

### 18. Kuantum Railgun Nişancısı (`era4_ranger`)
```
[ORTAK STİL BLOĞU] Parts sheet of a quantum railgun sniper: (1) torso with head in a helmet with an optical scope eye, cloak-like fiber coat, (2) front leg, (3) back leg, (4) rear arm, (5) front arm, (6) long sleek railgun with glowing cyan coils, (7) laser beam projectile (thin bright neon line), (8) charge glow orb (separate).
```

### 19. Siber Hover-Tank (`era4_charger`)
```
[ORTAK STİL BLOĞU] Parts sheet of a cyber hover-tank, side view: (1) sleek angular hull with neon purple lines, (2) hover thruster pads underneath with cyan glow (separate), (3) turret separate, (4) energy cannon barrel separate (will recoil), (5) engine flame/glow trail (separate), (6) side fin.
```

### 20. Omega Titan Mecha (`era4_colossus`) — dev (en büyük)
```
[ORTAK STİL BLOĞU] Parts sheet of an enormous Omega Titan mecha, final boss scale: (1) chest/torso with a glowing cyan core and a small head with a single visor, (2) front leg (upper and lower separate), (3) back leg (upper and lower separate), (4) left arm with a heavy plasma cannon, (5) right arm with a giant energy fist, (6) back-mounted shoulder cannon / wings, (7) plasma ball projectile. Black, deep purple and gold armor with neon cyan lights. Colossal imposing proportions.
```

---

# KULELER (10 adet)

Kuleler hareket etmez, sadece **taret/silah parçası** döner veya geri teper. Parçalar: sabit gövde + dönen/geri tepen silah.

Kule stil bloğu: ORTAK STİL BLOĞU'ndaki "faces RIGHT" ibaresi aynen kalsın, karakter yerine "defense tower" yaz.

| # | Kule | Prompt (ORTAK STİL BLOĞU + ...) |
|---|---|---|
| 21 | Kemik Ok Kulesi | `Parts sheet of a primitive tower: (1) wooden stilt platform built from logs and bones with fur banners, (2) mounted giant bone bow, (3) arrow made of bone with feathers.` |
| 22 | Volkanik Kaya Mancınığı | `Parts sheet of a primitive catapult: (1) wooden base frame with lava-rock decorations, (2) throwing arm with a bucket (separate, rotates), (3) glowing volcanic boulder projectile with lava cracks.` |
| 23 | Kraliyet Arbalet Kulesi | `Parts sheet of a medieval stone tower: (1) round stone tower with crenellations and a red royal flag, (2) heavy mounted crossbow (separate), (3) large crossbow bolt.` |
| 24 | Kuşatma Trebuchet | `Parts sheet of a medieval trebuchet: (1) wooden A-frame base, (2) long swinging arm with a counterweight box (separate, rotates), (3) sling and stone ball.` |
| 25 | Çoklu Organ Topu | `Parts sheet of a gunpowder rampart: (1) stone-and-brick platform with sandbags, (2) rack of many small cannon barrels side by side (organ gun, separate), (3) iron ball and smoke puff.` |
| 26 | İmparatorluk Havan Topu | `Parts sheet of a gunpowder mortar emplacement: (1) brick fortification base, (2) short fat mortar barrel angled upward (separate, recoils), (3) round bomb with a lit fuse.` |
| 27 | Vulcan Otomatik Top | `Parts sheet of a modern anti-air gun nest: (1) concrete bunker with sandbags, (2) multi-barrel rotary autocannon (separate, rotates), (3) bullet tracer streak, (4) muzzle flash.` |
| 28 | Patriot Füze Bataryası | `Parts sheet of a modern missile battery: (1) armored launcher truck platform, (2) rack of four angled missiles (separate), (3) single missile with flame and smoke trail.` |
| 29 | İyon Foton Kulesi | `Parts sheet of a cyber tower: (1) sleek metal pylon with neon cyan rings, (2) floating ion emitter crystal (separate, hovers), (3) energy beam bolt.` |
| 30 | Kuantum Tesla Bobini | `Parts sheet of a cyber tesla tower: (1) metal base with glowing purple energy conduit, (2) tall tesla coil with sparks (separate, can pulse), (3) lightning arc segment (3 variants).` |

---

# ÜSLER (5 adet, her çağa bir tane)

Üs hareket etmez; yalnızca **hasar aşamaları** için 3 versiyon (sağlam / hasarlı / yıkık) isteyeceğiz.
Üs büyük çizilir (oyunun en büyük objesi, yaklaşık 200x260). Oyuncu üssü sağda mı solda mı engine'e bakıp ayarlarız, şimdilik "left side of the screen, facing right" üret.

```
[ORTAK STİL BLOĞU] Parts sheet of a player base fortress, 3 states side by side: (1) intact, (2) damaged with cracks and smoke and fire, (3) nearly destroyed in ruins. Also include (4) a flag/banner as a separate part that can wave and (5) a gate/door as a separate part.
```
Çağa göre şunları ekle:
- **Taş Devri:** `a cave entrance carved into a huge rock with a skull totem, bone spikes and animal-hide banner.`
- **Orta Çağ:** `a stone castle keep with two towers, wooden gate, red royal banner.`
- **Barut Çağı:** `a star fortress with brick walls, cannons on the ramparts, blue-and-gold flag.`
- **Modern Çağ:** `a concrete military command bunker with radar dish, sandbags, antenna and olive green flag.`
- **Siber Çağ:** `a futuristic neon citadel with a glowing energy dome, floating panels and holo-flag.`

---

# EK: Mermiler ve Efektler (tek sayfada)

Hepsi tek bir "efekt sayfası" olarak üretilebilir:
```
[ORTAK STİL BLOĞU] Sprite sheet of game projectiles and effects, each separate: stone, arrow, flaming arrow, bullet, cannonball, rocket with flame, laser bolt (cyan), plasma ball (purple), meteor with fire trail, explosion (3 frames), muzzle flash, hit spark, smoke puff, dust cloud.
```

---

## Sonraki adım

Görselleri ürettikçe `public/assets/units/...` altına at. Ben de:
1. Parçaları yükleyen bir sprite sistemi,
2. Yürüme (zıplama + squash/stretch), saldırı (kol dönmesi), ölüm (devrilme/fade) tweenlerini,
3. Sapancı/okçu için yay çekme (scale) animasyonunu
`engine.ts`/canvas çizim koduna entegre edeceğim.

İlk iş olarak **1 birimi** (örn. Sopalı Avcı) üretip bana gönder, parça sistemini onun üzerinde kuralım, sonra kalanını toplu üretiriz.
