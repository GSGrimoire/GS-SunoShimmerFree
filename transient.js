/* GS SunoShimmerFree transient enhancer v1.
 * Optional, linked low/mid-band attack emphasis. No service or learned model.
 * Designed to avoid boosting high-frequency hiss and shimmer.
 */
(function (root) {
  'use strict';

  function clampAmount(value) {
    value = Number(value);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  }

  // In-place on fresh processing buffers, NOT on user-provided originals.
  // All channels share the same onset envelope; each gets its own identical
  // low/mid-band filters. Gains are modest and remain subject to final peak
  // protection in the parent Sound Polish pipeline.
  function processInPlace(channels, sampleRate, requestedAmount) {
    var amount = clampAmount(requestedAmount);
    if (!amount) return { maxBandBoostDb: 0, activeSamples: 0 };
    if (!Array.isArray(channels) || !channels.length || !channels[0]) {
      throw new Error('Transient enhancement requires audio channels.');
    }
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
      throw new Error('Unsupported transient enhancement sample rate.');
    }
    var count = channels.length, n = channels[0].length, ch, i;
    for (ch = 0; ch < count; ch++) {
      if (!channels[ch] || channels[ch].length !== n) {
        throw new Error('Transient audio channel lengths differ.');
      }
    }
    // 55 Hz high-pass followed by two 850 Hz low-passes. High-frequency
    // artifacts are strongly attenuated in the component being boosted.
    var hpPole = Math.exp(-2 * Math.PI * 55 / sampleRate);
    var lpPole = Math.exp(-2 * Math.PI * 850 / sampleRate);
    var fastPole = Math.exp(-1 / (sampleRate * 0.004));
    var slowPole = Math.exp(-1 / (sampleRate * 0.075));
    var releasePole = Math.exp(-1 / (sampleRate * 0.030));
    var hpMemory = new Float64Array(count);
    var lpMemory1 = new Float64Array(count);
    var lpMemory2 = new Float64Array(count);
    var band = new Float64Array(count);
    var fastPower = 0, slowPower = 0, envelope = 0, maxMix = 0;
    var activeSamples = 0;
    var maxMixAllowed = 0.35 * amount / 100;

    for (i = 0; i < n; i++) {
      var avgPower = 0;
      for (ch = 0; ch < count; ch++) {
        var x = channels[ch][i];
        if (!Number.isFinite(x)) throw new Error('Transient enhancement received non-finite samples.');
        hpMemory[ch] = hpPole * hpMemory[ch] + (1 - hpPole) * x;
        var highPassed = x - hpMemory[ch];
        lpMemory1[ch] = lpPole * lpMemory1[ch] + (1 - lpPole) * highPassed;
        lpMemory2[ch] = lpPole * lpMemory2[ch] + (1 - lpPole) * lpMemory1[ch];
        band[ch] = lpMemory2[ch];
        avgPower += band[ch] * band[ch] / count;
      }

      fastPower = fastPole * fastPower + (1 - fastPole) * avgPower;
      slowPower = slowPole * slowPower + (1 - slowPole) * avgPower;
      var slowRms = Math.sqrt(slowPower);
      var fastRms = Math.sqrt(fastPower);
      // Require a meaningful low/mid-frequency attack, not a faint tail.
      var score = slowRms < 0.012 ? 0 :
        Math.max(0, Math.min(1, (fastRms / (slowRms + 1e-6) - 1.35) / 1.8));
      envelope = score > envelope ? score :
        releasePole * envelope + (1 - releasePole) * score;
      // The 0.35 cap means even 100% adds at most 35% of the bandpassed
      // attack, and does not amplify the upper band indiscriminately.
      var mix = maxMixAllowed * envelope;
      if (mix > 1e-6) activeSamples++;
      if (mix > maxMix) maxMix = mix;
      if (mix) for (ch = 0; ch < count; ch++) {
        channels[ch][i] += mix * band[ch];
      }
    }
    return {
      maxBandBoostDb: 20 * Math.log10(1 + maxMix),
      activeSamples: activeSamples
    };
  }
  var api = { VERSION: '1', processInPlace: processInPlace };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SunoTransient = api;
})(typeof self !== 'undefined' ? self : null);
