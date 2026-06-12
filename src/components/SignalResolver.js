/**
 * Maps a scene component's bind signal to a 0..1 value from the analysis
 * frame. Works identically for the precomputed and realtime sources since
 * both expose the same frame shape. Defensive (`?? 0`) so a stale or
 * partial frame never throws inside the render loop.
 */
export function resolveSignal(signal, frame) {
  if (!signal) return 0;
  if (signal === 'beat') return frame.beat ? 1 : 0;
  if (signal === 'volume') return frame.volume ?? 0;
  if (signal === 'onset') return frame.onset ?? 0;
  if (signal === 'harmonic') return frame.harmonic ?? 0;
  if (signal === 'percussive') return frame.percussive ?? 0;

  const dot = signal.indexOf('.');
  if (dot !== -1) {
    const ns = signal.slice(0, dot);
    const key = signal.slice(dot + 1);
    if (ns === 'stem') return frame.stems?.[key] ?? 0;
    if (ns === 'band') return frame.bands?.[key] ?? 0;
  }

  const m = /^bars\[(\d+)\.\.(\d+)\]$/.exec(signal);
  if (m && frame.bars) {
    const a = Math.max(0, +m[1]);
    const b = Math.min(+m[2], frame.bars.length - 1);
    let sum = 0;
    let n = 0;
    for (let i = a; i <= b; i++) { sum += frame.bars[i]; n++; }
    return n ? sum / n : 0;
  }
  return 0;
}

/** The signals a component may bind to (used to populate editor dropdowns). */
export const SIGNALS = [
  'stem.bass', 'stem.drums', 'stem.vocals', 'stem.other',
  'band.bass', 'band.mid', 'band.treble',
  'onset', 'beat', 'volume', 'harmonic', 'percussive',
];
