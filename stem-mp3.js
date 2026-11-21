/* Experimental bounded-output MP3 decoder using browser WebCodecs.
 * Input is already-extracted compressed MP3 bytes. This is NOT bounded ZIP
 * extraction or a complete streaming export implementation.
 */
(function(root) {
  'use strict';
  function header(bytes, i) {
    if (i+4>bytes.length || bytes[i]!==255 || (bytes[i+1]&254)!==250) return null;
    var rateIndex=(bytes[i+2]>>2)&3, bitrateIndex=(bytes[i+2]>>4)&15;
    if (rateIndex===3 || !bitrateIndex || bitrateIndex===15) return null;
    var rates=[44100,48000,32000], kbps=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320];
    var rate=rates[rateIndex], size=Math.floor(144000*kbps[bitrateIndex]/rate)+((bytes[i+2]>>1)&1);
    return {rate:rate,size:size,channels:(bytes[i+3]&192)===192?1:2};
  }
  function startOfFrames(bytes) {
    if (bytes.length>=10 && bytes[0]===73 && bytes[1]===68 && bytes[2]===51) {
      var size=((bytes[6]&127)<<21)|((bytes[7]&127)<<14)|((bytes[8]&127)<<7)|(bytes[9]&127);
      return 10+size+((bytes[5]&16)?10:0);
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
    var start=Math.round(startSeconds*first.rate), end=Math.round(endSeconds*first.rate);
    var frames=end-start, totalBytes=frames*first.channels*4;
    if (!Number.isSafeInteger(totalBytes) || totalBytes>96*1048576)
      throw new Error('MP3 passage exceeds the 96 MiB decoded output budget.');
    var channels=Array.from({length:first.channels},function(){return new Float32Array(frames);});
    var decoder, failure=null, sampleOffset=0, frameNumber=0, count=0;
    function active() { if (signal && signal.aborted) throw new Error('MP3 decoding cancelled.'); }
    function output(audio) {
      try {
        active();
        if (audio.sampleRate!==first.rate || audio.numberOfChannels!==first.channels)
          throw new Error('MP3 decoder changed rate or channel layout.');
        var begin=Math.round(audio.timestamp*first.rate/1000000), length=audio.numberOfFrames;
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
        var stamp=Math.round(frameNumber*1152*1000000/first.rate);
        // Continue scanning frame headers for timeline duration, but stop
        // feeding decoder after the requested passage and two guard frames.
        if (frameNumber*1152 <= end+2304) {
          decoder.decode(new root.EncodedAudioChunk({type:'key',timestamp:stamp,
            data:bytes.subarray(offset,offset+h.size)}));
          count++;
        }
        frameNumber++;offset+=h.size;
        if (count===16) {
          await decoder.flush();count=0;
          if (failure) throw failure;
        }
      }
      if (count) await decoder.flush();
      active();if (failure) throw failure;
      if (frameNumber*1152<end) throw new Error('Requested MP3 passage exceeds source duration.');
      return {channels:channels,sr:first.rate,originalRate:first.rate,kind:'MP3',\n        sourceFrames:frameNumber*1152,passageStartFrame:start};
    } finally {
      if (signal) signal.removeEventListener('abort',abort);
      try {decoder.close();}catch(_){}
    }
  }
  var api={decodePassage:decodePassage,header:header,startOfFrames:startOfFrames};
  if (typeof module!=='undefined' && module.exports) module.exports=api;
  else root.SunoStemMp3=api;
})(typeof self!=='undefined'?self:this);
