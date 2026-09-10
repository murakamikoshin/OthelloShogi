/**
 * 効果音。音源ファイルは持たず、Web Audio でその場で作る。
 * 配信物を増やしたくないのと、駒音くらいなら合成で十分なため。
 *
 * ブラウザは操作なしに音を鳴らせないので、最初のタップで初期化する。
 */
const MUTE_KEY = 'negaeri:mute';

type Voice = 'place' | 'move' | 'capture' | 'flip' | 'chain' | 'win' | 'lose';

interface Tone {
  readonly freq: number;
  readonly duration: number;
  readonly type: OscillatorType;
  readonly gain: number;
  /** 鳴らし始めるまでの遅れ（秒） */
  readonly delay?: number;
  /** 終わりの周波数（指定すると滑らかに動く） */
  readonly toFreq?: number;
}

const VOICES: Record<Voice, readonly Tone[]> = {
  // 駒を打つ音。木を打ちつける感じ
  place: [{ freq: 320, toFreq: 150, duration: 0.09, type: 'triangle', gain: 0.28 }],
  move: [{ freq: 240, toFreq: 140, duration: 0.07, type: 'triangle', gain: 0.2 }],
  capture: [
    { freq: 380, toFreq: 120, duration: 0.13, type: 'square', gain: 0.16 },
    { freq: 170, duration: 0.1, type: 'triangle', gain: 0.2, delay: 0.03 },
  ],
  // 反転音。段が上がるほど高くする（呼び出し側で移調する）
  flip: [{ freq: 660, toFreq: 880, duration: 0.11, type: 'sine', gain: 0.2 }],
  chain: [
    { freq: 880, duration: 0.1, type: 'sine', gain: 0.22 },
    { freq: 1175, duration: 0.1, type: 'sine', gain: 0.22, delay: 0.08 },
    { freq: 1568, duration: 0.22, type: 'sine', gain: 0.24, delay: 0.16 },
  ],
  win: [
    { freq: 523, duration: 0.14, type: 'triangle', gain: 0.22 },
    { freq: 659, duration: 0.14, type: 'triangle', gain: 0.22, delay: 0.13 },
    { freq: 784, duration: 0.3, type: 'triangle', gain: 0.24, delay: 0.26 },
  ],
  lose: [
    { freq: 392, duration: 0.16, type: 'triangle', gain: 0.2 },
    { freq: 330, duration: 0.16, type: 'triangle', gain: 0.2, delay: 0.15 },
    { freq: 262, duration: 0.34, type: 'triangle', gain: 0.22, delay: 0.3 },
  ],
};

export class Sound {
  private context: AudioContext | null = null;
  private muted: boolean;

  constructor() {
    this.muted = window.localStorage.getItem(MUTE_KEY) === 'yes';
  }

  get isMuted(): boolean {
    return this.muted;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    window.localStorage.setItem(MUTE_KEY, this.muted ? 'yes' : 'no');
    return this.muted;
  }

  /** 最初のタップで呼ぶ。ブラウザの自動再生制限を外すため。 */
  unlock(): void {
    if (this.muted) return;
    this.ensureContext()?.resume().catch(() => {
      /* 音が出せない環境では黙って諦める */
    });
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.context = new Ctor();
    } catch {
      return null;
    }
    return this.context;
  }

  /**
   * @param semitones 半音単位の移調。連鎖の段が上がるほど高くするのに使う
   */
  play(voice: Voice, semitones = 0): void {
    if (this.muted) return;
    const context = this.ensureContext();
    if (!context) return;
    if (context.state === 'suspended') void context.resume().catch(() => {});

    const shift = 2 ** (semitones / 12);
    const now = context.currentTime;

    for (const tone of VOICES[voice]) {
      const start = now + (tone.delay ?? 0);
      const oscillator = context.createOscillator();
      const amp = context.createGain();

      oscillator.type = tone.type;
      oscillator.frequency.setValueAtTime(tone.freq * shift, start);
      if (tone.toFreq !== undefined) {
        oscillator.frequency.exponentialRampToValueAtTime(
          tone.toFreq * shift,
          start + tone.duration,
        );
      }

      // 立ち上がりを少しだけ鈍らせないとプチッと鳴る
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.exponentialRampToValueAtTime(tone.gain, start + 0.008);
      amp.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);

      oscillator.connect(amp).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + tone.duration + 0.02);
    }
  }
}
