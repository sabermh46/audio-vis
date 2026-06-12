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
assert r["ml"] is False and r["beatsSource"] == "mix" and "stems" not in r
print("DIRECT ANALYSIS CHECKS PASSED (DSP)")

# --- ML path: same analysis with real stems ---
from stems import separate

r2 = analyze(y, sr, stems=separate(y, sr))
assert r2["ml"] is True and r2["mlModel"] == "htdemucs"
assert r2["beatsSource"] == "drums"
assert set(r2["stems"]) == {"vocals", "drums", "bass", "other"}
stems_dec = {k: np.frombuffer(base64.b64decode(v), dtype=np.uint8) for k, v in r2["stems"].items()}
assert all(len(t) == r2["frames"] for t in stems_dec.values())
# Note: htdemucs leaks the synthetic 8kHz pure tone partly into drums
# (unnatural signal), so compare clicks against the 60Hz segment and assert
# the click bursts hit full scale — robust against that degeneracy.
drums_clicks = seg(stems_dec["drums"], 6.2, 9.8)
drums_60 = seg(stems_dec["drums"], 0.2, 2.8)
fps = r2["fps"]
drums_click_peak = stems_dec["drums"][int(6.0 * fps):int(10.0 * fps)].max() / 255
print(f"drums stem: 60Hz {drums_60:.2f} | clicks {drums_clicks:.2f} | click peak {drums_click_peak:.2f}")
assert drums_clicks > drums_60, "drums stem should beat its 60Hz leak"
assert drums_click_peak > 0.9, "click bursts should hit near full scale in drums stem"
bass_60 = seg(stems_dec["bass"], 0.2, 2.8)
assert bass_60 > 0.5, f"bass stem should be hot during 60Hz tone ({bass_60:.2f})"
ml_click_beats = [b for b in r2["beats"] if 6.0 <= b <= 10.0]
print("tempo (drums-derived):", r2["tempo"], "| beats in click segment:", len(ml_click_beats))
assert len(ml_click_beats) >= 4
assert "drums" in r2.get("stemsOnset", {})
print("DIRECT ANALYSIS CHECKS PASSED (ML)")
