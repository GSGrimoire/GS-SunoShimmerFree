/* GS SunoShimmerFree worker v1
 * Runs engine.js off the main thread so the page stays responsive.
 * Version history
 *   v1  First release.
 */
importScripts('engine.js');

self.onmessage = function (e) {
  var m = e.data;
  if (m.type !== 'process') return;
  try {
    var lastPost = 0;
    var res = self.ShimmerEngine.process(m.channels, m.sampleRate, m.params, {
      progress: function (f, stage) {
        var now = Date.now();
        if (now - lastPost > 80 || f >= 1) { lastPost = now; self.postMessage({ type: 'progress', fraction: f, stage: stage }); }
      },
      spectrogram: function (kind, spec) {
        self.postMessage({ type: 'spectrogram', kind: kind, spec: spec }, [spec.data.buffer]);
      }
    });
    var transfer = res.clean.map(function (c) { return c.buffer; })
      .concat(res.removed.map(function (c) { return c.buffer; }));
    self.postMessage({ type: 'done', clean: res.clean, removed: res.removed, report: res.report }, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
