/* Experimental bounded-output MP3 decoder using browser WebCodecs.
 * Input is already-extracted compressed MP3 bytes. This is NOT bounded ZIP
 * extraction or a complete streaming export implementation.
 */
(function(root) {
  'use strict';
  function header(bytes, i) {
    // Accept only MPEG-1 Layer III. Reject reserved versions and other layers.
    if (i+4>bytes.length || bytes[i]!==255 || (bytes[i+1]&254)!==250) return null;
    var rateIndex=(bytes[i+2]>>2)&3, bitrateIndex=(bytes[i+2]>>4)&15;
    if (rateIndex===3 || !bitrateIndex || bitrateIndex===15) return null;
    var rates=[44100,48000,32000], kbps=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320];
    var rate=rates[rateIndex], size=Math.floor(144000*kbps[bitrateIndex]/rate)+((bytes[i+2]>>1)&1);
    return {rate:rate,size:size,channels:(bytes[i+3]&192)===192?1:2};
  }
  function startOfFrames(bytes) {
    if (bytes.length>=3 && bytes[0]===73 && bytes[1]===68 && bytes[2]===51) {
      if (bytes.length<10) throw new Error('Truncated ID3v2 header.');
      // ID3v2 uses four 7-bit synchsafe size bytes. The high bit is
      // reserved, and a footer is only defined for ID3v2.4.
      if (bytes[3]===255 || bytes[3]<2 || bytes[3]>4 || bytes[4]===255 ||
          (bytes[5] & (bytes[3]===2?63:bytes[3]===3?31:15)) ||
          (bytes[3]!==4 && (bytes[5]&16)) ||
          (bytes[6]|bytes[7]|bytes[8]|bytes[9])&128)
        throw new Error('Invalid ID3v2 header.');
      var size=bytes[6]*2097152+bytes[7]*16384+bytes[8]*128+bytes[9];
      var offset=10+size+((bytes[5]&16)?10:0);
      if (offset>bytes.length) throw new Error('Truncated ID3v2 metadata.');
      return offset;
    }
    return 0;
  }
  async function decodePassage(input, startSeconds, endSeconds, signal) {
    if (!root.AudioDecoder || !root.EncodedAudioChunk)
      throw new Error('Bounded MP3 preview requires browser WebCodecs AudioDecoder support.');
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) ||
        startSeconds<0 || endSeconds<=startSeconds)
      throw new Error('Bounded MP3 preview requires a finite start and end time.');
    var bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    var offset=startOfFrames(bytes), first=header(bytes,offset);
    if (!first) throw new Error('Unsupported MP3 framing: MPEG-1 Layer III is required.');
    // Xing/Info metadata may carry encoder delay/padding. Until gapless
    // accounting is implemented, never advertise frame-exact alignment.
    var sideInfo=first.channels===1?17:32;
    var xingAt=offset+4+sideInfo+((bytes[offset+1]&1)?0:2);
    if (xingAt+4<=offset+first.size) {
      var marker=String.fromCharCode.apply(null,bytes.subarray(xingAt,xingAt+4));
      if (marker==='Xing' || marker==='Info')
        throw new Error('MP3 Xing/Info encoder timing metadata is not yet supported for aligned preview.');
    }
    if (!(bytes[offset+1]&1))
      throw new Error('CRC-protected MP3 frames are not yet supported for aligned preview.');
    var start=Math.round(startSeconds*first.rate), end=Math.round(endSeconds*first.rate);
    var frames=end-start, totalBytes=frames*first.channels*4;
    if (!Number.isSafeInteger(totalBytes) || totalBytes>96*1048576)
      throw new Error('MP3 passage exceeds the 96 MiB decoded output budget.');
    var channels=Array.from({length:first.channels},function(){return new Float32Array(frames);});
    var decoder, failure=null, frameNumber=0, count=0;
    var decodedFrames=0, observedFrames=0, lastEnd=0;
    function active() { if (signal && signal.aborted) throw new Error('MP3 decoding cancelled.'); }
    function output(audio) {
      try {
        active();
        if (audio.sampleRate!==first.rate || audio.numberOfChannels!==first.channels)
          throw new Error('MP3 decoder changed rate or channel layout.');
        var begin=Math.round(audio.timestamp*first.rate/1000000), length=audio.numberOfFrames;
        if (!Number.isSafeInteger(begin) || begin<0 || !Number.isSafeInteger(length) || length<1)
          throw new Error('Invalid decoded MP3 timestamp or frame length.');
        // An initial positive timestamp would silently zero-fill the start
        // of an aligned preview. Require the decoder timeline to start at zero.
        if (!observedFrames && begin!==0)
          throw new Error('MP3 decoder omitted initial audio frames.');
        if (observedFrames && begin<lastEnd)
          throw new Error('Overlapping or out-of-order MP3 decoded timestamps.');
        if (observedFrames && begin>lastEnd)
          throw new Error('Gap in MP3 decoded timestamps.');
        observedFrames++;lastEnd=begin+length;
        decodedFrames+=length;
        var from=Math.max(start,begin), to=Math.min(end,begin+length);
        if (to>from) {
          var temporary=new Float32Array(length);
          for (var c=0;c<channels.length;c++) {
            audio.copyTo(temporary,{planeIndex:c,format:'f32-planar'});
            channels[c].set(temporary.subarray(from-begin,to-begin),from-start);
          }
        }
      } catch(err) { failure=err; } finally { audio.close(); }
    }
    decoder=new root.AudioDecoder({output:output,error:function(err){failure=err;}});
    var abort=function(){try{decoder.close();}catch(_){}};
    if (signal) signal.addEventListener('abort',abort,{once:true});
    try {
      decoder.configure({codec:'mp3',sampleRate:first.rate,numberOfChannels:first.channels});
      while (offset<bytes.length) {
        active();
        // ID3v1 metadata is a 128-byte trailer, not an MP3 frame.
        if (offset+128===bytes.length && bytes[offset]===84 &&
            bytes[offset+1]===65 && bytes[offset+2]===71) break;
        var h=header(bytes,offset);
        if (!h || h.rate!==first.rate || h.channels!==first.channels ||
            offset+h.size>bytes.length)
          throw new Error('Invalid or changing MP3 frame sequence.');
        // A CRC-protected frame changes the side-information layout. Reject
        // protection changes anywhere, not only in the first frame.
        if (!(bytes[offset+1]&1))
          throw new Error('CRC-protected MP3 frames are not yet supported for aligned preview.');
        var stamp=Math.round(frameNumber*1152*1000000/first.rate);
        // Continue scanning frame headers for timeline duration, but stop
        // feeding decoder after the requested passage and two guard frames.
        if (frameNumber*1152 <= end+2304) {
          decoder.decode(new root.EncodedAudioChunk({type:'key',timestamp:stamp,
            data:bytes.subarray(offset,offset+h.size)}));
          count++;
        }
        frameNumber++;offset+=h.size;
        // Drain the decoder without flush() until the end. Repeated flushes
        // reset MP3 bit-reservoir state and can corrupt inter-frame audio.
        if (count===16) {
          while (decoder.decodeQueueSize>8) {
            active();if(failure)throw failure;
            await new Promise(function(resolve){setTimeout(resolve,0);});
          }
          count=0;
        }
      }
      // Closing AudioDecoder on abort does not guarantee that an outstanding
      // flush promise settles. Race it against the abort signal, and attach
      // both completion handlers so a later decoder rejection is consumed.
      await new Promise(function(resolve,reject) {
        var settled=false;
        function finish(err) {
          if (settled) return;
          settled=true;
          if (signal) signal.removeEventListener('abort',onAbort);
          if (err) reject(err); else resolve();
        }
        function onAbort() { finish(new Error('MP3 decoding cancelled.')); }
        if (signal) {
          if (signal.aborted) { onAbort(); return; }
          signal.addEventListener('abort',onAbort,{once:true});
        }
        try { Promise.resolve(decoder.flush()).then(function(){finish(null);},finish); }
        catch(err) { finish(err); }
      });
      active();if (failure) throw failure;
      if (frameNumber*1152<end) throw new Error('Requested MP3 passage exceeds source duration.');
      if (!observedFrames || lastEnd<end)
        throw new Error('MP3 decoder did not produce the complete requested passage.');
      return {channels:channels,sr:first.rate,originalRate:first.rate,kind:'MP3',
        sourceFrames:frameNumber*1152,passageStartFrame:start};
    } finally {
      if (signal) signal.removeEventListener('abort',abort);
      try {decoder.close();}catch(_){}
    }
  }
  var api={decodePassage:decodePassage,header:header,startOfFrames:startOfFrames};
  if (typeof module!=='undefined' && module.exports) module.exports=api;
  else root.SunoStemMp3=api;
})(typeof self!=='undefined'?self:this);
