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

  // Studio-only bounded passage reader. Validate the entire source layout before
  // allocating even a temporary excerpt; the legacy full-file reader remains
  // unchanged for production single-track callers.
  function decodeWavPassage(buf, startSeconds, endSeconds, maxBytes) {
    var dv=new DataView(buf), len=buf.byteLength;
    function tag(o){return String.fromCharCode(dv.getUint8(o),dv.getUint8(o+1),dv.getUint8(o+2),dv.getUint8(o+3));}
    if(len<12||tag(0)!=='RIFF'||tag(8)!=='WAVE') throw new Error('Invalid WAV RIFF header.');
    var declared=dv.getUint32(4,true);
    // RF64 and streaming sentinel lengths require a separate ds64-aware reader.
    if(declared===0xFFFFFFFF||declared<4||declared>len-8)
      throw new Error('Invalid or unsupported WAV RIFF size.');
    var limit=declared+8;
    // A physical suffix outside RIFF is not audio. Reject it rather than
    // silently accepting ambiguous appended containers or payloads.
    if(limit!==len) throw new Error('WAV trailing bytes outside RIFF.');
    var o=12,fmt=null,off=-1,size=0;
    while(o+8<=limit){
      var id=tag(o),n=dv.getUint32(o+4,true),body=o+8;
      if(n>limit-body) throw new Error('Truncated WAV chunk.');
      if((n&1)&&body+n===limit) throw new Error('Missing WAV chunk pad byte.');
      if(id==='fmt '){
        if(n<16) throw new Error('Truncated WAV format.');
        fmt={code:dv.getUint16(body,true),ch:dv.getUint16(body+2,true),
          sr:dv.getUint32(body+4,true),align:dv.getUint16(body+12,true),
          bits:dv.getUint16(body+14,true)};
        if(fmt.code===65534){
          if(n<40||dv.getUint16(body+16,true)<22)
            throw new Error('Invalid extensible WAV format.');
          // KSDATAFORMAT_SUBTYPE_PCM/IEEE_FLOAT are the complete standard GUIDs.
          var subtype=dv.getUint32(body+24,true);
          var guid=[0,0,16,0,128,0,0,170,0,56,155,113];
          for(var gi=0;gi<12;gi++)
            if(dv.getUint8(body+28+gi)!==guid[gi])
              throw new Error('Unsupported extensible WAV subtype GUID.');
          if(subtype!==1&&subtype!==3)
            throw new Error('Unsupported extensible WAV subtype GUID.');
          fmt.code=subtype;
        }
      }
      if(id==='data'){off=body;size=n;break;}
      o=body+n+(n&1);
    }
    if(!fmt||off<0) throw new Error('WAV format or data chunk missing.');
    if(fmt.ch<1||fmt.ch>2||!Number.isSafeInteger(fmt.sr)||fmt.sr<1)
      throw new Error('Unsupported WAV channels or sample rate.');
    var valid=(fmt.code===1&&[8,16,24,32].includes(fmt.bits))||
      (fmt.code===3&&[32,64].includes(fmt.bits));
    var stride=fmt.ch*fmt.bits/8;
    if(!valid||fmt.align!==stride||size%stride)
      throw new Error('Unsupported or unaligned WAV sample format.');
    var sourceFrames=size/stride;
    if(!Number.isSafeInteger(sourceFrames)||!Number.isFinite(startSeconds)||
       !Number.isFinite(endSeconds)||startSeconds<0||
       (endSeconds!==0&&endSeconds<=startSeconds))
      throw new Error('Invalid WAV passage boundaries.');
    var start=Math.round(startSeconds*fmt.sr);
    var end=endSeconds===0?sourceFrames:Math.round(endSeconds*fmt.sr);
    var count=end-start, decoded=count*fmt.ch*4, raw=count*stride;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
       start>=sourceFrames||end>sourceFrames||count<1||
       !Number.isSafeInteger(decoded)||decoded>maxBytes||
       !Number.isSafeInteger(raw)||raw+44>maxBytes)
      throw new Error('WAV passage exceeds source or memory budget.');
    var cropped=new ArrayBuffer(44+raw),out=new DataView(cropped);
    function writeTag(at,t){for(var k=0;k<4;k++)out.setUint8(at+k,t.charCodeAt(k));}
    writeTag(0,'RIFF');out.setUint32(4,36+raw,true);writeTag(8,'WAVE');
    writeTag(12,'fmt ');out.setUint32(16,16,true);
    out.setUint16(20,fmt.code,true);out.setUint16(22,fmt.ch,true);
    out.setUint32(24,fmt.sr,true);out.setUint32(28,fmt.sr*stride,true);
    out.setUint16(32,stride,true);out.setUint16(34,fmt.bits,true);
    writeTag(36,'data');out.setUint32(40,raw,true);
    new Uint8Array(cropped,44).set(new Uint8Array(buf,off+start*stride,raw));
    var result=decodeWav(cropped);
    result.passageStartFrame=start;result.sourceFrames=sourceFrames;
    return result;
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

  var api = { decodeWav: decodeWav, decodeWavPassage: decodeWavPassage, encodeWav: encodeWav };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WavCodec = api;
})(typeof self !== 'undefined' ? self : this);
