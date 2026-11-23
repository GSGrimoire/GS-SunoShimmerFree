/* GS SunoShimmerFree Sound Polish background worker v4. */
importScripts('loudness.js', 'transient.js', 'polish.js');
self.onmessage = function (event) {
  var m = event.data;
  if (m.type !== 'polish') return;
  try {
    var result = self.SunoPolish.process(m.channels, m.sampleRate, m.params);
    self.postMessage({ type: 'done', channels: result.channels,
      settings: result.settings, peak: result.peak,
      dynamicMaxReductionDb: result.dynamicMaxReductionDb,
      transientMaxBandBoostDb: result.transientMaxBandBoostDb,
      transientActiveSamples: result.transientActiveSamples,
      loudnessBefore: result.loudnessBefore, loudnessAfter: result.loudnessAfter,
      loudnessMessage: result.loudnessMessage,
      normalizationGainDb: result.normalizationGainDb,
      normalizationLimited: result.normalizationLimited,
      safetyGainDb: result.safetyGainDb },
      result.channels.map(function (c) { return c.buffer; }));
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
