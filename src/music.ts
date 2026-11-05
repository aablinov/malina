import { audioCore } from './audio.ts';

/**
 * Background music in code (Web Audio, no files): a quiet generative pentatonic piece.
 * Three moods — "calm" (slow chords and sparse bells), "fight" (the same music, only quieter — it does not get in the way
 * of hearing the hits) and "trouble" at low health (minor, heartbeat, muffled sound). Tempo and layer volumes change smoothly,
 * harmony — from the start of the next bar
 */
export type Mood = 'calm' | 'fight' | 'danger';

/** Tempo, beats per minute */
const BPM: Record<Mood, number> = { calm: 66, fight: 66, danger: 118 };
/** Overall music volume — under the game sounds */
const VOL = 0.2;
/** Music volume from the settings 0..1 (src/menu/settings.ts) */
let level = 1;
export function setMusicVolume(v: number): void { level = Math.max(0, Math.min(1, v)); }
/** The fight holds this many seconds after the enemies fall behind: the music does not jerk back and forth */
const FIGHT_HOLD = 5;
/** Health below this — "trouble", above LOW_OFF — it lets go */
const LOW_ON = 0.3, LOW_OFF = 0.4;

/** Chords by bar (MIDI): calm and fight — C major, trouble — minor with D minor */
const CALM = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]];
const PROG: Record<Mood, number[][]> = {
  calm: CALM,
  fight: CALM,
  danger: [[45, 48, 52], [41, 45, 48], [38, 41, 45], [45, 48, 52]],
};
/** Pentatonic for the melody (C — A minor, the same notes): whatever you play is not off-key */
const PENTA = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81];
/** How many eighths carry a melody note */
const MELODY: Record<Mood, number> = { calm: 0.28, fight: 0.28, danger: 0.18 };
/** Layers: chords, bass, drums and the volume of all music — by mood */
const LAYERS: Record<Mood, { pad: number; bass: number; drums: number; cut: number; vol: number }> = {
  calm: { pad: 1, bass: 0, drums: 0, cut: 5200, vol: 1 },
  fight: { pad: 1, bass: 0, drums: 0, cut: 5200, vol: 0.35 },
  danger: { pad: 0.55, bass: 0.8, drums: 1, cut: 1500, vol: 1 },
};

const hz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

interface Nodes { ctx: AudioContext; verb: AudioNode; lp: BiquadFilterNode; main: GainNode; pad: GainNode; lead: GainNode; bass: GainNode; drums: GainNode }

export class Music {
  mood: Mood = 'calm';
  /** Current tempo: drifts towards the mood's BPM */
  bpm = BPM.calm;
  /** How many notes played so far (for tests and debugging) */
  notes = 0;
  private n: Nodes | null = null;
  private fightT = 0;
  private low = false;
  /** Time of the next sixteenth and its number in the bar */
  private next = 0;
  private step = 0;
  private bar = 0;
  private chord: number[] = PROG.calm[0];
  private prog = CALM;
  private melody = 4;

  /**
   * Once per frame: fight — enemies nearby raised the alarm or a warden woke up, hp — the hero's health fraction.
   * dt — real time: the music keeps playing while paused and in the inventory
   */
  update(dt: number, fight: boolean, hp: number): void {
    this.fightT = fight ? FIGHT_HOLD : Math.max(0, this.fightT - dt);
    this.low = this.low ? hp < LOW_OFF : hp < LOW_ON;
    const mood: Mood = this.low ? 'danger' : this.fightT > 0 ? 'fight' : 'calm';
    if (!this.n && !this.init()) { this.mood = mood; return; }
    const n = this.n!;
    if (mood !== this.mood) {
      this.mood = mood;
      const l = LAYERS[mood], t = n.ctx.currentTime;
      n.pad.gain.setTargetAtTime(l.pad, t, 0.8);
      n.bass.gain.setTargetAtTime(l.bass, t, 0.6);
      n.drums.gain.setTargetAtTime(l.drums, t, mood === 'calm' ? 1.5 : 0.3);
      n.lp.frequency.setTargetAtTime(l.cut, t, 0.7);
      n.main.gain.setTargetAtTime(VOL * level * l.vol, t, 0.8);
    }
    // the tempo speeds up in a second or two, calms down slower
    const want = BPM[this.mood], k = want > this.bpm ? 1.2 : 0.4;
    this.bpm += (want - this.bpm) * Math.min(1, dt * k);
    this.schedule();
  }

  private init(): boolean {
    const core = audioCore();
    if (!core) return false;
    const { ctx } = core;
    const lp = ctx.createBiquadFilter(), main = ctx.createGain();
    lp.type = 'lowpass'; lp.frequency.value = LAYERS.calm.cut; lp.Q.value = 0.5;
    main.gain.value = 0;
    // intro: the music fades in over a couple of seconds instead of hitting the ears from the first click
    main.gain.setTargetAtTime(VOL * level * LAYERS[this.mood].vol, ctx.currentTime, 1.2);
    lp.connect(main).connect(core.out);
    const layer = (v: number): GainNode => { const g = ctx.createGain(); g.gain.value = v; g.connect(lp); return g; };
    const l = LAYERS[this.mood];
    this.n = { ctx, verb: core.verb, lp, main, pad: layer(l.pad), lead: layer(1), bass: layer(l.bass), drums: layer(l.drums) };
    lp.frequency.value = l.cut;
    this.next = ctx.currentTime + 0.1;
    return true;
  }

  /** Schedule sixteenths 0.2 s ahead; if the tab slept, no need to catch up — start from "now" */
  private schedule(): void {
    const n = this.n!, now = n.ctx.currentTime;
    if (this.next < now - 0.5) this.next = now + 0.05;
    while (this.next < now + 0.2) {
      this.play(this.step, this.next);
      this.next += 60 / this.bpm / 4;
      if (++this.step === 16) { this.step = 0; this.bar++; }
    }
  }

  private play(s: number, t: number): void {
    const mood = this.mood, beat = 60 / this.bpm;
    if (s === 0) {
      // new bar: the chord of the current mood (a mood change only on a downbeat)
      if (this.prog !== PROG[mood]) { this.prog = PROG[mood]; this.bar = 0; }
      this.chord = this.prog[this.bar % this.prog.length];
      for (const m of this.chord) this.pad(hz(m + 12), t, beat * 4.4);
    }
    const root = this.chord[0];
    // melody: a step along the pentatonic near the previous note, on downbeats it leans towards the chord
    if (s % 2 === 0 && Math.random() < MELODY[mood] * (s % 8 === 0 ? 1.4 : 1)) {
      this.melody = Math.max(0, Math.min(PENTA.length - 1, this.melody + Math.round((Math.random() - 0.5) * 4)));
      let m = PENTA[this.melody];
      if (s % 8 === 0) {
        const tones = PENTA.filter((b) => this.chord.some((c) => (b - c) % 12 === 0));
        if (tones.length) m = tones.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));
      }
      this.pluck(hz(m), t, mood === 'danger' ? 0.7 : 1.4);
    }
    if (mood === 'danger') {
      if (s === 0 || s === 8) this.bassNote(hz(root - 12), t, beat * 1.6);
      // heartbeat: thump-thump on every beat, split in half
      if (s % 8 === 0) { this.kick(t, 1); this.kick(t + beat * 0.32, 0.6); }
    }
  }

  // ---------- voices ----------
  private env(t: number, peak: number, attack: number, dur: number, to: AudioNode): GainNode {
    const g = this.n!.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    g.connect(to);
    this.notes++;
    return g;
  }
  private osc(type: OscillatorType, f: number, t: number, dur: number, g: AudioNode, detune = 0): void {
    const o = this.n!.ctx.createOscillator();
    o.type = type; o.frequency.value = f; o.detune.value = detune;
    o.connect(g); o.start(t); o.stop(t + dur + 0.05);
  }
  /** Soft chord: two slightly detuned sines, slow attack */
  private pad(f: number, t: number, dur: number): void {
    const g = this.env(t, 0.07, Math.min(1.2, dur * 0.3), dur, this.n!.pad);
    this.osc('sine', f, t, dur, g, -6);
    this.osc('triangle', f, t, dur, g, 6);
  }
  /** Melody bell, with a tail into the reverb */
  private pluck(f: number, t: number, dur: number): void {
    const n = this.n!, g = this.env(t, 0.09, 0.01, dur, n.lead);
    this.osc('triangle', f, t, dur, g);
    const wet = n.ctx.createGain(); wet.gain.value = 0.25 * LAYERS[this.mood].vol; g.connect(wet).connect(n.verb);
  }
  private bassNote(f: number, t: number, dur: number): void {
    const g = this.env(t, 0.16, 0.02, dur, this.n!.bass);
    this.osc('triangle', f, t, dur, g);
  }
  private kick(t: number, vol: number): void {
    const n = this.n!, o = n.ctx.createOscillator(), g = this.env(t, 0.32 * vol, 0.005, 0.22, n.drums);
    o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    o.connect(g); o.start(t); o.stop(t + 0.25);
  }
}
