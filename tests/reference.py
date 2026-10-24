#!/usr/bin/env python3
# GS SunoShimmerFree reference implementation v1
#
# An independent NumPy/SciPy implementation of the method in engine.js,
# used only as a test oracle. It processes the whole track at once with
# library routines (rfft, median_filter, uniform_filter) instead of the
# engine's hand-written block code, so agreement between the two checks
# the engine's FFT, block halos, edge handling and overlap-add.
#
#   python3 tests/reference.py input.wav out_clean.wav [--shimmer 0.6] ...
#   python3 tests/reference.py --compare a.wav b.wav
#
# Version history
#   v1  First release.
import argparse
import sys

import numpy as np
import soundfile as sf
from scipy.ndimage import median_filter, uniform_filter

N, H = 2048, 512


def reference(x, sr, p):
    n, C = x.shape
    K = (n + N // 2) // H + 1
    w = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(N) / N)
    padded = np.zeros(((K - 1) * H + N, C))
    padded[N // 2:N // 2 + n] = x
    idx = np.arange(K)[:, None] * H + np.arange(N)[None, :]
    Z = [np.fft.rfft(padded[idx, c] * w, axis=1) for c in range(C)]   # K x NB
    A = sum(np.abs(z) for z in Z).T / C                               # NB x K
    f = np.fft.rfftfreq(N, 1 / sr)[:, None]

    E = (A ** 2).sum(axis=0)
    live = E > E.max() * 1e-10
    if not live.any():
        live[:] = True
    floor_e = E.max() * 1e-10 if not live.all() else -1
    quiet = (E <= np.percentile(E[live], p["quietPct"])) & (E > floor_e)
    noise = np.median(A[:, quiet], axis=1, keepdims=True)

    B = p["bassHz"]
    ff = 10 ** (-p["maxAttenDb"] / 20)
    bf = 10 ** (-min(1, p["maxAttenDb"]) / 20)
    alpha = p["denoiseStrength"] * np.interp(f, [0, B, 2 * B, 4000, 10000], [.15, .15, .6, .8, 1.5])
    floor = np.where(f < B, bf, np.interp(f, [B, 2 * B], [bf, ff]))
    if p["denoise"]:
        g = np.clip(1 - alpha * noise / (A + 1e-12), floor, 1)
        g = uniform_filter(g, size=(5, 7), mode="nearest")
        G = np.clip(g, floor, 1)
    else:
        G = np.ones_like(A)

    S = np.ones_like(A)
    F = p["shimmerFromHz"]
    if p["shimmer"] > 0 and p["shimmerMaxDb"] > 0:
        shf = 10 ** (-p["shimmerMaxDb"] / 20)
        band = (f[:, 0] > F)
        Et = A[band].sum(axis=0)
        guard = np.maximum(1, Et / (median_filter(Et, size=9, mode="nearest") + 1e-12))
        Rt = median_filter(A, size=(1, 9), mode="nearest") * guard[None, :]
        Rf = median_filter(A, size=(9, 1), mode="nearest")
        ratio = np.maximum(Rt, Rf) / (A + 1e-12)
        s = np.clip(ratio ** p["shimmer"], shf, 1)
        wt = np.interp(f, [F, 1.5 * F], [0, 1])
        s = 1 - wt * (1 - s)
        s = uniform_filter(s, size=3, mode="nearest")
        S = np.clip(s, shf, 1)

    gain = (G * S).T                                                  # K x NB
    out = np.zeros((padded.shape[0], C))
    for c in range(C):
        frames = np.fft.irfft(Z[c] * gain, n=N, axis=1) * w
        for r in range(N // H):
            blk = frames[r::N // H]
            seg = out[r * H:r * H + blk.size, c]
            seg += blk.reshape(-1)[:seg.size]
    wsum = np.zeros(padded.shape[0])
    for k in range(K):
        wsum[k * H:k * H + N] += w ** 2
    clean = out[N // 2:N // 2 + n] / wsum[N // 2:N // 2 + n, None]
    return clean


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--compare", action="store_true")
    ap.add_argument("--shimmer", type=float, default=0.6)
    ap.add_argument("--shimmer-max-db", type=float, default=6)
    ap.add_argument("--shimmer-from", type=float, default=4000)
    ap.add_argument("--no-static", action="store_true")
    ap.add_argument("--strength", type=float, default=1.0)
    ap.add_argument("--max-cut", type=float, default=7)
    ap.add_argument("--quiet", type=float, default=12)
    ap.add_argument("--bass", type=float, default=350)
    a = ap.parse_args()
    if a.compare:
        x, _ = sf.read(a.files[0], always_2d=True)
        y, _ = sf.read(a.files[1], always_2d=True)
        if x.shape != y.shape:
            sys.exit(f"Shape mismatch: {x.shape} vs {y.shape}")
        d = np.abs(x - y)
        print(f"max abs diff {d.max():.3e}  mean {d.mean():.3e}  (24-bit step {2**-23:.3e})")
        return
    x, sr = sf.read(a.files[0], always_2d=True, dtype="float32")
    p = dict(denoise=not a.no_static, denoiseStrength=a.strength, maxAttenDb=a.max_cut,
             quietPct=a.quiet, bassHz=a.bass, shimmer=a.shimmer,
             shimmerMaxDb=a.shimmer_max_db, shimmerFromHz=a.shimmer_from)
    clean = reference(x.astype(np.float64), sr, p)
    sf.write(a.files[1], clean, sr, subtype="FLOAT")


if __name__ == "__main__":
    main()
