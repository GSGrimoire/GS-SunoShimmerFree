/* Local MP3 encoding shared by the export worker and command line.
 * The unmodified lamejs bundle is loaded separately; see vendor/README.md.
 */
(function (root) {
  'use strict';
  var lame = root.lamejs;

  function encodeMp3(channels, sampleRate, bitrate, progress) {
    if (!channels || (channels.length !== 1 && channels.length !== 2)) {
      throw new Error('MP3 supports mono or stereo. Use WAV to keep all channels.');
    }
    if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) {
      throw new Error('MP3 export supports source sample rates from 8000 to 192000 Hz. Use WAV for this track.');
    }
    if ([192, 256, 320].indexOf(bitrate) < 0) throw new Error('Choose an MP3 bitrate of 192, 256 or 320.');
    var n = channels[0].length;
    if (!n || channels.some(function (c) { return c.length !== n; })) {
      throw new Error('MP3 export needs nonempty channels of equal length.');
    }
    if (!lame && typeof module !== 'undefined' && module.exports) {
      var fs = require('fs'), path = require('path'), vm = require('vm');
      var context = {};
      vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'vendor/lamejs-1.2.1/lame.min.js'), 'utf8'), context);
      lame = context.lamejs;
    }
    if (!lame) throw new Error('The local MP3 encoder could not load. You can still download WAV.');

    // lamejs resamples internally to an MP3-supported rate when necessary.
    var encoder = new lame.Mp3Encoder(channels.length, sampleRate, bitrate);
    var chunks = [], size = 0, peak = 0, block = 1152;
    var pcm = channels.map(function () { return new Int16Array(block); });
    function collect(data) {
      if (data.length) { var copy = new Uint8Array(data); chunks.push(copy); size += copy.length; }
    }
    for (var offset = 0; offset < n; offset += block) {
      var count = Math.min(block, n - offset);
      for (var c = 0; c < channels.length; c++) {
        for (var j = 0; j < count; j++) {
          var value = channels[c][offset + j];
          if (!Number.isFinite(value)) throw new Error('The track contains invalid audio samples.');
          peak = Math.max(peak, Math.abs(value));
          pcm[c][j] = Math.max(-32768, Math.min(32767, Math.round(value * 32768)));
        }
      }
      collect(encoder.encodeBuffer(pcm[0].subarray(0, count), channels.length === 2 ? pcm[1].subarray(0, count) : undefined));
      if (progress) progress((offset + count) / n);
    }
    collect(encoder.flush());
    var bytes = new Uint8Array(size), pos = 0;
    chunks.forEach(function (chunk) { bytes.set(chunk, pos); pos += chunk.length; });
    return { bytes: bytes, peak: peak };
  }

  var api = { encodeMp3: encodeMp3 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Mp3Codec = api;
})(typeof self !== 'undefined' ? self : this);
