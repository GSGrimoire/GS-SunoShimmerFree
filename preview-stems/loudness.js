/* SSF Loudness v1: local K-weighted gated integrated loudness meter.
 * Adapted from the ITU-R BS.1770/EBU R128 measurement structure.
 * DeMan digital filter coefficients used for variable sample rates.
 * Mono/stereo only. This does not measure true peak.
 */
(function (root) {
  'use strict';
  function biquad(b0, b1, b2, a1, a2) {
    return { b0: b0, b1: b1, b2: b2, a1: a1, a2: a2, x1: 0, x2: 0, y1: 0, y2: 0 };
  }
  function shelf(sampleRate) {
    var f = 1681.9744509555319, q = 0.7071752369554193, gainDb = 3.99984385397;
    var k = Math.tan(Math.PI * f / sampleRate);
    var vh = Math.pow(10, gainDb / 20), vb = Math.pow(vh, 0.499666774155);
    var a0 = 1 + k / q + k * k;
    return biquad((vh + vb * k / q + k * k) / a0,
      2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0,
      2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0);
  }
  function highPass(sampleRate) {
    var f = 38.13547087613982, q = 0.5003270373253953;
    var k = Math.tan(Math.PI * f / sampleRate), a0 = 1 + k / q + k * k;
    return biquad(1, -2, 1, 2 * (k * k - 1) / a0,
      (1 - k / q + k * k) / a0);
  }
  function stepFilter(f, x) {
    var y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
    f.x2 = f.x1; f.x1 = x; f.y2 = f.y1; f.y1 = y;
    return y;
  }
  function measure(channels, sampleRate) {
    if (!Array.isArray(channels) || channels.length < 1) throw new Error('Expected audio channels.');
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
      throw new Error('Unsupported loudness meter sample rate.');
    }
    var n = channels[0].length, c, i, peak = 0;
    for (c = 0; c < channels.length; c++) {
      if (!channels[c] || channels[c].length !== n) throw new Error('Audio channel lengths differ.');
      for (i = 0; i < n; i++) {
        var a = Math.abs(channels[c][i]);
        if (!Number.isFinite(a)) throw new Error('Invalid loudness input sample.');
        if (a > peak) peak = a;
      }
    }
    var windowSamples = Math.round(sampleRate * 0.4);
    if (channels.length > 2 || n < windowSamples) {
      return { valid: false, lufs: null, peak: peak,
        reason: channels.length > 2 ? 'Only mono or stereo integrated loudness is supported.' :
          'Integrated loudness needs at least 400 milliseconds of audio.' };
    }
    var hopSamples = Math.round(sampleRate * 0.1);
    var blockCount = Math.floor((n - windowSamples) / hopSamples) + 1;
    var blockPower = new Float64Array(blockCount);
    for (c = 0; c < channels.length; c++) {
      var s1 = shelf(sampleRate), s2 = highPass(sampleRate);
      var ring = new Float64Array(windowSamples), sum = 0, block = 0;
      var input = channels[c];
      for (i = 0; i < n; i++) {
        var x = stepFilter(s2, stepFilter(s1, input[i]));
        var power = x * x, index = i % windowSamples;
        if (i >= windowSamples) sum -= ring[index];
        ring[index] = power;
        sum += power;
        if (i >= windowSamples - 1 && (i + 1 - windowSamples) % hopSamples === 0) {
          blockPower[block++] += Math.max(0, sum / windowSamples);
        }
      }
    }
    var absoluteGatePower = Math.pow(10, (-70 + 0.691) / 10);
    var sumA = 0, countA = 0;
    for (i = 0; i < blockCount; i++) {
      if (blockPower[i] > absoluteGatePower) { sumA += blockPower[i]; countA++; }
    }
    if (!countA) return { valid: false, lufs: null, peak: peak, reason: 'Audio is below the absolute loudness gate.' };
    var ungated = -0.691 + 10 * Math.log10(sumA / countA);
    var relativeGatePower = Math.pow(10, (ungated - 10 + 0.691) / 10);
    var threshold = Math.max(absoluteGatePower, relativeGatePower);
    var sumG = 0, countG = 0;
    for (i = 0; i < blockCount; i++) {
      if (blockPower[i] > threshold) { sumG += blockPower[i]; countG++; }
    }
    if (!countG) return { valid: false, lufs: null, peak: peak, reason: 'No blocks passed the loudness gate.' };
    var lufs = -0.691 + 10 * Math.log10(sumG / countG);
    return { valid: Number.isFinite(lufs), lufs: lufs, peak: peak,
      blocks: blockCount, gatedBlocks: countG };
  }
  var api = { VERSION: '1', measure: measure };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SunoLoudness = api;
})(typeof self !== 'undefined' ? self : null);
