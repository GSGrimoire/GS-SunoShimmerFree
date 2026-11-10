/* Browser-local Auto Clean analysis worker. No network/audio upload. */
importScripts('auto-clean.js');
self.onmessage = function (event) {
  if (!event.data || event.data.type !== 'analyze') return;
  try {
    var answer = self.SunoAutoClean.inspect(event.data.windows, event.data.sampleRate);
    self.postMessage({ type: 'done', result: answer });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
