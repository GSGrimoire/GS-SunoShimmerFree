/* SSF stem sample-rate conversion v1.
 * Polyphase-style windowed-sinc, band-limited interpolation. For explicitly
 * permitted sample-rate mismatches only. Avoids aliases produced by linear
 * interpolation during downsampling. No audio is uploaded.
 */
(function (root) {
  'use strict';
  var RADIUS = 32;
  var PI = Math.PI;
  function validRate(rate) { return Number.isFinite(rate) && rate >= 8000 && rate <= 384000; }
  function sinc(x) { return Math.abs(x) < 1e-10 ? 1 : Math.sin(PI * x) / (PI * x); }
  function resample(channels, sourceRate, targetRate) {
    if (!Array.isArray(channels) || !channels.length ||
        !validRate(sourceRate) || !validRate(targetRate)) {
      throw new Error('Invalid audio or sample rate for stem conversion.');
    }
    var sourceCount = channels[0].length, count = channels.length;
    if (!sourceCount || count > 2) throw new Error('Only nonempty mono/stereo stem resampling is supported.');
    for (var c = 0; c < count; c++) {
      if (!channels[c] || channels[c].length !== sourceCount) throw new Error('Stem channel lengths differ.');
    }
    if (sourceRate === targetRate) return channels.map(function(a) { return a.slice(); });
    var outputCount = Math.round(sourceCount * targetRate / sourceRate);
    // 90% of the smaller Nyquist frequency leaves a conservative transition
    // band for finite-kernel stopband rejection. This intentionally rolls off
    // the very highest frequencies instead of folding them into the mix.
    var cutoff = 0.5 * Math.min(1, targetRate / sourceRate) * 0.90;
    var outputs = channels.map(function() { return new Float32Array(outputCount); });
    for (var i = 0; i < outputCount; i++) {
      var pos = i * sourceRate / targetRate;
      var base = Math.floor(pos);
      var weightSum = 0, sum = new Float64Array(count);
      for (var offset = -RADIUS + 1; offset <= RADIUS; offset++) {
        var idx = base + offset;
        if (idx < 0 || idx >= sourceCount) continue;
        var t = pos - idx, r = Math.abs(t) / RADIUS;
        if (r >= 1) continue;
        // Four-term Blackman-Harris suppresses stopband leakage more than
        // the previous unfiltered linear conversion at mixed rates.
        var window = 0.35875 + 0.48829 * Math.cos(PI * r) +
          0.14128 * Math.cos(2 * PI * r) + 0.01168 * Math.cos(3 * PI * r);
        var w = (2 * cutoff) * sinc(2 * cutoff * t) * window;
        weightSum += w;
        for (var c = 0; c < count; c++) sum[c] += w * channels[c][idx];
      }
      if (Math.abs(weightSum) < 1e-12) throw new Error('Invalid stem resampling filter.');
      for (var ch = 0; ch < count; ch++) {
        var value = sum[ch] / weightSum;
        if (!Number.isFinite(value)) throw new Error('Non-finite stem audio during resampling.');
        outputs[ch][i] = value;
      }
    }
    return outputs;
  }
  var api = { VERSION: '1', resample: resample };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SunoStemResample = api;
})(typeof self !== 'undefined' ? self : null);
