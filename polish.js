/* GS SunoShimmerFree Sound Polish v1.
 * Pure JavaScript, deterministic offline tone processing. No external services.
 * Clarity: low-mid bell cut. Presence: restrained upper-mid bell boost.
 * Same filter coefficients on every channel; independent filter histories.
 */
(function (root) {
  'use strict';
  var PRESETS = {
    natural: { clarity: 20, presence: 20 },
    clear: { clarity: 55, presence: 55 },
    warm: { clarity: 25, presence: 10 },
    forward: { clarity: 20, presence: 70 }
  };
  function amount(v) {
    v = Number(v);
    return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
  }
  function settings(p) {
    p = p || {};
    return { clarity: amount(p.clarity), presence: amount(p.presence) };
  }
  function bell(sampleRate, frequency, q, db) {
    var w = 2 * Math.PI * Math.min(frequency, sampleRate * 0.42) / sampleRate;
    var a = Math.pow(10, db / 40), alpha = Math.sin(w) / (2 * q), cw = Math.cos(w);
    var a0 = 1 + alpha / a;
    return {
      b0: (1 + alpha * a) / a0,
      b1: (-2 * cw) / a0,
      b2: (1 - alpha * a) / a0,
      a1: (-2 * cw) / a0,
      a2: (1 - alpha / a) / a0
    };
  }
  function process(channels, sampleRate, params) {
    if (!Array.isArray(channels) || !channels.length || !channels[0] || !channels[0].length) {
      throw new Error('Sound Polish needs at least one non-empty audio channel.');
    }
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
      throw new Error('Unsupported Sound Polish sample rate.');
    }
    var n = channels[0].length, p = settings(params);
    for (var c = 0; c < channels.length; c++) {
      if (!channels[c] || channels[c].length !== n) throw new Error('Audio channels have different lengths.');
    }
    var active = p.clarity > 0 || p.presence > 0, output = [];
    var eq = [
      bell(sampleRate, 320, 0.80, -3 * p.clarity / 100),
      bell(sampleRate, 2500, 0.90, 2.5 * p.presence / 100)
    ];
    var peak = 0;
    for (var ch = 0; ch < channels.length; ch++) {
      var input = channels[ch], out = new Float32Array(n);
      if (!active) {
        out.set(input);
      } else {
        var z1 = [0, 0], z2 = [0, 0];
        for (var i = 0; i < n; i++) {
          var x = input[i];
          if (!Number.isFinite(x)) throw new Error('Audio contains a non-finite sample.');
          for (var k = 0; k < eq.length; k++) {
            var f = eq[k], y = f.b0 * x + z1[k];
            z1[k] = f.b1 * x - f.a1 * y + z2[k];
            z2[k] = f.b2 * x - f.a2 * y;
            x = y;
          }
          out[i] = x;
        }
      }
      for (var j = 0; j < n; j++) {
        if (!Number.isFinite(out[j])) throw new Error('Sound Polish generated an invalid sample.');
        var value = Math.abs(out[j]);
        if (value > peak) peak = value;
      }
      output.push(out);
    }
    // Never let an enabled tone boost overrun the current full-scale peak.
    // A single linked attenuation preserves the stereo balance.
    var gain = active && peak > 0.97 ? 0.97 / peak : 1;
    if (gain < 1) {
      for (var a = 0; a < output.length; a++) {
        for (var t = 0; t < n; t++) output[a][t] *= gain;
      }
    }
    return { channels: output, settings: p, peak: peak * gain,
      safetyGainDb: gain < 1 ? 20 * Math.log10(gain) : 0 };
  }
  var api = { VERSION: '1', PRESETS: PRESETS, settings: settings, process: process };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SunoPolish = api;
})(typeof self !== 'undefined' ? self : null);
