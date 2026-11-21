/* Incremental RIFF/WAV writer for a bounded-chunk stereo mix.
 * Requires a writable file sink. Never constructs a full-length WAV blob.
 */
(function(root) {
  'use strict';
  function header(rate, frames, bits) {
    if (![16,24,32].includes(bits) || !Number.isInteger(rate) || rate<1 ||
        !Number.isSafeInteger(frames) || frames<1)
      throw new Error('Invalid streaming WAV format or duration.');
    var dataBytes=frames*2*(bits/8);
    if (!Number.isSafeInteger(dataBytes) || dataBytes>0xffffffff-36)
      throw new Error('WAV exceeds RIFF 4 GiB limit. Export a shorter selection.');
    var out=new ArrayBuffer(44), v=new DataView(out);
    function word(p,s){for(var i=0;i<4;i++)v.setUint8(p+i,s.charCodeAt(i));}
    word(0,'RIFF');v.setUint32(4,36+dataBytes,true);word(8,'WAVE');
    word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,bits===32?3:1,true);
    v.setUint16(22,2,true);v.setUint32(24,rate,true);
    v.setUint32(28,rate*2*(bits/8),true);v.setUint16(32,2*(bits/8),true);
    v.setUint16(34,bits,true);word(36,'data');v.setUint32(40,dataBytes,true);
    return out;
  }
  async function write(options) {
    var rate=options.rate, from=options.startFrame, to=options.endFrame,
      bits=options.bits, writable=options.writable, getChunk=options.getChunk,
      chunkFrames=options.chunkFrames||rate*10, signal=options.signal;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from<0 ||
        to<=from || !Number.isSafeInteger(chunkFrames) || chunkFrames<1)
      throw new Error('Invalid streaming WAV frame range.');
    var total=to-from, written=0;
    try {
      await writable.write(header(rate,total,bits));
      for(var pos=from;pos<to;pos+=chunkFrames) {
        if (signal && signal.aborted) throw new Error('WAV export cancelled.');
        var count=Math.min(chunkFrames,to-pos);
        var channels=await getChunk(pos,count);
        if (signal && signal.aborted) throw new Error('WAV export cancelled.');
        if (!Array.isArray(channels) || channels.length!==2 ||
            channels[0].length!==count || channels[1].length!==count)
          throw new Error('WAV chunk does not match the requested frame interval.');
        // Encode each bounded chunk with the same codec as preview export.
        var codec=options.codec || root.WavCodec;
        if (!codec || typeof codec.encodeWav!=='function')
          throw new Error('WAV codec unavailable.');
        var bytes=codec.encodeWav(channels,rate,bits);
        await writable.write(new Uint8Array(bytes,44));
        written+=count;
        if (options.onProgress) options.onProgress(written,total);
      }
      if (written!==total) throw new Error('WAV export incomplete.');
      await writable.close();
    } catch(err) {
      try {await writable.abort();}catch(_){}
      throw err;
    }
  }
  var api={header:header,write:write};
  if (typeof module!=='undefined'&&module.exports) module.exports=api;
  else root.SunoStemWavStream=api;
})(typeof self!=='undefined'?self:this);
