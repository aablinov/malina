import { duck } from '../audio.ts';
import { rnd } from '../rng.ts';
import { bell, boom, deg, hiss, semi, voice } from '../spell-audio.ts';
import { rand } from './kit.ts';

/**
 * Warden sound (wiki/design-bosses.md). Like the spells: power from the low end (boom through saturation), roar — a saw through a
 * low filter plus noise, everything "in the hall" through reverb. The musical parts (choir, gates) come from the pentatonic scale.
 */
export const bossSfx = {
  /** Dragon roar: two detuned saws slide up and down through a filter, a growl of noise, a hit in the low end */
  roar(big = 1) {
    duck(0.35, 0.6 * big, 0.8);
    const dur = 1.3 * big;
    voice({ type: 'sawtooth', f: 62, f1: 48, dur, vol: 0.12, detune: 22, lp: 380, lp1: 1500, attack: 0.15, verb: 0.6 });
    voice({ type: 'sawtooth', f: 93, f1: 70, dur: dur * 0.9, vol: 0.08, detune: 15, lp: 600, lp1: 2200, attack: 0.2, verb: 0.6 });
    voice({ type: 'square', f: 124, f1: 82, dur: dur * 0.8, vol: 0.025, lp: 900, lp1: 500, attack: 0.25, verb: 0.5 });
    hiss({ dur, vol: 0.35, f: 500, f1: 1800, q: 0.7, type: 'lowpass', attack: 0.2, verb: 0.5 });
    hiss({ dur: dur * 0.7, vol: 0.12, f: 2400, f1: 900, q: 1.5, attack: 0.3, verb: 0.4 });
    boom(70, 30, 1.2 * big, 0.6, 0.1, 0.5);
  },
  /** Wing flap: a dull gust of air */
  flap(k = 1) {
    hiss({ dur: 0.45, vol: 0.28 * k, f: 160, f1: 520, q: 0.5, type: 'lowpass', attack: 0.12, verb: 0.3 });
    boom(55, 32, 0.35, 0.22 * k, 0.05, 0.2);
  },
  /** Heavy step */
  step(k = 1) { boom(58, 28, 0.32, 0.3 * k, 0, 0.15); hiss({ dur: 0.12, vol: 0.06 * k, f: 300, q: 0.6, type: 'lowpass' }); },
  /** Bite: click of teeth and a lunge */
  bite() {
    hiss({ dur: 0.25, vol: 0.22, f: 600, f1: 1800, q: 0.6, type: 'lowpass', attack: 0.1 });
    hiss({ dur: 0.06, vol: 0.35, f: 2600, q: 1.2, delay: 0.22 });
    boom(110, 50, 0.25, 0.4, 0.22, 0.2);
  },
  /** Tail swing: a whistle round the circle */
  tail() {
    hiss({ dur: 0.55, vol: 0.3, f: 400, f1: 2400, q: 1.4, attack: 0.3, verb: 0.25 });
    boom(80, 40, 0.3, 0.3, 0.45, 0.2);
  },
  /** Inhale before the breath: noise rises, the low end hums, the notes of the fire chord enter one by one */
  inhale(dur: number) {
    hiss({ dur, vol: 0.3, f: 180, f1: 1600, q: 0.6, type: 'lowpass', attack: dur * 0.9, verb: 0.4 });
    voice({ type: 'sawtooth', f: 55, f1: 82, dur, vol: 0.06, detune: 12, lp: 300, lp1: 900, attack: dur * 0.8, verb: 0.4 });
    [0, 7, 12].forEach((s, i) => voice({ type: 'triangle', f: semi(220, s), dur: dur - i * 0.25, vol: 0.025, attack: 0.2, delay: i * 0.25, verb: 0.5 }));
  },
  /** Stream of fire: roar of flame, crackle, brass chord */
  breath(dur: number) {
    duck(0.4, dur, 0.6);
    hiss({ dur, vol: 0.45, f: 900, f1: 600, q: 0.4, type: 'lowpass', attack: 0.06, verb: 0.4 });
    hiss({ dur, vol: 0.12, f: 3000, q: 0.8, attack: 0.1, verb: 0.3 });
    voice({ type: 'sawtooth', f: 73, f1: 65, dur, vol: 0.07, detune: 18, lp: 700, lp1: 400, attack: 0.08, verb: 0.5 });
    [0, 7, 12, 19].forEach((s, i) => voice({ type: 'sawtooth', f: semi(110, s), dur: 0.9, vol: 0.03, detune: 8, lp: 2400, lp1: 300, delay: i * 0.03, verb: 0.5 }));
    for (let i = 0; i < 12; i++) hiss({ dur: 0.04, vol: 0.12, f: rand(1500, 4000), q: 2, delay: rnd() * dur });
  },
  /** Takeoff: three powerful flaps and the roar goes up */
  takeoff() {
    for (let i = 0; i < 3; i++) bossSfx.flap(1.3 - i * 0.2);
    voice({ type: 'sawtooth', f: 70, f1: 140, dur: 0.9, vol: 0.06, detune: 18, lp: 500, lp1: 1800, attack: 0.1, verb: 0.6 });
  },
  /** Dragon falling like a meteor: a whistle downward and a growing rumble */
  fall(dur: number) {
    voice({ type: 'sine', f: 1700, f1: 220, dur, vol: 0.07, attack: 0.25, verb: 0.4 });
    voice({ type: 'triangle', f: 850, f1: 110, dur, vol: 0.035, attack: 0.3, verb: 0.4 });
    hiss({ dur, vol: 0.3, f: 300, f1: 2600, q: 0.6, type: 'lowpass', attack: dur * 0.9, verb: 0.3 });
  },
  /** Ground slam: heavy low end, crunch of stone, brass chord, clatter of debris */
  slam() {
    duck(0.25, 0.4, 0.8);
    boom(95, 22, 1.6, 0.95, 0, 0.55);
    hiss({ dur: 0.2, vol: 0.5, f: 1100, q: 0.5, verb: 0.3 });
    hiss({ dur: 1.8, vol: 0.32, f: 1400, f1: 110, q: 0.4, type: 'lowpass', verb: 0.5 });
    [0, 7, 12, 19].forEach((s, i) => voice({ type: 'sawtooth', f: semi(87.3, s), dur: 1.3, vol: 0.05, detune: 10, lp: 2600, lp1: 200, delay: i * 0.02, verb: 0.55 }));
    for (let i = 0; i < 10; i++) voice({ type: 'triangle', f: rand(160, 380), dur: 0.08, vol: 0.05, delay: 0.25 + rnd(), verb: 0.2 });
  },
  /** Small meteor of phase 2 */
  pebble() { boom(120, 40, 0.5, 0.45, 0, 0.3); hiss({ dur: 0.4, vol: 0.18, f: 1200, f1: 200, q: 0.5, type: 'lowpass' }); },
  /** Dragon dazed: ringing in the ears and the beat of the berry heart */
  daze() {
    bell(deg(523.25, 4), 1.2, 0.04, 0, 0.6);
    for (let i = 0; i < 4; i++) boom(70, 40, 0.18, 0.35, 0.1 + i * 0.42, 0.2);
  },
  /** Death: roar downward, long low end, the light fades — a descending chord */
  death() {
    duck(0.2, 1.5, 1.5);
    voice({ type: 'sawtooth', f: 90, f1: 32, dur: 2.4, vol: 0.12, detune: 20, lp: 1400, lp1: 200, attack: 0.1, verb: 0.7 });
    hiss({ dur: 2, vol: 0.3, f: 1500, f1: 150, q: 0.5, type: 'lowpass', attack: 0.1, verb: 0.6 });
    boom(80, 20, 2.2, 0.8, 0.9, 0.6);
    [12, 7, 4, 0].forEach((s, i) => voice({ type: 'triangle', f: semi(220, s), dur: 1.2, vol: 0.04, attack: 0.05, delay: 1.1 + i * 0.3, verb: 0.7 }));
  },
  /** Arena gates: clank of iron (uneven overtones) and a thud */
  gate(close: boolean) {
    for (const [f, d] of [[310, 0], [463, 0.02], [697, 0.05], [1031, 0.08]] as const) voice({ type: 'square', f, dur: 0.5, vol: 0.02, delay: d + (close ? 0.45 : 0), lp: 3000, lp1: 600, verb: 0.5 });
    hiss({ dur: 0.5, vol: 0.15, f: 800, f1: 300, q: 0.5, type: 'lowpass', attack: 0.4 });
    boom(close ? 60 : 80, 30, 0.6, 0.6, close ? 0.45 : 0, 0.5);
  },
  /** Grimoire: choir (pentatonic with slow attack) and bells going up */
  choir() {
    duck(0.3, 2, 1.5);
    [0, 7, 12, 16, 19, 24].forEach((s, i) => {
      voice({ type: 'sine', f: semi(196, s), dur: 4.5, vol: 0.035, attack: 0.9, delay: i * 0.12, detune: 6, verb: 0.9 });
      voice({ type: 'triangle', f: semi(196, s) * 2, dur: 3.5, vol: 0.012, attack: 1.2, delay: i * 0.12, verb: 0.9 });
    });
    for (let i = 0; i < 6; i++) bell(deg(523.25, 3 + i), 1.6, 0.035, 0.4 + i * 0.13, 0.8);
  },
  /** A page turned */
  page() { hiss({ dur: 0.12, vol: 0.05, f: 4000, f1: 2000, q: 0.8 }); },
  /** Grimoire taken */
  take() {
    [0, 4, 7, 12, 16].forEach((s, i) => bell(semi(523.25, s), 1.1, 0.05, i * 0.07, 0.7));
    boom(160, 80, 0.4, 0.3, 0, 0.4);
  },
};
