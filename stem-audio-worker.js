/* Per-stem offline processing. One decoded stem is transferred to this worker at a time. */
importScripts('engine.js', 'loudness.js', 'polish.js');
self.onmessage = function(event) {
  var m = event.data;
  if (!m || m.type !== 'stem-process') return;
  try {
    var channels = m.channels;
    if (m.clean) {
      var result = self.ShimmerEngine.process(channels, m.sampleRate, m.cleanParams || self.ShimmerEngine.DEFAULTS);
      channels = result.clean;
    }
    var note = null, achieved = null;
    if (m.polish) {
      var polished = self.SunoPolish.process(channels, m.sampleRate, m.polishParams);
      channels = polished.channels;
      achieved = polished.loudnessAfter;
      if (polished.normalizationLimited) note = polished.loudnessMessage || 'Loudness target was limited by level or peak constraints.';
    }
    self.postMessage({type: 'done', channels: channels, sampleRate: m.sampleRate,
      note: note, loudnessAfter: achieved}, channels.map(function(c) { return c.buffer; }));
  } catch (err) {
    self.postMessage({type: 'error', message: err.message || String(err)});
  }
};