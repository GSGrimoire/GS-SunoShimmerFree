/* GS SunoShimmerFree Sound Polish background worker v2. */
importScripts('polish.js');
self.onmessage = function (event) {
  var m = event.data;
  if (m.type !== 'polish') return;
  try {
    var result = self.SunoPolish.process(m.channels, m.sampleRate, m.params);
    self.postMessage({ type: 'done', channels: result.channels,
      settings: result.settings, peak: result.peak,
      dynamicMaxReductionDb: result.dynamicMaxReductionDb, safetyGainDb: result.safetyGainDb },
      result.channels.map(function (c) { return c.buffer; }));
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
