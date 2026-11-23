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
    // Precompute one interpolation kernel for each sub-sample phase. This
    // avoids recomputing 64 trigonometric filter weights for every sample of
    // a long song, and needs only about 512 KiB of temporary coefficient RAM.
    var phases = 1024, taps = RADIUS * 2;
    var cutoff = 0.5 * Math.min(1, targetRate / sourceRate) * 0.90;
    var kernels = new Float64Array(phases * taps);
    for (var phase = 0; phase < phases; phase++) {
      var fraction = phase / phases, phaseOffset = phase * taps;
      for (var offset = -RADIUS + 1; offset <= RADIUS; offset++) {
        var t = fraction - offset, r = Math.abs(t) / RADIUS;
        if (r >= 1) continue;
        var window = 0.35875 + 0.48829 * Math.cos(PI * r) +
          0.14128 * Math.cos(2 * PI * r) + 0.01168 * Math.cos(3 * PI * r);
        kernels[phaseOffset + offset + RADIUS - 1] = (2 * cutoff) * sinc(2 * cutoff * t) * window;
      }
    }
    var outputs = channels.map(function() { return new Float32Array(outputCount); });
    var left = channels[0], right = channels[1];
    var dstLeft = outputs[0], dstRight = outputs[1];
    for (var i = 0; i < outputCount; i++) {
      var pos = i * sourceRate / targetRate;
      var base = Math.floor(pos);
      var phase = Math.round((pos - base) * phases);
      if (phase === phases) { base++; phase = 0; }
      var kernelOffset = phase * taps;
      var weightSum = 0, sumLeft = 0, sumRight = 0;
      for (var offset = -RADIUS + 1; offset <= RADIUS; offset++) {
        var idx = base + offset;
        if (idx < 0 || idx >= sourceCount) continue;
        var w = kernels[kernelOffset + offset + RADIUS - 1];
        weightSum += w;
        sumLeft += w * left[idx];
        if (right) sumRight += w * right[idx];
      }
      if (Math.abs(weightSum) < 1e-12) throw new Error('Invalid stem resampling filter.');
      var x = sumLeft / weightSum;
      if (!Number.isFinite(x)) throw new Error('Non-finite stem audio during resampling.');
      dstLeft[i] = x;
      if (right) {
        var y = sumRight / weightSum;
        if (!Number.isFinite(y)) throw new Error('Non-finite stem audio during resampling.');
        dstRight[i] = y;
      }
    }
    return outputs;
  }
  var api = { VERSION: '1', resample: resample };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SunoStemResample = api;
})(typeof self !== 'undefined' ? self : null);
