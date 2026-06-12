// Shared test helper: clears any saved scene for .dev/test.wav so a
// visualizer-specific test isn't hijacked by a hybrid scene a prior test
// persisted (the app auto-applies saved scenes on track load — by design).
// Best-effort: no-op when the server is down or the track isn't libraried.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

export async function resetTestScene(base = 'http://127.0.0.1:8765') {
  try {
    const wav = fs.readFileSync(path.resolve('.dev/test.wav'));
    const tid = crypto.createHash('sha256').update(wav).digest('hex').slice(0, 16);
    await fetch(`${base}/library/${tid}/scenes`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 2, scenes: [] }),
    });
  } catch { /* server down / not libraried — nothing to reset */ }
}
