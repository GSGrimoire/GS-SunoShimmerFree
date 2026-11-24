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
  // Index every MPEG-1 Layer III frame without decoding audio. The two-byte
  // side-information field records main_data_begin, a backward dependency in
  // bytes. Indexing is cooperative and does not imply a safe decoder seek.
  async function indexFrames(input, signal) {
    var bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    if (bytes.byteLength>64*1048576)
      throw new Error('MP3 compressed source exceeds the 64 MiB scan budget.');
    var offset=startOfFrames(bytes), first=header(bytes,offset);
    if (!first) throw new Error('Unsupported MP3 framing: MPEG-1 Layer III is required.');
    // A Xing/Info first frame may carry encoder delay and end padding.
    // Its nominal frame count cannot establish a gapless sample timeline.
    // Keep offline indexing consistent with decodePassage's fail-closed rule.
    var sideInfo=first.channels===1?17:32;
    var xingAt=offset+4+sideInfo+((bytes[offset+1]&1)?0:2);
    if (xingAt+4<=offset+first.size && xingAt+4<=bytes.length) {
      var marker=String.fromCharCode.apply(null,bytes.subarray(xingAt,xingAt+4));
      if (marker==='Xing' || marker==='Info')
        throw new Error('MP3 Xing/Info encoder timing metadata is not supported for frame-exact indexing.');
    }
    var entries=[], maxFrames=131072;
    while(offset<bytes.length) {
      if (signal && signal.aborted) throw new Error('MP3 indexing cancelled.');
      if(entries.length>=maxFrames) throw new Error('MP3 source exceeds the bounded frame-scan budget.');
      if(entries.length && entries.length%256===0) {
        await new Promise(function(resolve){setTimeout(resolve,0);});
        if (signal && signal.aborted) throw new Error('MP3 indexing cancelled.');
      }
      if(offset+128===bytes.length && bytes[offset]===84 &&
         bytes[offset+1]===65 && bytes[offset+2]===71) break;
      var h=header(bytes,offset);
      if(!h || h.rate!==first.rate || h.channels!==first.channels ||
         offset+h.size>bytes.length)
        throw new Error('Invalid or changing MP3 frame sequence.');
      if(!(bytes[offset+1]&1))
        throw new Error('CRC-protected MP3 frames are not supported for indexed preview.');
      var side=h.channels===1?17:32;
      if(h.size<4+side) throw new Error('Truncated MP3 side information.');
      var back=(bytes[offset+4]<<1)|(bytes[offset+5]>>7);
      var payload=h.size-4-side;
      // Reservoir data cannot refer to bytes preceding the start of audio.
      var available=0;
      for(var j=entries.length-1;j>=0 && available<back;j--)
        available+=entries[j].payload;
      if(back>available)
        throw new Error('MP3 frame references unavailable bit-reservoir bytes.');
      entries.push({offset:offset,size:h.size,mainDataBegin:back,payload:payload,
        sampleStart:entries.length*1152});
      offset+=h.size;
    }
    if(!entries.length) throw new Error('Empty MP3 frame index.');
    return {rate:first.rate,channels:first.channels,frames:entries,
      sourceFrames:entries.length*1152};
  }
  // Plan an indexed seek from the earliest reservoir dependency of the
  // decoder state frame AND every kept/guard frame. Checking only keep-1
  // misses a large backward reference on the first audible frame.
  // Additional two-frame warm-up covers synthesis overlap; it does not
  // replace dependency validation. The decode admission cap fails closed.
  var SEEK_MARGIN_FRAMES=2, GUARD_FRAMES=2, MAX_SEEK_FEED_FRAMES=4096;
  function planSeek(index, startFrame, endFrame) {
    var frames=index.frames;
    if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) ||
        startFrame<0 || endFrame<=startFrame)
      throw new Error('MP3 seek requires a valid sample-frame interval.');
    if (endFrame>index.sourceFrames || startFrame>=index.sourceFrames) {
      var outside=new Error('Requested MP3 passage exceeds source duration.');
      outside.code='PASSAGE_OUT_OF_RANGE';
      outside.sourceSeconds=index.sourceFrames/index.rate;
      throw outside;
    }
    var keep=Math.floor(startFrame/1152), state=Math.max(0,keep-1);
    var last=Math.min(frames.length-1,Math.floor((endFrame-1)/1152)+GUARD_FRAMES);
    var earliest=state;
    for (var n=state;n<=last;n++) {
      var back=frames[n].mainDataBegin, cursor=n;
      if (!Number.isSafeInteger(back) || back<0)
        throw new Error('Invalid MP3 reservoir dependency.');
      while (back>0) {
        if (cursor===0) throw new Error('MP3 frame references unavailable bit-reservoir bytes.');
        cursor--;
        var payload=frames[cursor].payload;
        if (!Number.isSafeInteger(payload) || payload<=0)
          throw new Error('Invalid MP3 reservoir payload.');
        back-=payload;
      }
      if (cursor<earliest) earliest=cursor;
    }
    var feed=Math.max(0,earliest-SEEK_MARGIN_FRAMES);
    if (last-feed+1>MAX_SEEK_FEED_FRAMES)
      throw new Error('MP3 indexed passage exceeds the bounded decode budget.');
    return {feedStart:feed,keepFrame:keep,lastFrame:last,preRollFrames:keep-feed};
  }
  function ensureDecoder() {
    if (!root.AudioDecoder || !root.EncodedAudioChunk)
      throw new Error('Bounded MP3 preview requires browser WebCodecs AudioDecoder support.');
  }
  function ensureActive(signal) {
    // A previously cancelled request must not inspect an entire compressed source.
    if (signal && signal.aborted) throw new Error('MP3 decoding cancelled.');
  }
  function boundedBytes(input) {
    var bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    // A bounded output does not bound the cost of scanning a compressed source.
    // This cap applies to the already-extracted input, not ZIP extraction memory.
    if (bytes.byteLength>64*1048576)
      throw new Error('MP3 compressed source exceeds the 64 MiB scan budget.');
    return bytes;
  }
  function checkPassage(start, end, channelCount) {
    var frames=end-start, totalBytes=frames*channelCount*4;
    // Huge finite second values can round beyond precise sample-frame integers.
    if (Number.isSafeInteger(frames) && frames<1) {
      var short=new Error('MP3 passage sample-frame boundaries are invalid or unsafe.');
      short.code='PASSAGE_TOO_SHORT'; throw short;
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start<0 ||
        !Number.isSafeInteger(frames) || frames<1)
      throw new Error('MP3 passage sample-frame boundaries are invalid or unsafe.');
    if (!Number.isSafeInteger(totalBytes) || totalBytes>96*1048576)
      throw new Error('MP3 passage exceeds the 96 MiB decoded output budget.');
    return frames;
  }
  async function probeDecoder(first, signal) {
    // Browser implementations differ. A constructor existing does not prove
    // MPEG-1 Layer III support; reject unsupported configurations before
    // allocating output planes or feeding compressed user media.
    if (typeof root.AudioDecoder.isConfigSupported !== 'function')
      throw new Error('Browser cannot verify WebCodecs MP3 decoder support.');
    var config={codec:'mp3',sampleRate:first.rate,numberOfChannels:first.channels};
    // A browser codec probe may never settle. Cancellation must release the
    // caller even before a decoder has been constructed.
    var support=await new Promise(function(resolve,reject) {
      var settled=false;
      function finish(err,value) {
        if (settled) return;
        settled=true;
        if (signal) signal.removeEventListener('abort',onAbort);
        if (err) reject(err); else resolve(value);
      }
      function onAbort() { finish(new Error('MP3 decoding cancelled.')); }
      if (signal) {
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort',onAbort,{once:true});
      }
      try { Promise.resolve(root.AudioDecoder.isConfigSupported(config)).then(
        function(value){finish(null,value);},function(err){finish(err);}); }
      catch(err) { finish(err); }
    });
    if (!support || support.supported !== true)
      throw new Error('Browser WebCodecs MP3 decoder configuration is unsupported.');
    ensureActive(signal);
    return config;
  }
  async function decodePassage(input, startSeconds, endSeconds, signal) {
    ensureDecoder();
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) ||
        startSeconds<0 || endSeconds<=startSeconds)
      throw new Error('Bounded MP3 preview requires a finite start and end time.');
    ensureActive(signal);
    var bytes=boundedBytes(input);
    var first=header(bytes,startOfFrames(bytes));
    if (!first) throw new Error('Unsupported MP3 framing: MPEG-1 Layer III is required.');
    var start=Math.round(startSeconds*first.rate), end=Math.round(endSeconds*first.rate);
    var frames=checkPassage(start,end,first.channels);
    // Validate the complete framing before probing or constructing a decoder.
    var index;
    try { index=await indexFrames(bytes,signal); }
    catch (err) { ensureActive(signal); throw err; }
    ensureActive(signal);
    var plan=planSeek(index,start,end);
    var config=await probeDecoder(first,signal);
    return decodeIndexed(bytes,index,start,end,frames,plan,config,signal);
  }
  // Retain one validated compressed source and its private frame index for a
  // sequential scan. Transfer the ZIP reader's private ArrayBuffer when the
  // caller explicitly gives it up; otherwise snapshot it before indexing.
  async function openSource(input, signal, options) {
    ensureDecoder();
    ensureActive(signal);
    if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer))
      throw new TypeError('MP3 overview source must contain an ArrayBuffer or Uint8Array.');
    var view=boundedBytes(input), bytes;
    if (options && options.takeOwnership && input instanceof ArrayBuffer &&
        typeof input.transfer==='function')
      bytes=new Uint8Array(input.transfer());
    else if (options && options.takeOwnership && input instanceof ArrayBuffer &&
        typeof root.structuredClone==='function')
      bytes=new Uint8Array(root.structuredClone(input,{transfer:[input]}));
    else bytes=new Uint8Array(view);
    var index;
    try { index=await indexFrames(bytes,signal); }
    catch (err) { ensureActive(signal); throw err; }
    ensureActive(signal);
    var config=await probeDecoder(index,signal), busy=false;
    return Object.freeze({sampleRate:index.rate,frameCount:index.sourceFrames,
      channelCount:index.channels,decode:async function(start,end,decodeSignal) {
        ensureActive(decodeSignal);
        if (busy) throw new Error('MP3 source is already decoding a passage.');
        var frames=checkPassage(start,end,index.channels), plan=planSeek(index,start,end);
        busy=true;
        try { return await decodeIndexed(bytes,index,start,end,frames,plan,config,decodeSignal); }
        finally { busy=false; }
      }});
  }
  async function decodeIndexed(bytes,index,start,end,frames,plan,config,signal) {
    ensureActive(signal);
    var first=index;
    var channels=Array.from({length:first.channels},function(){return new Float32Array(frames);});
    var decoder, failure=null, count=0;
    var firstAllowed=plan.feedStart*1152, latestFirst=plan.keepFrame*1152;
    var observedFrames=0, lastEnd=0;
    function active() { if (signal && signal.aborted) throw new Error('MP3 decoding cancelled.'); }
    function output(audio) {
      try {
        active();
        if (audio.sampleRate!==first.rate || audio.numberOfChannels!==first.channels)
          throw new Error('MP3 decoder changed rate or channel layout.');
        var begin=Math.round(audio.timestamp*first.rate/1000000), length=audio.numberOfFrames;
        if (!Number.isSafeInteger(begin) || begin<0 || !Number.isSafeInteger(length) || length<1)
          throw new Error('Invalid decoded MP3 timestamp or frame length.');
        // A single decoder callback must not allocate an arbitrarily large
        // temporary plane, even when the requested passage is small.
        if (length>1152*32)
          throw new Error('MP3 decoded audio chunk exceeds the bounded callback budget.');
        // Output must begin inside the discarded pre-roll, never after the
        // first kept frame. Otherwise the start of the passage would be a
        // silent zero-filled gap that only looks aligned.
        if (!observedFrames && (begin<firstAllowed || begin>latestFirst))
          throw new Error('MP3 decoder omitted initial audio frames.');
        if (observedFrames && begin<lastEnd)
          throw new Error('Overlapping or out-of-order MP3 decoded timestamps.');
        if (observedFrames && begin>lastEnd)
          throw new Error('Gap in MP3 decoded timestamps.');
        observedFrames++;lastEnd=begin+length;
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
      decoder.configure(config);
      for (var n=plan.feedStart;n<=plan.lastFrame;n++) {
        active();if(failure)throw failure;
        var f=index.frames[n];
        // Timestamps are absolute source positions, so a late passage keeps
        // its place on the shared stem timeline.
        decoder.decode(new root.EncodedAudioChunk({type:'key',
          timestamp:Math.round(n*1152*1000000/first.rate),
          data:bytes.subarray(f.offset,f.offset+f.size)}));
        count++;
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
      if (!observedFrames || lastEnd<end)
        throw new Error('MP3 decoder did not produce the complete requested passage.');
      // timeline: positions are on the raw decoder-output timeline from the
      // first MP3 frame. Encoder delay and the decoder's own delay are NOT
      // removed; every MP3 stem uses this same timeline, and mixing MP3 with
      // WAV stems stays blocked in the workspace.
      return {channels:channels,sr:first.rate,originalRate:first.rate,kind:'MP3',
        sourceFrames:index.sourceFrames,passageStartFrame:start,
        timeline:'mp3-decoder-output',preRollFrames:plan.preRollFrames};
    } finally {
      if (signal) signal.removeEventListener('abort',abort);
      try {decoder.close();}catch(_){}
    }
  }
  var api={decodePassage:decodePassage,openSource:openSource,indexFrames:indexFrames,planSeek:planSeek,header:header,startOfFrames:startOfFrames};
  if (typeof module!=='undefined' && module.exports) module.exports=api;
  else root.SunoStemMp3=api;
})(typeof self!=='undefined'?self:this);
