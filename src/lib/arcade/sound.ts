/**
 * Cabinet noises, synthesised.
 *
 * Twenty games' worth of bleeps as audio files would be a download nobody on
 * ship WiFi wants, and would fail exactly when the app is supposed to work
 * best. WebAudio oscillators cost zero bytes and sound more like a 1980s
 * cabinet than a sample would anyway.
 *
 * The context is created lazily on the first *user-gesture-driven* sound,
 * because every mobile browser refuses to start one otherwise. If audio is
 * unavailable for any reason, every function here is a no-op — a game must
 * never fail because it couldn't beep.
 */

const MUTE_KEY = 'tideline-arcade-muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  muted = next;
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  } catch {
    // Private-mode Safari throws on write. Muting still applies for the
    // session; it just won't be remembered, which is the harmless failure.
  }
  if (master && ctx) master.gain.setValueAtTime(next ? 0 : 0.18, ctx.currentTime);
}

function audio(): { ctx: AudioContext; master: GainNode } | null {
  if (muted) return null;
  if (ctx && master) {
    // Browsers suspend the context when the tab backgrounds; resume on use.
    if (ctx.state === 'suspended') void ctx.resume();
    return { ctx, master };
  }
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.18;
    master.connect(ctx.destination);
    return { ctx, master };
  } catch {
    return null;
  }
}

export type Wave = 'square' | 'sawtooth' | 'triangle' | 'sine';

/** One note. `freq` in Hz, `ms` duration, both ends ramped to kill clicks. */
export function tone(freq: number, ms: number, wave: Wave = 'square', gain = 1): void {
  const a = audio();
  if (!a) return;
  const t0 = a.ctx.currentTime;
  const osc = a.ctx.createOscillator();
  const env = a.ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(freq, t0);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
  osc.connect(env).connect(a.master);
  osc.start(t0);
  osc.stop(t0 + ms / 1000 + 0.02);
}

/** A pitch slide — lasers, power-ups, falling blocks. */
export function sweep(
  from: number,
  to: number,
  ms: number,
  wave: Wave = 'sawtooth',
  gain = 0.8,
): void {
  const a = audio();
  if (!a) return;
  const t0 = a.ctx.currentTime;
  const osc = a.ctx.createOscillator();
  const env = a.ctx.createGain();
  osc.type = wave;
  osc.frequency.setValueAtTime(from, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + ms / 1000);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
  osc.connect(env).connect(a.master);
  osc.start(t0);
  osc.stop(t0 + ms / 1000 + 0.02);
}

/** Filtered white noise — explosions, hits, thuds. */
export function noise(ms: number, gain = 0.6, filterHz = 900): void {
  const a = audio();
  if (!a) return;
  const t0 = a.ctx.currentTime;
  const frames = Math.max(1, Math.floor((a.ctx.sampleRate * ms) / 1000));
  const buffer = a.ctx.createBuffer(1, frames, a.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  const src = a.ctx.createBufferSource();
  src.buffer = buffer;
  const filter = a.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(filterHz, t0);
  const env = a.ctx.createGain();
  env.gain.setValueAtTime(gain, t0);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
  src.connect(filter).connect(env).connect(a.master);
  src.start(t0);
}

/** A short melodic run. `[freq, ms]` pairs, played back to back. */
export function melody(notes: readonly [number, number][], wave: Wave = 'square'): void {
  let delay = 0;
  for (const [freq, ms] of notes) {
    window.setTimeout(() => tone(freq, ms, wave), delay);
    delay += ms;
  }
}

// ---------- named cabinet sounds ----------

export const sfx = {
  blip: () => tone(880, 45, 'square', 0.55),
  select: () => tone(1320, 60, 'square', 0.5),
  coin: () => melody([[988, 70], [1319, 140]]),
  laser: () => sweep(1200, 320, 130, 'sawtooth', 0.5),
  hit: () => noise(140, 0.5, 1400),
  boom: () => noise(360, 0.8, 500),
  bounce: () => tone(520, 40, 'triangle', 0.6),
  eat: () => tone(660, 55, 'square', 0.45),
  levelUp: () => melody([[523, 80], [659, 80], [784, 80], [1047, 180]]),
  wrong: () => melody([[311, 110], [233, 180]], 'sawtooth'),
  right: () => melody([[784, 70], [1047, 130]]),
  gameOver: () => melody([[523, 140], [415, 140], [330, 140], [262, 320]], 'sawtooth'),
  record: () => melody([[659, 90], [784, 90], [988, 90], [1319, 90], [1568, 260]]),
  tick: () => tone(1500, 25, 'square', 0.3),
};
