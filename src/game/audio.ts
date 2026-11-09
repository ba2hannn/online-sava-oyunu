/**
 * Oyun sesleri — tamamen WebAudio ile üretilir (ses dosyası yok).
 *
 * Tasarım ilkeleri:
 *  - Çağa uyumlu: Taş Devri davul/kemik/odun, Orta Çağ çelik/boru, Barut Çağı top/fife,
 *    Modern Çağ telsiz/tüfek/motor, Siber Çağ sentezleyici/lazer.
 *  - Katmanlı sesler: gövde (ton) + gürültü (doku) + yankı (reverb) birlikte çalar.
 *  - Kalabalık savaşta kakofoni olmasın diye ses sınırlayıcı (aynı ses için bekleme süresi,
 *    toplam eşzamanlı ses sınırı) ve ana kanalda kompresör var.
 *  - Çağa göre değişen hafif, döngüsel bir savaş müziği.
 */

type Wave = 'sine' | 'square' | 'sawtooth' | 'triangle';
type FilterSpec = { type: BiquadFilterType; f0: number; f1?: number; q?: number };

interface ToneOpts {
  type?: Wave;
  f0: number;
  f1?: number; // süre boyunca üstel olarak bu frekansa kayar
  dur: number;
  gain?: number;
  attack?: number;
  delay?: number;
  detune?: number;
  filter?: FilterSpec;
  wet?: number; // yankıya gönderme miktarı 0..1
  bus?: 'sfx' | 'music';
  pan?: number;
}

interface NoiseOpts {
  dur: number;
  gain?: number;
  attack?: number;
  delay?: number;
  filter?: FilterSpec;
  wet?: number;
  bus?: 'sfx' | 'music';
  pan?: number;
}

const SEMI = (n: number) => Math.pow(2, n / 12);

class SoundEngine {
  private ctx: AudioContext | null = null;
  private muted = false;

  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  private lastPlay = new Map<string, number>();
  private activeVoices = 0;
  private readonly MAX_VOICES = 36;

  // ---- müzik durumu
  private musicTimer: number | null = null;
  private musicEra = 0;
  private musicWanted = false;
  private nextBeatTime = 0;
  private beatIndex = 0;
  private musicVolume = 0.16;
  private musicHold = false;

  // ------------------------------------------------------------------ altyapı
  private ensureContext(): AudioContext | null {
    if (this.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.buildGraph(this.ctx);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  private buildGraph(ctx: AudioContext): void {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 6;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);

    // Üretilmiş (sentetik) yankı: kısa, koyu bir salon
    const len = Math.floor(ctx.sampleRate * 1.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * (1 - 0.35 * t);
      }
    }
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const wetGain = ctx.createGain();
    wetGain.gain.value = 0.55;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(conv);
    conv.connect(wetGain);
    wetGain.connect(this.master);

    // Beyaz gürültü tamponu (2 sn, döngüde kullanılır)
    const nlen = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (mute) this.stopMusicTimer();
    else if (this.musicWanted) this.startMusicTimer();
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  private rand(a: number, b: number): number {
    return a + Math.random() * (b - a);
  }

  private vary(f: number, pct = 0.06): number {
    return f * (1 + (Math.random() * 2 - 1) * pct);
  }

  /** Aynı sesin çok sık çalmasını engeller; kalabalık savaşta temiz bir miks sağlar. */
  private gate(key: string, minMs: number): boolean {
    const now = performance.now();
    const last = this.lastPlay.get(key) ?? -1e9;
    if (now - last < minMs) return false;
    this.lastPlay.set(key, now);
    return this.activeVoices < this.MAX_VOICES;
  }

  private busNode(bus?: 'sfx' | 'music'): GainNode {
    return (bus === 'music' ? this.musicBus : this.sfxBus)!;
  }

  private chain(ctx: AudioContext, src: AudioNode, g: GainNode, o: { filter?: FilterSpec; wet?: number; bus?: 'sfx' | 'music'; pan?: number }, t0: number, dur: number): void {
    let node: AudioNode = src;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter.type;
      f.frequency.setValueAtTime(o.filter.f0, t0);
      if (o.filter.f1 !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.filter.f1), t0 + dur);
      f.Q.value = o.filter.q ?? 0.8;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    let out: AudioNode = g;
    if (o.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      out.connect(p);
      out = p;
    }
    out.connect(this.busNode(o.bus));
    if (o.wet && this.reverbSend) {
      const s = ctx.createGain();
      s.gain.value = o.wet;
      out.connect(s);
      s.connect(this.reverbSend);
    }
  }

  private tone(o: ToneOpts): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(10, o.f1), t0 + o.dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const peak = o.gain ?? 0.1;
    const atk = Math.min(o.attack ?? 0.004, o.dur * 0.5);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    this.chain(ctx, osc, g, o, t0, o.dur);
    this.activeVoices++;
    osc.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
  }

  private noise(o: NoiseOpts): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const g = ctx.createGain();
    const peak = o.gain ?? 0.1;
    const atk = Math.min(o.attack ?? 0.002, o.dur * 0.5);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    this.chain(ctx, src, g, o, t0, o.dur);
    this.activeVoices++;
    src.onended = () => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + o.dur + 0.02);
  }

  // ------------------------------------------------------------------ arayüz
  public playUiClick(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.gate('click', 25)) return;
    this.tone({ type: 'triangle', f0: this.vary(760, 0.03), f1: 1180, dur: 0.07, gain: 0.07 });
    this.noise({ dur: 0.02, gain: 0.03, filter: { type: 'highpass', f0: 3500 } });
  }

  /** Para yetmiyor / komut reddedildi */
  public playUiDeny(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.gate('deny', 120)) return;
    this.tone({ type: 'square', f0: 220, f1: 190, dur: 0.1, gain: 0.05, filter: { type: 'lowpass', f0: 1200 } });
    this.tone({ type: 'square', f0: 165, f1: 140, dur: 0.14, gain: 0.05, delay: 0.09, filter: { type: 'lowpass', f0: 1000 } });
  }

  public playGold(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.gate('gold', 90)) return;
    this.tone({ type: 'sine', f0: 1318, dur: 0.16, gain: 0.05, wet: 0.2 });
    this.tone({ type: 'sine', f0: 1760, dur: 0.22, gain: 0.05, delay: 0.06, wet: 0.2 });
  }

  /** Kule kurma / yükseltme */
  public playBuild(): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.gate('build', 120)) return;
    for (let i = 0; i < 2; i++) {
      const d = i * 0.11;
      this.noise({ dur: 0.07, gain: 0.12, delay: d, filter: { type: 'bandpass', f0: 1800, q: 1.2 } });
      this.tone({ type: 'sine', f0: 190, f1: 90, dur: 0.1, gain: 0.14, delay: d });
    }
    [523.25, 659.25, 783.99].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.3, gain: 0.05, delay: 0.26 + i * 0.06, wet: 0.25 }));
  }

  // ------------------------------------------------------------------ birim çağırma
  public playSpawn(era = 0, archetype = 'swarmer'): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.gate('spawn' + era, 70)) return;
    const big = archetype === 'colossus';
    switch (era) {
      case 0: // kabile davulu + kemik takırtısı
        this.tone({ type: 'sine', f0: this.vary(150), f1: 62, dur: 0.22, gain: 0.2, wet: 0.2 });
        this.noise({ dur: 0.06, gain: 0.09, filter: { type: 'bandpass', f0: 2200, q: 2 }, delay: 0.02 });
        this.noise({ dur: 0.05, gain: 0.07, filter: { type: 'bandpass', f0: 1700, q: 2 }, delay: 0.09 });
        break;
      case 1: // kınından çekilen kılıç + kısa boru
        this.noise({ dur: 0.22, gain: 0.07, filter: { type: 'highpass', f0: 2500, f1: 7000, q: 0.6 } });
        this.tone({ type: 'sine', f0: 1640, dur: 0.35, gain: 0.04, delay: 0.14, wet: 0.3 });
        this.tone({ type: 'sawtooth', f0: 233, dur: 0.22, gain: 0.05, delay: 0.1, filter: { type: 'lowpass', f0: 900 }, wet: 0.25 });
        break;
      case 2: // fife + küçük trampet
        this.tone({ type: 'sawtooth', f0: 392, dur: 0.1, gain: 0.06, filter: { type: 'lowpass', f0: 1600 } });
        this.tone({ type: 'sawtooth', f0: 523.25, dur: 0.16, gain: 0.06, delay: 0.09, filter: { type: 'lowpass', f0: 1800 }, wet: 0.2 });
        this.noise({ dur: 0.08, gain: 0.07, delay: 0.03, filter: { type: 'bandpass', f0: 3200, q: 0.9 } });
        break;
      case 3: // telsiz bip + statik
        this.tone({ type: 'sine', f0: 1000, dur: 0.07, gain: 0.07 });
        this.tone({ type: 'sine', f0: 1450, dur: 0.09, gain: 0.07, delay: 0.09 });
        this.noise({ dur: 0.18, gain: 0.035, filter: { type: 'bandpass', f0: 2800, q: 0.7 } });
        break;
      default: // sentezleyici ışınlanma
        this.tone({ type: 'sine', f0: 240, f1: 1500, dur: 0.28, gain: 0.07, wet: 0.45 });
        this.tone({ type: 'triangle', f0: 480, f1: 3000, dur: 0.28, gain: 0.03, wet: 0.45 });
        this.tone({ type: 'sine', f0: 1800, dur: 0.3, gain: 0.03, delay: 0.2, wet: 0.5 });
    }
    if (big) {
      this.tone({ type: 'sine', f0: 80, f1: 32, dur: 0.4, gain: 0.24, delay: 0.05, wet: 0.3 });
      this.noise({ dur: 0.3, gain: 0.07, delay: 0.05, filter: { type: 'lowpass', f0: 500 } });
    }
  }

  // ------------------------------------------------------------------ saldırı sesleri
  public playShot(type: string): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.gate('shot' + type, 45)) return;
    switch (type) {
      case 'arrow': // yay kirişi + ok vızıltısı
        this.tone({ type: 'triangle', f0: this.vary(330), f1: 150, dur: 0.09, gain: 0.08 });
        this.noise({ dur: 0.16, gain: 0.05, filter: { type: 'highpass', f0: 2500, f1: 5500 } });
        break;
      case 'stone': // sapan savurma + kaya
        this.noise({ dur: 0.2, gain: 0.08, filter: { type: 'bandpass', f0: 500, f1: 1800, q: 1.4 } });
        this.tone({ type: 'sine', f0: this.vary(170), f1: 80, dur: 0.12, gain: 0.1 });
        break;
      case 'bullet': // tüfek patlaması
        this.noise({ dur: 0.13, gain: 0.16, filter: { type: 'lowpass', f0: 5000, f1: 700 }, wet: 0.15 });
        this.tone({ type: 'sine', f0: 190, f1: 55, dur: 0.1, gain: 0.12 });
        break;
      case 'cannon': // top gümbürtüsü
        this.noise({ dur: 0.45, gain: 0.2, filter: { type: 'lowpass', f0: 1800, f1: 140 }, wet: 0.4 });
        this.tone({ type: 'sine', f0: 125, f1: 34, dur: 0.5, gain: 0.3, wet: 0.3 });
        break;
      case 'rocket':
      case 'missile':
      case 'airstrike': // ateşleme + fışkıran roket
        this.tone({ type: 'sine', f0: 100, f1: 45, dur: 0.18, gain: 0.18 });
        this.noise({ dur: 0.6, gain: 0.11, attack: 0.05, filter: { type: 'bandpass', f0: 350, f1: 2200, q: 0.9 }, wet: 0.3 });
        break;
      case 'laser': // lazer: hızlı düşen testere dişi
        this.tone({ type: 'sawtooth', f0: this.vary(1900), f1: 260, dur: 0.14, gain: 0.07, filter: { type: 'bandpass', f0: 2500, f1: 600, q: 2 }, wet: 0.2 });
        break;
      case 'ion': // iyon: temiz yükselen çınlama
        this.tone({ type: 'sine', f0: 500, f1: 2100, dur: 0.18, gain: 0.07, wet: 0.35 });
        this.tone({ type: 'triangle', f0: 1000, f1: 4200, dur: 0.18, gain: 0.025, wet: 0.35 });
        break;
      case 'plasma': { // plazma: titreyen vınlama
        const f = this.vary(420);
        this.tone({ type: 'sawtooth', f0: f, f1: f * 0.55, dur: 0.22, gain: 0.07, filter: { type: 'lowpass', f0: 2400, f1: 500, q: 4 }, wet: 0.3 });
        this.tone({ type: 'sine', f0: f * 2.01, f1: f * 1.1, dur: 0.2, gain: 0.04, wet: 0.3 });
        break;
      }
      case 'tesla': // tesla: kısa çıtırtılar
        for (let i = 0; i < 5; i++) {
          this.noise({ dur: 0.03, gain: 0.07, delay: i * 0.025, filter: { type: 'highpass', f0: this.rand(3000, 7000) } });
        }
        this.tone({ type: 'sine', f0: 140, dur: 0.16, gain: 0.07, wet: 0.2 });
        break;
      case 'meteor':
        this.noise({ dur: 0.7, gain: 0.1, filter: { type: 'bandpass', f0: 1500, f1: 250, q: 0.7 }, wet: 0.35 });
        break;
      default:
        this.tone({ type: 'triangle', f0: this.vary(410), f1: 160, dur: 0.08, gain: 0.07 });
    }
  }

  /** Yakın dövüş savuruşu (çağa göre silah sesi) */
  public playMelee(era = 0, archetype = 'swarmer'): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.gate('melee' + era + archetype, 60)) return;
    const heavy = archetype === 'colossus' || archetype === 'charger';
    switch (era) {
      case 0: // odun gürz
        this.noise({ dur: 0.1, gain: 0.07, filter: { type: 'bandpass', f0: 700, f1: 350, q: 1 } });
        this.tone({ type: 'sine', f0: this.vary(210), f1: 85, dur: 0.12, gain: 0.14, delay: 0.03 });
        break;
      case 1: // çelik kılıç şakırtısı
        this.noise({ dur: 0.12, gain: 0.06, filter: { type: 'highpass', f0: 3000, f1: 8000 } });
        [1250, 1900, 2750].forEach((f, i) => this.tone({ type: 'sine', f0: this.vary(f, 0.02), dur: 0.22 - i * 0.04, gain: 0.04, delay: 0.04, wet: 0.2 }));
        break;
      case 2: // yatağan çekişi
        this.noise({ dur: 0.14, gain: 0.07, filter: { type: 'highpass', f0: 2200, f1: 6500 } });
        this.tone({ type: 'sine', f0: this.vary(1500, 0.03), dur: 0.2, gain: 0.04, delay: 0.05, wet: 0.2 });
        break;
      case 3: // dipçik / bıçak
        this.noise({ dur: 0.07, gain: 0.08, filter: { type: 'bandpass', f0: 1400, q: 1.2 } });
        this.tone({ type: 'sine', f0: 160, f1: 70, dur: 0.1, gain: 0.12, delay: 0.02 });
        break;
      default: // enerji bıçağı
        this.tone({ type: 'sawtooth', f0: 220, f1: 900, dur: 0.16, gain: 0.05, filter: { type: 'bandpass', f0: 1200, q: 3 }, wet: 0.25 });
        this.tone({ type: 'sine', f0: 1500, f1: 700, dur: 0.14, gain: 0.04, delay: 0.04 });
    }
    if (heavy) {
      this.tone({ type: 'sine', f0: 90, f1: 38, dur: 0.3, gain: 0.2, delay: 0.04, wet: 0.2 });
      this.noise({ dur: 0.18, gain: 0.07, delay: 0.04, filter: { type: 'lowpass', f0: 600 } });
    }
  }

  /** Mermi/darbe isabeti. heavy: alan hasarı ya da ağır vuruş (patlama) */
  public playHit(heavy = false): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.gate(heavy ? 'hitH' : 'hit', heavy ? 70 : 35)) return;
    if (heavy) {
      this.noise({ dur: 0.5, gain: 0.18, filter: { type: 'lowpass', f0: 2600, f1: 160 }, wet: 0.45 });
      this.tone({ type: 'sine', f0: this.vary(105), f1: 32, dur: 0.42, gain: 0.3, wet: 0.3 });
      this.noise({ dur: 0.1, gain: 0.1, filter: { type: 'highpass', f0: 3500 } });
    } else {
      this.tone({ type: 'sine', f0: this.vary(170), f1: 70, dur: 0.09, gain: 0.12 });
      this.noise({ dur: 0.07, gain: 0.1, filter: { type: 'lowpass', f0: 1400, f1: 300 } });
      if (Math.random() < 0.3) this.tone({ type: 'sine', f0: this.vary(2100, 0.1), dur: 0.12, gain: 0.025, wet: 0.2 });
    }
  }

  /** Kale hasar alırken (çağa göre malzeme) */
  public playBaseHit(era = 0): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.gate('baseHit', 90)) return;
    this.tone({ type: 'sine', f0: 85, f1: 34, dur: 0.38, gain: 0.26, wet: 0.35 });
    this.noise({ dur: 0.35, gain: 0.12, filter: { type: 'lowpass', f0: 1100, f1: 200 }, wet: 0.3 });
    if (era === 0) {
      this.noise({ dur: 0.08, gain: 0.08, delay: 0.03, filter: { type: 'bandpass', f0: 600, q: 1.5 } }); // kemik/odun çatırtısı
    } else if (era === 1 || era === 2) {
      for (let i = 0; i < 4; i++) this.noise({ dur: 0.05, gain: 0.05, delay: 0.05 + i * 0.05, filter: { type: 'bandpass', f0: this.rand(900, 2200), q: 2 } }); // taş dökülmesi
    } else {
      this.tone({ type: 'sine', f0: this.vary(1700, 0.1), dur: 0.35, gain: 0.04, delay: 0.03, wet: 0.35 }); // metal çınlama
    }
  }

  /** Birim ölümü */
  public playUnitDeath(era = 0, archetype = 'swarmer'): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.gate('death' + archetype, 80)) return;
    const machine = era >= 3 && (archetype === 'charger' || archetype === 'colossus');
    if (archetype === 'colossus') {
      this.tone({ type: 'sine', f0: 70, f1: 28, dur: 0.7, gain: 0.32, wet: 0.4 });
      this.noise({ dur: 0.8, gain: 0.16, filter: { type: 'lowpass', f0: 1500, f1: 100 }, wet: 0.45 });
      if (era >= 3) this.noise({ dur: 0.25, gain: 0.07, delay: 0.05, filter: { type: 'bandpass', f0: 2600, q: 2 } });
      return;
    }
    if (machine) {
      this.noise({ dur: 0.35, gain: 0.14, filter: { type: 'lowpass', f0: 2200, f1: 250 }, wet: 0.3 });
      this.tone({ type: 'sawtooth', f0: 300, f1: 50, dur: 0.4, gain: 0.08, filter: { type: 'lowpass', f0: 900 } });
      return;
    }
    if (era >= 4) { // enerji sönmesi
      this.tone({ type: 'sawtooth', f0: 900, f1: 90, dur: 0.3, gain: 0.06, filter: { type: 'lowpass', f0: 2000, f1: 200 }, wet: 0.3 });
      return;
    }
    // "offf" — formant benzeri alçalan ses + yere düşüş
    const f = this.vary(archetype === 'ranger' ? 300 : 230, 0.12);
    this.tone({ type: 'sawtooth', f0: f, f1: f * 0.45, dur: 0.22, gain: 0.07, filter: { type: 'bandpass', f0: 700, f1: 420, q: 2.5 } });
    this.noise({ dur: 0.1, gain: 0.07, delay: 0.14, filter: { type: 'lowpass', f0: 700 } });
    this.tone({ type: 'sine', f0: 100, f1: 50, dur: 0.12, gain: 0.1, delay: 0.14 });
  }

  // ------------------------------------------------------------------ büyük anlar
  public playEraEvolve(era = 1): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    // yükselen arpej + parlak süpürme + derin gümbürtü
    const root = 261.63 * SEMI(era * 2);
    [0, 4, 7, 12, 16].forEach((n, i) => {
      this.tone({ type: 'triangle', f0: root * SEMI(n), dur: 0.5, gain: 0.09, delay: i * 0.085, wet: 0.45 });
      this.tone({ type: 'sine', f0: root * SEMI(n) * 2, dur: 0.45, gain: 0.03, delay: i * 0.085, wet: 0.45 });
    });
    this.noise({ dur: 0.9, gain: 0.07, attack: 0.5, filter: { type: 'highpass', f0: 1000, f1: 8000 }, wet: 0.5 });
    this.tone({ type: 'sine', f0: 60, f1: 120, dur: 0.9, gain: 0.2, attack: 0.3, wet: 0.3 });
  }

  public playSpecialPower(era = 0): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    switch (era) {
      case 0: // meteor yağmuru: uzaktan yaklaşan gümbürtü + art arda çarpmalar
        this.noise({ dur: 1.1, gain: 0.13, attack: 0.3, filter: { type: 'lowpass', f0: 300, f1: 1400 }, wet: 0.4 });
        [0.5, 0.72, 0.95].forEach((d) => this.playBoom(d, 0.8));
        break;
      case 1: // alevli ok yağmuru: art arda vızıltılar
        for (let i = 0; i < 12; i++) this.noise({ dur: 0.2, gain: 0.05, delay: i * 0.06, filter: { type: 'highpass', f0: this.rand(2000, 4000), f1: 6500 }, pan: this.rand(-0.6, 0.6) });
        this.noise({ dur: 0.9, gain: 0.06, filter: { type: 'bandpass', f0: 900, q: 0.6 } });
        break;
      case 2: // donanma topçu ateşi: ardışık top sesleri
        [0, 0.22, 0.5, 0.78].forEach((d) => {
          this.noise({ dur: 0.45, gain: 0.16, delay: d, filter: { type: 'lowpass', f0: 1800, f1: 140 }, wet: 0.45 });
          this.tone({ type: 'sine', f0: 120, f1: 32, dur: 0.5, gain: 0.26, delay: d, wet: 0.3 });
        });
        break;
      case 3: // halı bombardımanı: uçak vınlaması + düşen bomba ıslıkları + patlamalar
        this.tone({ type: 'sawtooth', f0: 82, f1: 95, dur: 1.2, gain: 0.05, filter: { type: 'lowpass', f0: 420 }, wet: 0.3 });
        [0.35, 0.58, 0.8, 1.02].forEach((d) => {
          this.tone({ type: 'sine', f0: 1900, f1: 500, dur: 0.3, gain: 0.03, delay: d - 0.3 });
          this.playBoom(d, 0.7);
        });
        break;
      default: // yörünge iyon lazeri: şarj + büyük ışın
        this.tone({ type: 'sine', f0: 90, f1: 2400, dur: 0.9, gain: 0.08, attack: 0.5, wet: 0.5 });
        this.tone({ type: 'sawtooth', f0: 180, f1: 4000, dur: 0.9, gain: 0.03, attack: 0.5, filter: { type: 'lowpass', f0: 3000 }, wet: 0.5 });
        this.noise({ dur: 1.1, gain: 0.14, delay: 0.9, attack: 0.02, filter: { type: 'bandpass', f0: 3000, f1: 400, q: 0.8 }, wet: 0.5 });
        this.tone({ type: 'sine', f0: 70, f1: 28, dur: 0.9, gain: 0.3, delay: 0.9, wet: 0.4 });
    }
  }

  private playBoom(delay: number, g: number): void {
    this.noise({ dur: 0.55, gain: 0.2 * g, delay, filter: { type: 'lowpass', f0: 2400, f1: 140 }, wet: 0.5 });
    this.tone({ type: 'sine', f0: 95, f1: 30, dur: 0.5, gain: 0.32 * g, delay, wet: 0.35 });
  }

  public playOutcome(victory: boolean): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.stopMusicTimer();
    this.musicHold = true; // sonuç jingle'ı sırasında müzik geri gelmesin
    if (victory) {
      // parlak majör fanfar: boru benzeri filtreli testere dişi
      const prog: number[][] = [[0, 4, 7], [5, 9, 12], [7, 11, 14], [12, 16, 19]];
      prog.forEach((ch, i) => {
        ch.forEach((n) => {
          this.tone({ type: 'sawtooth', f0: 293.66 * SEMI(n), dur: i === 3 ? 1.2 : 0.3, gain: 0.045, delay: i * 0.22, filter: { type: 'lowpass', f0: 1800 }, wet: 0.4 });
          this.tone({ type: 'triangle', f0: 293.66 * SEMI(n) / 2, dur: i === 3 ? 1.2 : 0.3, gain: 0.05, delay: i * 0.22, wet: 0.3 });
        });
      });
      this.noise({ dur: 0.5, gain: 0.05, delay: 0.66, filter: { type: 'highpass', f0: 6000 }, wet: 0.5 });
    } else {
      // yavaş inen minör
      const prog: number[][] = [[0, 3, 7], [-2, 1, 5], [-4, 0, 3], [-7, -4, 0]];
      prog.forEach((ch, i) => {
        ch.forEach((n) => {
          this.tone({ type: 'triangle', f0: 293.66 * SEMI(n), dur: i === 3 ? 1.6 : 0.5, gain: 0.06, delay: i * 0.32, filter: { type: 'lowpass', f0: 1100 }, wet: 0.5 });
        });
      });
      this.tone({ type: 'sine', f0: 60, f1: 40, dur: 1.4, gain: 0.2, delay: 0.96, wet: 0.3 });
    }
  }

  // ------------------------------------------------------------------ müzik
  /**
   * Motor her karede çağırır: savaş oynanırken (playing) çağa uygun hafif müzik çalar,
   * duraklatma/başlık/bitişte kesilir.
   */
  public syncMusic(playing: boolean, era: number): void {
    if (typeof window === 'undefined') return;
    if (!playing) this.musicHold = false;
    if (playing && this.musicHold) return;
    if (playing) {
      if (!this.musicWanted || this.musicEra !== era) {
        this.musicWanted = true;
        this.musicEra = Math.max(0, Math.min(4, era));
        this.beatIndex = 0;
        if (this.ctx) this.nextBeatTime = this.ctx.currentTime + 0.1;
      }
      if (this.musicTimer === null && !this.muted && this.ensureContext()) this.startMusicTimer();
    } else if (this.musicWanted) {
      this.musicWanted = false;
      this.stopMusicTimer();
    }
  }

  private startMusicTimer(): void {
    if (this.musicTimer !== null || !this.ctx) return;
    this.nextBeatTime = this.ctx.currentTime + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 120);
  }

  private stopMusicTimer(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  private scheduleMusic(): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || !this.musicWanted) return;
    const era = this.musicEra;
    const bpm = [88, 96, 104, 112, 122][era];
    const step = 60 / bpm / 2; // sekizlik nota
    const lookAhead = 0.45;
    while (this.nextBeatTime < ctx.currentTime + lookAhead) {
      this.musicStep(era, this.beatIndex, Math.max(0, this.nextBeatTime - ctx.currentTime), step);
      this.nextBeatTime += step;
      this.beatIndex++;
    }
  }

  private musicStep(era: number, i: number, delay: number, step: number): void {
    const bar = Math.floor(i / 8); // 8 sekizlik = 1 ölçü
    const pos = i % 8;
    // her çağın tonu / dizisi
    const roots = [55, 58.27, 61.74, 65.41, 69.3]; // A1, A#1, B1, C2, C#2
    const scales: number[][] = [
      [0, 3, 5, 7, 10], // minör pentatonik
      [0, 2, 3, 7, 9], // dorian renkli
      [0, 3, 5, 7, 8], // doğu/harmonik hissi
      [0, 3, 5, 6, 10], // gerilimli
      [0, 3, 7, 10, 12], // sentezleyici akor tonları
    ];
    const sc = scales[era];
    const root = roots[era];
    const chordRoot = [0, 0, 5, 3][bar % 4]; // basit ilerleme
    const bass = root * SEMI(chordRoot);

    const mt = (o: ToneOpts) => this.tone({ ...o, bus: 'music', delay: delay + (o.delay ?? 0) });
    const mn = (o: NoiseOpts) => this.noise({ ...o, bus: 'music', delay: delay + (o.delay ?? 0) });

    // Bas (her ölçüde 1. ve 5. vuruş)
    if (pos === 0 || pos === 4) {
      const f = bass * (pos === 4 ? 1.5 : 1) * 2;
      mt({ type: era >= 3 ? 'sawtooth' : 'triangle', f0: f, dur: step * 3.2, gain: era >= 3 ? 0.07 : 0.11, filter: { type: 'lowpass', f0: era >= 3 ? 500 : 800 }, attack: 0.02 });
    }
    // Davul: tekme 1&3, vurma 2&4 (sekizlik 0, 4 ve 2, 6)
    if (pos === 0 || pos === 4) {
      mt({ type: 'sine', f0: era === 0 ? 120 : 110, f1: 45, dur: 0.18, gain: era === 0 ? 0.28 : 0.22 });
    }
    if (pos === 2 || pos === 6) {
      mn({ dur: 0.1, gain: era === 0 ? 0.04 : 0.08, filter: { type: 'bandpass', f0: era === 0 ? 900 : 2400, q: 0.8 } });
      if (era === 0) mt({ type: 'sine', f0: 200, f1: 90, dur: 0.12, gain: 0.12 });
    }
    // Tef / hi-hat (çağ 2 ve sonrası)
    if (era >= 2 && pos % 2 === 1) {
      mn({ dur: 0.03, gain: 0.025, filter: { type: 'highpass', f0: 7000 } });
    }
    // Yumuşak pad (ölçü başında)
    if (pos === 0 && era >= 1) {
      [0, 7, 12].forEach((n) => {
        mt({ type: era >= 4 ? 'sawtooth' : 'sine', f0: bass * 4 * SEMI(n), dur: step * 8, gain: era >= 4 ? 0.018 : 0.03, attack: 0.5, filter: { type: 'lowpass', f0: 1400 }, wet: 0.5 });
      });
    }
    // Melodi: seyrek, tutarlı bir dizi içinde (rastgele ama tonal)
    const melodyChance = [0.35, 0.4, 0.4, 0.34, 0.45][era];
    if (pos % 2 === 0 && pos !== 0 && Math.random() < melodyChance) {
      const deg = sc[Math.floor(Math.random() * sc.length)];
      const oct = Math.random() < 0.3 ? 8 : 4;
      const f = root * oct * SEMI(deg + chordRoot);
      const timbre: Wave = era === 0 ? 'sine' : era === 1 ? 'triangle' : era === 2 ? 'sawtooth' : era === 3 ? 'triangle' : 'square';
      mt({ type: timbre, f0: f, dur: step * 1.8, gain: era === 2 ? 0.03 : 0.045, filter: era === 2 || era === 4 ? { type: 'lowpass', f0: 1800 } : undefined, wet: 0.5, attack: 0.01 });
    }
    // Siber çağda hızlı arpej
    if (era === 4 && pos % 2 === 1) {
      const f = root * 8 * SEMI(sc[(i * 3) % sc.length] + chordRoot);
      mt({ type: 'square', f0: f, dur: step * 0.7, gain: 0.018, filter: { type: 'lowpass', f0: 2400 }, wet: 0.35 });
    }
  }
}

export const soundEngine = new SoundEngine();
