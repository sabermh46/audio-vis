"""Standalone separation smoke: stems of test.wav must place the click
segment's energy in the drums stem. First run downloads the model (~81MB)."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

import numpy as np
import soundfile as sf
from stems import availability, separate

print("availability before load:", availability())
y, sr = sf.read(Path(__file__).parent / "test.wav", dtype="float32")

t0 = time.time()
stems = separate(y, sr)
print(f"separate took {time.time() - t0:.1f}s; availability now: {availability()}")

def seg_rms(x, a, b):
    s = x[int(a * sr):int(b * sr)]
    return float(np.sqrt(np.mean(s ** 2)))

print(f"{'stem':8s} {'60Hz':>8s} {'8kHz':>8s} {'clicks':>8s}")
rows = {}
for name, data in stems.items():
    rows[name] = (seg_rms(data, 0.2, 2.8), seg_rms(data, 3.2, 5.8), seg_rms(data, 6.05, 9.8))
    print(f"{name:8s} {rows[name][0]:8.4f} {rows[name][1]:8.4f} {rows[name][2]:8.4f}")

# Clicks are percussive: the drums stem must carry more click energy than
# any other stem does.
drums_clicks = rows["drums"][2]
assert all(drums_clicks >= rows[n][2] for n in rows if n != "drums"), "drums stem not dominant on clicks"
# The 60Hz tone should land mostly in bass (sustained low-frequency).
assert rows["bass"][0] == max(r[0] for r in rows.values()), "bass stem not dominant on 60Hz"
assert all(len(d) == len(y) or abs(len(d) - len(y)) < sr for d in stems.values())
print("STEMS SMOKE PASSED")
