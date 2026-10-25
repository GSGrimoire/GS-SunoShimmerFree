#!/usr/bin/env python3
# GS SunoShimmerFree edit reference v1
#
# Renders a section list written by tests/edit_test.js with NumPy, written
# from the envelope rules in edit.js rather than from its code, and
# compares the result with the edit engine's own render.
#
#   python3 tests/edit_reference.py input.wav outdir
#
# Version history
#   v1  First release.
import json
import pathlib
import sys

import numpy as np
import soundfile as sf


def envelope(segs, i, n, sr):
    x = segs[i]
    L = x["e"] - x["s"]
    k = np.arange(L, dtype=np.float64)
    g = 10 ** (x["g"] / 20)
    D = max(1, round(0.004 * sr))
    R = max(1, round(0.01 * sr))
    prev_cont = i > 0 and segs[i - 1]["e"] == x["s"]
    next_cont = i < len(segs) - 1 and segs[i + 1]["s"] == x["e"]
    v = np.full(L, g)
    if prev_cont and segs[i - 1]["g"] != x["g"]:
        gp = 10 ** (segs[i - 1]["g"] / 20)
        m = k < R
        v[m] = gp + (g - gp) * k[m] / R
    if x["fi"] > 0:
        m = k < x["fi"]
        v[m] *= np.sin(np.pi / 2 * k[m] / x["fi"])
    if x["fo"] > 0:
        m = k > L - x["fo"]
        v[m] *= np.sin(np.pi / 2 * (L - k[m]) / x["fo"])
    d_in = x["s"] > 0 if i == 0 else not prev_cont
    d_out = x["e"] < n if i == len(segs) - 1 else not next_cont
    if d_in:
        m = k < D
        v[m] *= k[m] / D
    if d_out:
        m = k > L - D
        v[m] *= (L - k[m]) / D
    return v


def main():
    src, _ = sf.read(sys.argv[1], always_2d=True, dtype="float32")
    src = src.astype(np.float64)
    worst = 0.0
    for js in sorted(pathlib.Path(sys.argv[2]).glob("*.json")):
        spec = json.loads(js.read_text())
        segs, n, sr = spec["segs"], spec["n"], spec["sampleRate"]
        parts = [src[x["s"]:x["e"]] * envelope(segs, i, n, sr)[:, None] for i, x in enumerate(segs)]
        ref = np.concatenate(parts)
        got, _ = sf.read(js.with_suffix(".wav"), always_2d=True)
        if got.shape != ref.shape:
            print(f"{js.stem}: SHAPE MISMATCH {got.shape} vs {ref.shape}")
            worst = np.inf
            continue
        d = np.abs(got - ref).max()
        worst = max(worst, d)
        print(f"{js.stem}: max diff {d:.2e}")
    print(f"worst {worst:.2e}")
    sys.exit(0 if worst < 1e-6 else 1)


if __name__ == "__main__":
    main()
