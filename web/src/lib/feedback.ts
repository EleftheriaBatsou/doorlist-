import type { ScanResult } from './types';

/** Door feedback: distinct sound + vibration per outcome, so staff needn't look at the screen. */
let ctx: AudioContext | null = null;

/** Must be called from a user gesture once (iOS/Chrome autoplay rules). */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext;
    if (AC) ctx = new AC();
  }
  void ctx?.resume();
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.22) {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export type Feedback = ScanResult | 'queued';

export function playFeedback(kind: Feedback) {
  switch (kind) {
    case 'success': // bright rising two-note chime
      tone(880, 0, 0.12);
      tone(1318.5, 0.1, 0.22);
      navigator.vibrate?.(70);
      break;
    case 'already_used': // two mid "uh-oh" beeps
      tone(622, 0, 0.14, 'triangle', 0.26);
      tone(622, 0.2, 0.14, 'triangle', 0.26);
      navigator.vibrate?.([90, 70, 90]);
      break;
    case 'invalid':
    case 'wrong_event': // low buzz
      tone(160, 0, 0.45, 'sawtooth', 0.16);
      navigator.vibrate?.([260, 90, 260]);
      break;
    case 'queued': // soft single blip
      tone(740, 0, 0.1, 'sine', 0.15);
      navigator.vibrate?.(40);
      break;
  }
}
