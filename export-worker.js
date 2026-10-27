/* Render an edit snapshot and encode MP3 without blocking the page. */
importScripts('vendor/lamejs-1.2.1/lame.min.js', 'mp3.js', 'edit.js');

self.onmessage = function (event) {
  var m = event.data;
  if (m.type !== 'mp3') return;
  try {
    var channels = m.channels;
    if (m.segs) channels = self.ShimmerEdit.render(channels, m.segs, m.sampleRate).channels;
    var lastPost = 0;
    var result = self.Mp3Codec.encodeMp3(channels, m.sampleRate, m.bitrate, function (fraction) {
      var now = Date.now();
      if (now - lastPost > 100 || fraction === 1) {
        lastPost = now;
        self.postMessage({ type: 'progress', fraction: fraction });
      }
    });
    self.postMessage({ type: 'done', bytes: result.bytes, peak: result.peak }, [result.bytes.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
