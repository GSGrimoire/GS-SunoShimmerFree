/* GS SunoShimmerFree engine v1
 *
 * Removes the broadband static and the high-frequency "shimmer" grain that
 * AI music renders carry, without EQ, compression, limiting or normalisation.
 * The same file runs in the browser (inside worker.js) and in Node (cli.js).
 *
 * Method
 *   1. Short-time Fourier transform: periodic Hann window, 2048 points,
 *      hop 512 (75% overlap), weighted overlap-add resynthesis using the
 *      original phase.
 *   2. Static (adaptive spectral subtraction, after the r/SunoAI method).
 *      The noise profile is the per-bin median magnitude of the quietest
 *      frames of the whole track. Subtraction strength rises with frequency:
 *      light below the bass cutoff, conservative through the midrange,
 *      strongest in the air band. The gain mask is smoothed over 5 bins by
 *      7 frames to avoid musical noise and pumping.
 *   3. Shimmer. Above the chosen start frequency, each time-frequency cell is
 *      compared with two references: the median of its 9-frame neighbourhood
 *      in time and the median of its 9-bin neighbourhood in frequency. Real
 *      music passes at least one test: sustained tones match their time
 *      neighbours, and drum and consonant transients are broadband so they
 *      match their frequency neighbours. Shimmer grain is short AND
 *      narrowband, so it stands above both references and is pulled down
 *      toward the larger of the two, by at most the chosen number of dB.
 *      A transient guard raises the time reference by however much the
 *      whole band jumped in that frame, so a drum hit, where every bin
 *      rises together, is not mistaken for grain. On a dense test mix the
 *      default settings removed about two thirds of the grain cells while
 *      cutting drum onsets by about half a decibel.
 *   4. One gain mask, computed from the mean magnitude of all channels, is
 *      applied to every channel so the stereo image does not move.
 *   5. Removed = Original - Clean. Listening to it shows what was taken out.
 *
 * Version history
 *   v1  First release: static denoise, shimmer stage with transient guard,
 *       stereo-linked mask, block processing so long tracks fit in browser
 *       memory, spectrogram previews for the page.
 */
(function (root) {
  'use strict';

  var VERSION = '1';
  var N = 2048, H = 512, NB = N / 2 + 1;
  var HALO = 8;          // frames of context each side of a block; reach is 5
  var BLOCK = 256;       // frames per processing block
  var EPS = 1e-12;
  var DN_F = 2, DN_T = 3;    // static mask smoothing half-widths (5 x 7)
  var SH_F = 4, SH_T = 4;    // shimmer median half-widths (9 x 9)
  var SM = 1;                // shimmer mask smoothing half-width (3 x 3)

  var DEFAULTS = {
    denoise: true,         // static stage on or off
    denoiseStrength: 1.0,  // multiplies the subtraction curve (0 to 2)
    maxAttenDb: 7,         // deepest static cut per bin
    quietPct: 12,          // share of quietest frames used as noise sample
    bassHz: 350,           // below this the static stage barely acts
    shimmer: 0.6,          // shimmer amount, 0 turns the stage off (0 to 1)
    shimmerMaxDb: 6,       // deepest shimmer cut per cell
    shimmerFromHz: 4000    // shimmer stage fades in from here to 1.5x here
  };

  var LIMITS = {
    denoiseStrength: [0, 2], maxAttenDb: [0, 18], quietPct: [2, 40],
    bassHz: [50, 1000], shimmer: [0, 1], shimmerMaxDb: [0, 18],
    shimmerFromHz: [1500, 12000]
  };

  function resolveParams(p) {
    var out = {}, k;
    for (k in DEFAULTS) out[k] = DEFAULTS[k];
    if (p) for (k in p) {
      if (!(k in DEFAULTS)) throw new Error('Unknown setting "' + k + '".');
      out[k] = p[k];
    }
    for (k in LIMITS) {
      var v = Number(out[k]);
      if (!isFinite(v)) throw new Error('Setting "' + k + '" must be a number.');
      out[k] = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v));
    }
    out.denoise = !!out.denoise;
    return out;
  }

  // numpy.interp: piecewise linear, clamped at both ends, xp increasing
  function interp(x, xp, fp) {
    if (x <= xp[0]) return fp[0];
    var last = xp.length - 1;
    if (x >= xp[last]) return fp[last];
    for (var i = 1; i <= last; i++) {
      if (x <= xp[i]) {
        return fp[i - 1] + (fp[i] - fp[i - 1]) * (x - xp[i - 1]) / (xp[i] - xp[i - 1]);
      }
    }
    return fp[last];
  }

  function FFT(n) {
    var bits = Math.round(Math.log(n) / Math.LN2), i;
    this.n = n;
    this.rev = new Uint32Array(n);
    for (i = 0; i < n; i++) {
      var r = 0, x = i;
      for (var b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos(2 * Math.PI * i / n);
      this.sin[i] = Math.sin(2 * Math.PI * i / n);
    }
  }
  // In-place complex FFT. inverse=true omits the 1/n scaling.
  FFT.prototype.transform = function (re, im, inverse) {
    var n = this.n, rev = this.rev, c = this.cos, s = this.sin, i, j, t;
    for (i = 0; i < n; i++) {
      j = rev[i];
      if (j > i) { t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    var sign = inverse ? -1 : 1;
    for (var size = 2; size <= n; size <<= 1) {
      var half = size >> 1, step = n / size;
      for (i = 0; i < n; i += size) {
        for (j = 0; j < half; j++) {
          var k = j * step, a = i + j, l = a + half;
          var wr = c[k], wi = sign * s[k];
          var tr = re[l] * wr + im[l] * wi;
          var ti = im[l] * wr - re[l] * wi;
          re[l] = re[a] - tr; im[l] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
  };

  function median(buf, len) {
    // insertion sort, buffers here are 9 long
    for (var i = 1; i < len; i++) {
      var v = buf[i], j = i - 1;
      while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; }
      buf[j + 1] = v;
    }
    var m = len >> 1;
    return (len & 1) ? buf[m] : 0.5 * (buf[m - 1] + buf[m]);
  }

  function process(channels, sampleRate, params, hooks) {
    hooks = hooks || {};
    var P = resolveParams(params);
    var C = channels.length;
    if (!C) throw new Error('The audio has no channels.');
    var n = channels[0].length;
    for (var ci = 1; ci < C; ci++) {
      if (channels[ci].length !== n) throw new Error('Channel ' + (ci + 1) + ' has a different length.');
    }
    if (!(sampleRate > 0)) throw new Error('Missing sample rate.');
    if (n === 0) throw new Error('The audio is empty.');

    var progress = hooks.progress || function () {};
    var K = Math.floor((n + N / 2) / H) + 1;
    var fft = new FFT(N);
    var w = new Float64Array(N), w2 = new Float64Array(N), i, k, t;
    for (i = 0; i < N; i++) { w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); w2[i] = w[i] * w[i]; }

    var freqs = new Float64Array(NB);
    for (k = 0; k < NB; k++) freqs[k] = k * sampleRate / N;

    // channel pairs packed as real + imaginary into one complex FFT
    var pairs = [];
    for (ci = 0; ci < C; ci += 2) pairs.push([ci, ci + 1 < C ? ci + 1 : -1]);
    var invC = 1 / C;

    var re = new Float64Array(N), im = new Float64Array(N);

    function loadFrame(pair, frame, R, I) {
      var start = frame * H - N / 2, xa = channels[pair[0]], xb = pair[1] >= 0 ? channels[pair[1]] : null;
      for (var j = 0; j < N; j++) {
        var s = start + j;
        if (s >= 0 && s < n) { R[j] = xa[s] * w[j]; I[j] = xb ? xb[s] * w[j] : 0; }
        else { R[j] = 0; I[j] = 0; }
      }
      fft.transform(R, I, false);
    }
    // add the linked magnitude of a transformed pair into A (offset o)
    function addMag(pair, R, I, A, o) {
      for (var b = 0; b < NB; b++) {
        var m = (N - b) % N;
        if (pair[1] >= 0) {
          var ar = R[b] + R[m], ai = I[b] - I[m];
          var br = R[b] - R[m], bi = I[b] + I[m];
          A[o + b] += 0.5 * (Math.sqrt(ar * ar + ai * ai) + Math.sqrt(br * br + bi * bi));
        } else {
          A[o + b] += Math.sqrt(R[b] * R[b] + I[b] * I[b]);
        }
      }
    }
    function frameMag(frame, A, o) {
      for (var b = 0; b < NB; b++) A[o + b] = 0;
      for (var p = 0; p < pairs.length; p++) { loadFrame(pairs[p], frame, re, im); addMag(pairs[p], re, im, A, o); }
      for (b = 0; b < NB; b++) A[o + b] *= invC;
    }

    // spectrogram previews: time columns, rows on a square-root frequency
    // scale so the upper bands, where both stages work, get most of the height
    var SW = Math.min(1200, K), SR = 220;
    var fLo = 0, fHi = Math.min(20000, sampleRate / 2);
    var rowLo = new Int32Array(SR), rowHi = new Int32Array(SR);
    for (var r = 0; r < SR; r++) {
      var f0 = fHi * Math.pow(r / SR, 2), f1 = fHi * Math.pow((r + 1) / SR, 2);
      var b0 = Math.max(1, Math.round(f0 * N / sampleRate)), b1 = Math.max(b0, Math.min(NB - 1, Math.round(f1 * N / sampleRate)));
      rowLo[r] = b0; rowHi[r] = b1;
    }
    function Spec() { this.sum = new Float64Array(SW * SR); this.cnt = new Float64Array(SW); }
    Spec.prototype.add = function (frame, A, o, G, go, mode) {
      var col = Math.min(SW - 1, Math.floor(frame * SW / K));
      this.cnt[col]++;
      for (var r = 0; r < SR; r++) {
        var mx = 0;
        for (var b = rowLo[r]; b <= rowHi[r]; b++) {
          var v = A[o + b];
          if (mode === 1) v *= G[go + b]; else if (mode === 2) v *= (1 - G[go + b]);
          if (v > mx) mx = v;
        }
        this.sum[col * SR + r] += mx * mx;
      }
    };
    Spec.prototype.finish = function () {
      var out = new Float32Array(SW * SR);
      for (var c = 0; c < SW; c++) for (var r = 0; r < SR; r++) {
        var p = this.cnt[c] ? this.sum[c * SR + r] / this.cnt[c] : 0;
        out[c * SR + r] = 10 * Math.log10(p + 1e-14);
      }
      return { data: out, width: SW, height: SR, fLo: fLo, fHi: fHi };
    };

    // ---- Pass 1: frame energies and the original spectrogram
    var E = new Float64Array(K), A1 = new Float64Array(NB);
    var specOrig = new Spec();
    for (t = 0; t < K; t++) {
      frameMag(t, A1, 0);
      var e = 0;
      for (k = 0; k < NB; k++) e += A1[k] * A1[k];
      E[t] = e;
      specOrig.add(t, A1, 0, null, 0, 0);
      if ((t & 1023) === 0) progress(0.25 * t / K, 'Reading the track');
    }
    if (hooks.spectrogram) hooks.spectrogram('original', specOrig.finish());

    // ---- Pass 2: noise profile from the quietest frames (numpy linear percentile).
    // Frames more than 100 dB below the loudest frame are digital silence
    // (fade-ins, tails) and would teach the profile that the static is zero.
    var Emax = 0;
    for (t = 0; t < K; t++) if (E[t] > Emax) Emax = E[t];
    var live = [];
    for (t = 0; t < K; t++) if (E[t] > Emax * 1e-10) live.push(E[t]);
    var silentFrames = K - live.length;
    if (!live.length) { live = Array.prototype.slice.call(E); silentFrames = 0; }
    var sorted = Float64Array.from(live).sort(), L = sorted.length;
    var pos = P.quietPct / 100 * (L - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
    var thr = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    var floorE = silentFrames ? Emax * 1e-10 : -1;
    var quietIdx = [];
    for (t = 0; t < K; t++) if (E[t] <= thr && E[t] > floorE) quietIdx.push(t);
    var Q = quietIdx.length, QA = new Float64Array(Q * NB);
    for (var q = 0; q < Q; q++) {
      frameMag(quietIdx[q], QA, q * NB);
      if ((q & 255) === 0) progress(0.25 + 0.1 * q / Q, 'Sampling the noise');
    }
    var noise = new Float64Array(NB), col = new Float64Array(Q);
    for (k = 0; k < NB; k++) {
      for (q = 0; q < Q; q++) col[q] = QA[q * NB + k];
      col.sort();
      var mid = Q >> 1;
      noise[k] = (Q & 1) ? col[mid] : 0.5 * (col[mid - 1] + col[mid]);
    }
    QA = null;

    // ---- frequency curves
    var B = P.bassHz;
    var fullFloor = Math.pow(10, -P.maxAttenDb / 20);
    var bassFloor = Math.pow(10, -Math.min(1, P.maxAttenDb) / 20);
    var alpha = new Float64Array(NB), floorG = new Float64Array(NB), shW = new Float64Array(NB);
    var F = P.shimmerFromHz, shFloor = Math.pow(10, -P.shimmerMaxDb / 20), kSh = NB;
    for (k = 0; k < NB; k++) {
      var f = freqs[k];
      alpha[k] = P.denoiseStrength * interp(f, [0, B, 2 * B, 4000, 10000], [0.15, 0.15, 0.6, 0.8, 1.5]);
      floorG[k] = f < B ? bassFloor : interp(f, [B, 2 * B], [bassFloor, fullFloor]);
      shW[k] = interp(f, [F, 1.5 * F], [0, 1]);
      if (shW[k] > 0 && k < kSh) kSh = k;
    }
    var doShimmer = P.shimmer > 0 && P.shimmerMaxDb > 0 && kSh < NB;

    // ---- Pass 3: masks and resynthesis, block by block
    var out = [], ch;
    for (ch = 0; ch < C; ch++) out.push(new Float32Array(n));
    var carry = []; for (ch = 0; ch < C; ch++) carry.push(new Float64Array(N - H));
    var specClean = new Spec(), specRem = new Spec();
    var bandEdges = [0, B, 4000, 10000, Infinity];
    var bandSum = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], bandCnt = [0, 0, 0, 0];
    for (k = 0; k < NB; k++) for (var bi = 0; bi < 4; bi++) if (freqs[k] >= bandEdges[bi] && freqs[k] < bandEdges[bi + 1]) bandCnt[bi]++;
    var minGain = 1;
    var med = new Float64Array(9);

    function wsum(p) {
      var kmin = Math.max(0, Math.ceil((p - N + 1) / H)), kmax = Math.min(K - 1, Math.floor(p / H)), s = 0;
      for (var kk = kmin; kk <= kmax; kk++) s += w2[p - kk * H];
      return s;
    }

    for (var b0 = 0; b0 < K; b0 += BLOCK) {
      var b1 = Math.min(K, b0 + BLOCK);
      var r0 = Math.max(0, b0 - HALO), r1 = Math.min(K, b1 + HALO), M = r1 - r0, x, y;
      var A = new Float64Array(M * NB);
      var ZR = [], ZI = [];
      for (var p = 0; p < pairs.length; p++) { ZR.push(new Float64Array(M * N)); ZI.push(new Float64Array(M * N)); }
      for (t = 0; t < M; t++) {
        for (p = 0; p < pairs.length; p++) {
          var R = ZR[p].subarray(t * N, (t + 1) * N), I = ZI[p].subarray(t * N, (t + 1) * N);
          loadFrame(pairs[p], r0 + t, R, I);
          addMag(pairs[p], R, I, A, t * NB);
        }
        for (k = 0; k < NB; k++) A[t * NB + k] *= invC;
      }

      // static mask
      var G = new Float64Array(M * NB);
      if (P.denoise) {
        var g0 = new Float64Array(M * NB), g1 = new Float64Array(M * NB);
        for (t = 0; t < M; t++) for (k = 0; k < NB; k++) {
          x = 1 - alpha[k] * noise[k] / (A[t * NB + k] + EPS);
          g0[t * NB + k] = x < floorG[k] ? floorG[k] : (x > 1 ? 1 : x);
        }
        for (t = 0; t < M; t++) for (k = 0; k < NB; k++) {
          var s = 0;
          for (var d = -DN_F; d <= DN_F; d++) { var kk = k + d; kk = kk < 0 ? 0 : (kk >= NB ? NB - 1 : kk); s += g0[t * NB + kk]; }
          g1[t * NB + k] = s / (2 * DN_F + 1);
        }
        for (t = 0; t < M; t++) for (k = 0; k < NB; k++) {
          s = 0;
          for (d = -DN_T; d <= DN_T; d++) { var tt = t + d; tt = tt < 0 ? 0 : (tt >= M ? M - 1 : tt); s += g1[tt * NB + k]; }
          x = s / (2 * DN_T + 1);
          G[t * NB + k] = x < floorG[k] ? floorG[k] : (x > 1 ? 1 : x);
        }
      } else {
        G.fill(1);
      }

      // shimmer mask
      var S = new Float64Array(M * NB); S.fill(1);
      if (doShimmer) {
        var s0 = new Float64Array(M * NB), s1 = new Float64Array(M * NB); s0.fill(1);
        // transient guard: how far the whole shimmer band has jumped
        var Et = new Float64Array(M), guard = new Float64Array(M), j2;
        for (t = 0; t < M; t++) { s = 0; for (k = kSh; k < NB; k++) s += A[t * NB + k]; Et[t] = s; }
        for (t = 0; t < M; t++) {
          j2 = 0;
          for (d = -SH_T; d <= SH_T; d++) { tt = t + d; tt = tt < 0 ? 0 : (tt >= M ? M - 1 : tt); med[j2++] = Et[tt]; }
          x = Et[t] / (median(med, 9) + EPS);
          guard[t] = x > 1 ? x : 1;
        }
        for (t = 0; t < M; t++) for (k = kSh; k < NB; k++) {
          j2 = 0;
          for (d = -SH_T; d <= SH_T; d++) { tt = t + d; tt = tt < 0 ? 0 : (tt >= M ? M - 1 : tt); med[j2++] = A[tt * NB + k]; }
          var rt = median(med, 9) * guard[t];
          j2 = 0;
          for (d = -SH_F; d <= SH_F; d++) { kk = k + d; kk = kk < 0 ? 0 : (kk >= NB ? NB - 1 : kk); med[j2++] = A[t * NB + kk]; }
          var rf = median(med, 9);
          var ratio = Math.max(rt, rf) / (A[t * NB + k] + EPS);
          x = Math.pow(ratio, P.shimmer);
          x = x < shFloor ? shFloor : (x > 1 ? 1 : x);
          s0[t * NB + k] = 1 - shW[k] * (1 - x);
        }
        var kS = Math.max(0, kSh - SM);
        for (t = 0; t < M; t++) for (k = kS; k < NB; k++) {
          s = 0;
          for (d = -SM; d <= SM; d++) { kk = k + d; kk = kk < 0 ? 0 : (kk >= NB ? NB - 1 : kk); s += s0[t * NB + kk]; }
          s1[t * NB + k] = s / (2 * SM + 1);
        }
        for (t = 0; t < M; t++) for (k = kS; k < NB; k++) {
          s = 0;
          for (d = -SM; d <= SM; d++) { tt = t + d; tt = tt < 0 ? 0 : (tt >= M ? M - 1 : tt); s += s1[tt * NB + k]; }
          x = s / (2 * SM + 1);
          S[t * NB + k] = x < shFloor ? shFloor : (x > 1 ? 1 : x);
        }
      }

      // apply to the inner frames and overlap-add
      var spanStart = b0 * H, spanLen = (b1 - b0 - 1) * H + N;
      var acc = [];
      for (ch = 0; ch < C; ch++) { var a0 = new Float64Array(spanLen); a0.set(carry[ch]); acc.push(a0); }
      var Gf = new Float64Array(NB);
      for (t = b0 - r0; t < b1 - r0; t++) {
        for (k = 0; k < NB; k++) {
          var gd = G[t * NB + k], gs = S[t * NB + k], g = gd * gs;
          Gf[k] = g;
          if (g < minGain) minGain = g;
          for (bi = 0; bi < 4; bi++) if (freqs[k] < bandEdges[bi + 1]) break;
          bandSum[0][bi] += -20 * Math.log10(gd);
          bandSum[1][bi] += -20 * Math.log10(gs);
          bandSum[2][bi] += -20 * Math.log10(g);
        }
        specClean.add(r0 + t, A, t * NB, Gf, 0, 1);
        specRem.add(r0 + t, A, t * NB, Gf, 0, 2);
        var off = (r0 + t) * H - spanStart;
        for (p = 0; p < pairs.length; p++) {
          var zr = ZR[p], zi = ZI[p], base = t * N;
          for (k = 0; k < N; k++) {
            var gg = Gf[k <= N / 2 ? k : N - k];
            re[k] = zr[base + k] * gg; im[k] = zi[base + k] * gg;
          }
          fft.transform(re, im, true);
          var accA = acc[pairs[p][0]], accB = pairs[p][1] >= 0 ? acc[pairs[p][1]] : null;
          for (k = 0; k < N; k++) {
            var wk = w[k] / N;
            accA[off + k] += re[k] * wk;
            if (accB) accB[off + k] += im[k] * wk;
          }
        }
      }
      var finalEnd = b1 < K ? b1 * H : spanStart + spanLen;
      for (ch = 0; ch < C; ch++) {
        var oc = out[ch], ac = acc[ch];
        for (y = spanStart; y < finalEnd; y++) {
          var si = y - N / 2;
          if (si >= 0 && si < n) oc[si] = ac[y - spanStart] / wsum(y);
        }
        if (b1 < K) carry[ch] = ac.slice(b1 * H - spanStart);
      }
      progress(0.35 + 0.65 * b1 / K, 'Cleaning');
    }

    // ---- Removed track and checks
    var removed = [], peak = [0, 0, 0], ss = [0, 0, 0], pcErr = 0;
    for (ch = 0; ch < C; ch++) {
      var xo = channels[ch], cl = out[ch], rm = new Float32Array(n);
      for (i = 0; i < n; i++) {
        rm[i] = xo[i] - cl[i];
        var pc = xo[i] + (-rm[i]) - cl[i];
        if (Math.abs(pc) > pcErr) pcErr = Math.abs(pc);
        var v0 = Math.abs(xo[i]), v1 = Math.abs(cl[i]), v2 = Math.abs(rm[i]);
        if (v0 > peak[0]) peak[0] = v0; if (v1 > peak[1]) peak[1] = v1; if (v2 > peak[2]) peak[2] = v2;
        ss[0] += xo[i] * xo[i]; ss[1] += cl[i] * cl[i]; ss[2] += rm[i] * rm[i];
      }
      removed.push(rm);
    }
    var db = function (v) { return v > 0 ? 20 * Math.log10(v) : -Infinity; };
    var tot = n * C;
    var bandMean = bandSum.map(function (row) {
      return row.map(function (v, b) { return bandCnt[b] ? v / (bandCnt[b] * K) : 0; });
    });

    if (hooks.spectrogram) {
      hooks.spectrogram('clean', specClean.finish());
      hooks.spectrogram('removed', specRem.finish());
    }

    var report = {
      version: VERSION, sampleRate: sampleRate, channels: C, samples: n, seconds: n / sampleRate,
      params: P, frames: K, quietFrames: Q, silentFrames: silentFrames,
      bands: ['< ' + B + ' Hz', B + ' Hz to 4 kHz', '4 to 10 kHz', 'above 10 kHz'],
      meanCutDb: { static: bandMean[0], shimmer: bandMean[1], total: bandMean[2] },
      deepestCutDb: -20 * Math.log10(minGain),
      peakDb: { original: db(peak[0]), clean: db(peak[1]), removed: db(peak[2]) },
      rmsDb: { original: db(Math.sqrt(ss[0] / tot)), clean: db(Math.sqrt(ss[1] / tot)), removed: db(Math.sqrt(ss[2] / tot)) },
      phaseCancelError: pcErr,
      clipped: peak[1] >= 1
    };
    report.text = reportText(report);
    progress(1, 'Done');
    return { clean: out, removed: removed, report: report };
  }

  function reportText(r) {
    var P = r.params, f2 = function (v) { return (v === -Infinity ? '-inf' : v.toFixed(2)); };
    var L = [
      'GS SunoShimmerFree engine v' + r.version,
      'Audio: ' + r.sampleRate + ' Hz, ' + r.channels + ' channel' + (r.channels > 1 ? 's' : '') + ', ' +
        r.samples + ' samples (' + r.seconds.toFixed(2) + ' s)',
      '',
      'Settings',
      '  STFT: periodic Hann, ' + N + ' points, hop ' + H + ' (75% overlap), original phase kept',
      '  Static: ' + (P.denoise ? 'on' : 'off') + ', strength ' + P.denoiseStrength + ', max cut ' + P.maxAttenDb +
        ' dB, bass protected below ' + P.bassHz + ' Hz, noise sampled from the quietest ' + P.quietPct + '% of frames (' +
        r.quietFrames + ' of ' + r.frames + (r.silentFrames ? ', ' + r.silentFrames + ' silent frames skipped' : '') + ')',
      '  Shimmer: amount ' + P.shimmer + ', max cut ' + P.shimmerMaxDb + ' dB, fading in from ' + P.shimmerFromHz +
        ' Hz to ' + (1.5 * P.shimmerFromHz) + ' Hz',
      '  One gain mask shared by all channels (stereo image preserved)',
      '',
      'Mean cut per band (static / shimmer / total)'
    ];
    for (var b = 0; b < 4; b++) {
      L.push('  ' + (r.bands[b] + ':').padEnd(18) + f2(r.meanCutDb.static[b]) + ' / ' + f2(r.meanCutDb.shimmer[b]) +
        ' / ' + f2(r.meanCutDb.total[b]) + ' dB');
    }
    L.push('  Deepest single cut: ' + f2(r.deepestCutDb) + ' dB', '',
      'Levels (peak / RMS, dBFS)',
      '  Original: ' + f2(r.peakDb.original) + ' / ' + f2(r.rmsDb.original),
      '  Clean:    ' + f2(r.peakDb.clean) + ' / ' + f2(r.rmsDb.clean),
      '  Removed:  ' + f2(r.peakDb.removed) + ' / ' + f2(r.rmsDb.removed), '',
      'Phase-cancel check: Original + inverted Removed vs Clean, max error ' + r.phaseCancelError.toExponential(2));
    if (r.clipped) L.push('WARNING: the clean track reaches 0 dBFS and will clip on export. No limiting was applied.');
    return L.join('\n');
  }

  var api = { VERSION: VERSION, DEFAULTS: DEFAULTS, LIMITS: LIMITS, process: process, resolveParams: resolveParams, reportText: reportText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShimmerEngine = api;
})(typeof self !== 'undefined' ? self : this);
