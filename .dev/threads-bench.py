"""Measures Demucs separation time at a given torch thread count.
Usage: python .dev/threads-bench.py <num_threads>"""
import os
import sys
import time
from pathlib import Path

n = int(sys.argv[1]) if len(sys.argv) > 1 else 0
if n > 0:
    os.environ["OMP_NUM_THREADS"] = str(n)

import torch
if n > 0:
    torch.set_num_threads(n)

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "server"))
import numpy as np
import soundfile as sf
from stems import separate

y, sr = sf.read(Path(__file__).parent / "test.wav", dtype="float32")
y = np.tile(y, 6)  # ~60s, enough to see scaling

separate(y, sr)  # warm-up: model load + JIT
t0 = time.time()
separate(y, sr)
print(f"threads={torch.get_num_threads()}  separate(60s)={time.time() - t0:.1f}s")
