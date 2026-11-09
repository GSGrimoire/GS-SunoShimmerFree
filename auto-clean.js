/* SSF Auto Clean v1.
 * Deterministic, bounded local signal diagnostics and conservative recommendations.
 * These indicators do NOT identify an instrument or reconstruct clipped samples.
 * Windows are sampled across the song; no audio is uploaded anywhere.
 */
(function (root) {
  'use strict';
  var LIMIT = 16, SAMPLES_PER_WINDOW = 24000;

  // Copy only a few distributed windows instead of transferring complete songs.
  function sampleWindows(buffer, sampleRate) {
    if (!buffer || !buffer.numberOfChannels || !buffer.length) {
      throw new Error('Auto Clean requires a loaded audio track.');
    }
    var sr = Number(sampleRate), n = buffer.length, C = buffer.numberOfChannels;
    if (!Number.isFinite(sr) || sr < 8000 || sr > 384000 || C > 8) {
      throw new Error('Unsupported audio layout for Auto Clean diagnostics.');
    }
    var len = Math.min(n, SAMPLES_PER_WINDOW, Math.max(2048, Math.round(sr * 0.5)));
    var count = Math.min(LIMIT, Math.max(1, Math.floor(n / len)));
    var result = [];
    for (var w = 0; w < count; w++) {
      var start = count === 1 ? 0 : Math.round((n - len) * w / (count - 1));
      var chans = [];
      for (var c = 0; c < C; c++) {
        chans.push(buffer.getChannelData(c).slice(start, start + len));
      }
      result.push({ channels: chans });
    }
    return result;
  }

  function analyze(windows, sampleRate) {
    if (!Array.isArray(windows) || !windows.length ||
        !Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
      throw new Error('Auto Clean needs sampled windows and a valid sample rate.');
    }
    var sr = sampleRate, lp180 = Math.exp(-2 * Math.PI * 180 / sr);
    var lp650 = Math.exp(-2 * Math.PI * 650 / sr);
    var lp2800 = Math.exp(-2 * Math.PI * 2800 / sr);
    var lp6000 = Math.exp(-2 * Math.PI * Math.min(6000, sr * 0.35) / sr);
    var peak = 0, totalPower = 0, totalSamples = 0;
    var flatHits = 0, impulseHits = 0, quietHighWindows = 0, lowMidHeavy = 0;
    var windowSummaries = [];

    for (var w = 0; w < windows.length; w++) {
      var chans = windows[w] && windows[w].channels;
      if (!Array.isArray(chans) || !chans.length || !chans[0] || chans[0].length < 4) {
        throw new Error('Auto Clean received invalid audio windows.');
      }
      var n = chans[0].length, C = chans.length, sum = 0, highE = 0, lowMidE = 0, presenceE = 0;
      var flatInWindow = 0, impulsesInWindow = 0;
      for (var c = 0; c < C; c++) {
        if (!chans[c] || chans[c].length !== n) throw new Error('Auto Clean channel lengths differ.');
        var x = chans[c], a = 0, b = 0, d = 0, h = 0, flatRun = 0;
        for (var i = 0; i < n; i++) {
          var v = x[i], av = Math.abs(v);
          if (!Number.isFinite(v)) throw new Error('Non-finite audio cannot be diagnosed.');
          if (av > peak) peak = av;
          sum += v * v;
          a = lp180 * a + (1 - lp180) * v;
          b = lp650 * b + (1 - lp650) * v;
          d = lp2800 * d + (1 - lp2800) * v;
          h = lp6000 * h + (1 - lp6000) * v;
          var lowMid = b - a, presence = d - b, high = v - h;
          lowMidE += lowMid * lowMid;
          presenceE += presence * presence;
          highE += high * high;

          if (i > 0 && av > 0.55 && v * x[i - 1] > 0 &&
              Math.abs(v - x[i - 1]) < 0.00015) {
            if (++flatRun === 3) flatInWindow++;
          } else flatRun = 0;
          // A sharp one-sample discontinuity with almost equal neighbours.
          // This does not distinguish digital clicks from intentional effects.
          if (i > 0 && i + 1 < n &&
              Math.abs(x[i - 1] - x[i + 1]) < 0.055 &&
              Math.abs(v - (x[i - 1] + x[i + 1]) * 0.5) > 0.27) {
            impulsesInWindow++;
            i++;  // do not double-count the same discontinuity
          }
        }
      }
      var avgPower = sum / (n * C);
      var rms = Math.sqrt(avgPower);
      var hiShare = highE / (sum + 1e-18);
      var mudShare = lowMidE / (lowMidE + presenceE + 1e-18);
      var highInQuiet = rms >= 0.006 && rms < 0.09 && hiShare > 0.20;
      var muddy = rms > 0.025 && mudShare > 0.81 && lowMidE / (sum + 1e-18) > 0.30;
      if (highInQuiet) quietHighWindows++;
      if (muddy) lowMidHeavy++;
      flatHits += flatInWindow;
      impulseHits += impulsesInWindow;
      totalPower += sum;
      totalSamples += n * C;
      windowSummaries.push({
        rms: rms, highShare: hiShare, lowMidShare: mudShare,
        flatTopEvents: flatInWindow, clickLikeEvents: impulsesInWindow
      });
    }

    var evidence = {
      peak: peak, rms: Math.sqrt(totalPower / totalSamples),
      flatTopEvents: flatHits, clickLikeEvents: impulseHits,
      quietTrebleWindows: quietHighWindows, lowMidHeavyWindows: lowMidHeavy,
      sampledWindows: windows.length, sampledSeconds: totalSamples / (sr * windows[0].channels.length)
    };
    return { metrics: evidence, windows: windowSummaries };
  }

  function recommend(analysis) {
    if (!analysis || !analysis.metrics) throw new Error('Missing Auto Clean analysis.');
    var m = analysis.metrics, notes = [], warnings = [];
    var clipping = m.flatTopEvents >= 2 || m.peak > 1.005;
    var clicks = m.clickLikeEvents >= 3;
    var noisy = m.quietTrebleWindows >= Math.max(2, Math.ceil(m.sampledWindows * 0.2));
    var muddy = m.lowMidHeavyWindows >= Math.max(2, Math.ceil(m.sampledWindows * 0.5));
    // These are hypotheses from partial song windows, not source separation.
    if (clipping) {
      warnings.push('Repeated flattened high-level peaks may indicate clipping or hard limiting. The current tools cannot reconstruct damaged drum hits.');
    }
    if (clicks) {
      warnings.push('Very short discontinuities were detected. They may be clicks, percussion, or deliberate sound effects; static/shimmer reduction is not a reliable de-clicker.');
    }
    if (noisy) {
      notes.push('Elevated high-frequency energy persists in quieter sampled passages. This may be hiss, shimmer, cymbals, or intentional texture.');
    }
    if (muddy) {
      notes.push('Low-mid energy dominates several sampled passages. A small clarity cut may help, but bass-heavy music can trigger the same signal.');
    }
    var clean = {
      denoise: !!noisy,
      denoiseStrength: noisy ? (clipping ? 0.55 : 0.7) : 0.65,
      maxAttenDb: noisy ? 4.5 : 4,
      quietPct: 10,
      bassHz: 350,
      shimmer: noisy ? (clipping ? 0.2 : 0.35) : 0,
      shimmerMaxDb: noisy ? 4 : 3,
      shimmerFromHz: 5500
    };
    var polish = {
      clarity: muddy ? 25 : 0, presence: 0,
      dynamics: 0, transients: 0, targetLufs: null
    };
    var shouldProcess = noisy || muddy;
    if (!shouldProcess) {
      notes.push(clipping || clicks ?
        'No automatic processing is recommended for these defects. Check the original WAV or re-render; avoid adding transient/presence boosts.' :
        'No strong degradation indicator was found in the sampled windows. Leaving the original unchanged is the safest result.');
    } else {
      notes.push('Suggested processing is deliberately restrained. Compare against Original at matched listening loudness.');
    }
    warnings.push('This is a sampled, rule-based estimate. It cannot isolate drums, distinguish all artistic distortion, or confirm what caused an artifact.');
    return {
      shouldProcess: shouldProcess,
      clean: clean,
      polish: polish,
      applyPolish: muddy,
      metrics: m,
      findings: { clipping: clipping, clicks: clicks, noisy: noisy, muddy: muddy },
      explanation: notes.concat(warnings).join(' '),
      warnings: warnings,
      notes: notes
    };
  }

  var api = {
    VERSION: '1', sampleWindows: sampleWindows, analyze: analyze, recommend: recommend,
    inspect: function (windows, sampleRate) { return recommend(analyze(windows, sampleRate)); }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SunoAutoClean = api;
})(typeof self !== 'undefined' ? self : null);
