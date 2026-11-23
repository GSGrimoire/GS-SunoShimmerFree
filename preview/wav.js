/* GS SunoShimmerFree WAV codec v1
 *
 * Reads PCM (8, 16, 24, 32-bit integer), IEEE float (32, 64-bit) and
 * WAVE_FORMAT_EXTENSIBLE files into Float32 channels, keeping the exact
 * sample rate. Writes 16-bit, 24-bit or 32-bit float PCM. Integer scaling
 * matches libsndfile (full scale = 2^(bits-1)), so files round-trip with
 * the Python and Audacity tools people already use.
 *
 * Version history
 *   v1  First release.
 */
(function (root) {
  'use strict';

  function decodeWav(buf) {
    var dv = new DataView(buf), len = buf.byteLength;
    function tag(o) { return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3)); }
    if (len < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file (no RIFF/WAVE header).');
    var o = 12, fmt = null, dataOff = -1, dataLen = 0;
    while (o + 8 <= len) {
      var id = tag(o), size = dv.getUint32(o + 4, true), body = o + 8;
      if (id === 'fmt ') {
        fmt = { code: dv.getUint16(body, true), ch: dv.getUint16(body + 2, true), sr: dv.getUint32(body + 4, true),
                align: dv.getUint16(body + 12, true), bits: dv.getUint16(body + 14, true) };
        if (fmt.code === 0xFFFE && size >= 26) fmt.code = dv.getUint16(body + 24, true);
      } else if (id === 'data') {
        dataOff = body;
        dataLen = (size === 0xFFFFFFFF || body + size > len) ? len - body : size;
        break;
      }
      o = body + size + (size & 1);
    }
    if (!fmt) throw new Error('WAV file has no fmt chunk.');
    if (dataOff < 0) throw new Error('WAV file has no data chunk.');
    var isFloat = fmt.code === 3, isPcm = fmt.code === 1;
    if (!isFloat && !isPcm) throw new Error('Unsupported WAV encoding (format code ' + fmt.code + '). Export as PCM or float WAV.');
    var bytes = fmt.bits / 8, C = fmt.ch, frames = Math.floor(dataLen / (bytes * C));
    if (!C) throw new Error('WAV file reports zero channels.');
    var chans = [], c, i;
    for (c = 0; c < C; c++) chans.push(new Float32Array(frames));
    var p = dataOff;
    if (isFloat && fmt.bits === 32) {
      for (i = 0; i < frames; i++) for (c = 0; c < C; c++) { chans[c][i] = dv.getFloat32(p, true); p += 4; }
    } else if (isFloat && fmt.bits === 64) {
      for (i = 0; i < frames; i++) for (c = 0; c < C; c++) { chans[c][i] = dv.getFloat64(p, true); p += 8; }
    } else if (isPcm && fmt.bits === 16) {
      for (i = 0; i < frames; i++) for (c = 0; c < C; c++) { chans[c][i] = dv.getInt16(p, true) / 32768; p += 2; }
    } else if (isPcm && fmt.bits === 24) {
      for (i = 0; i < frames; i++) for (c = 0; c < C; c++) {
        var v = dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getInt8(p + 2) << 16);
        chans[c][i] = v / 8388608; p += 3;
      }
    } else if (isPcm && fmt.bits === 32) {
      for (i = 0; i < frames; i++) for (c = 0; c < C; c++) { chans[c][i] = dv.getInt32(p, true) / 2147483648; p += 4; }
    } else if (isPcm && fmt.bits === 8) {
      for (i = 0; i < frames; i++) for (c = 0; c < C; c++) { chans[c][i] = (dv.getUint8(p) - 128) / 128; p += 1; }
    } else {
      throw new Error('Unsupported WAV bit depth: ' + fmt.bits + '-bit ' + (isFloat ? 'float' : 'PCM') + '.');
    }
    return { sampleRate: fmt.sr, channels: chans, bits: fmt.bits, float: isFloat };
  }

  // bits: 16, 24 or 32 (32 = IEEE float)
  function encodeWav(chans, sampleRate, bits) {
    if ([16, 24, 32].indexOf(bits) < 0) throw new Error('Output bit depth must be 16, 24 or 32.');
    var C = chans.length, n = chans[0].length, bytes = bits / 8, dataLen = n * C * bytes;
    var buf = new ArrayBuffer(44 + dataLen), dv = new DataView(buf);
    function str(o, s) { for (var k = 0; k < 4; k++) dv.setUint8(o + k, s.charCodeAt(k)); }
    str(0, 'RIFF'); dv.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
    str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, bits === 32 ? 3 : 1, true);
    dv.setUint16(22, C, true); dv.setUint32(24, sampleRate, true);
    dv.setUint32(28, sampleRate * C * bytes, true); dv.setUint16(32, C * bytes, true); dv.setUint16(34, bits, true);
    str(36, 'data'); dv.setUint32(40, dataLen, true);
    var p = 44, i, c, v;
    if (bits === 32) {
      for (i = 0; i < n; i++) for (c = 0; c < C; c++) { dv.setFloat32(p, chans[c][i], true); p += 4; }
    } else if (bits === 24) {
      for (i = 0; i < n; i++) for (c = 0; c < C; c++) {
        v = Math.round(chans[c][i] * 8388608);
        v = v > 8388607 ? 8388607 : (v < -8388608 ? -8388608 : v);
        dv.setUint8(p, v & 255); dv.setUint8(p + 1, (v >> 8) & 255); dv.setUint8(p + 2, (v >> 16) & 255); p += 3;
      }
    } else {
      for (i = 0; i < n; i++) for (c = 0; c < C; c++) {
        v = Math.round(chans[c][i] * 32768);
        v = v > 32767 ? 32767 : (v < -32768 ? -32768 : v);
        dv.setInt16(p, v, true); p += 2;
      }
    }
    return buf;
  }

  var api = { decodeWav: decodeWav, encodeWav: encodeWav };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WavCodec = api;
})(typeof self !== 'undefined' ? self : this);
