"""Measures warm analyze() time (after JIT) — run separately from asserts."""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))

import numpy as np
import soundfile as sf
from analysis import SR, analyze

analyze(np.zeros(SR, dtype=np.float32), SR)  # warm-up: numba JIT
y, sr = sf.read(Path(__file__).parent / "test.wav", dtype="float32")

t0 = time.time()
analyze(y, sr)
print(f"warm 10s-file analyze: {time.time() - t0:.2f}s")

y3 = np.tile(y, 18)  # ~3 minutes
t0 = time.time()
analyze(y3, sr)
print(f"warm 3min-file analyze: {time.time() - t0:.2f}s")
