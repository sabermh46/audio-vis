"""Direct unit check of server/analysis.py against .dev/test.wav."""
import base64
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

import numpy as np
import soundfile as sf
from analysis import analyze

y, sr = sf.read(Path(__file__).parent / "test.wav", dtype="float32")
t0 = time.time()
r = analyze(y, sr)
print(f"analyze took {time.time() - t0:.2f}s")
print("duration", r["duration"], "fps", round(r["fps"], 3), "frames", r["frames"])
print("tempo", r["tempo"], "beats", len(r["beats"]), r["beats"][:6])

bands = {k: np.frombuffer(base64.b64decode(v), dtype=np.uint8) for k, v in r["bands"].items()}
fps = r["fps"]

def seg(track, a, b):
    return track[int(a * fps):int(b * fps)].mean() / 255

for name in ("bass", "mid", "treble"):
    print(f"{name:7s}: 60Hz {seg(bands[name], 0.2, 2.8):.2f} | "
          f"8kHz {seg(bands[name], 3.2, 5.8):.2f} | clicks {seg(bands[name], 6.2, 9.8):.2f}")

perc = np.frombuffer(base64.b64decode(r["percussive"]), dtype=np.uint8)
harm = np.frombuffer(base64.b64decode(r["harmonic"]), dtype=np.uint8)
print(f"percussive: tones {seg(perc, 0.2, 5.8):.2f} | clicks {seg(perc, 6.2, 9.8):.2f}")
print(f"harmonic  : 8kHz... {seg(harm, 3.2, 5.8):.2f} | clicks {seg(harm, 6.2, 9.8):.2f}")

clicks_beats = [b for b in r["beats"] if 6.0 <= b <= 10.0]
print("beats in click segment:", len(clicks_beats))
assert r["numBars"] == 64
assert abs(r["fps"] - 44100 / 1024) < 1e-9
assert abs(r["frames"] - r["duration"] * r["fps"]) < 3
assert seg(bands["treble"], 3.2, 5.8) > 0.6 > seg(bands["treble"], 0.2, 2.8)
assert seg(bands["bass"], 0.2, 2.8) > 0.6 > seg(bands["bass"], 3.2, 5.8)
assert len(clicks_beats) >= 4
print("DIRECT ANALYSIS CHECKS PASSED")
