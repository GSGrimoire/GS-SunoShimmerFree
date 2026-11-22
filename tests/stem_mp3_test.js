(async()=>{
'use strict';
const assert=require('node:assert/strict');
const Decoder=require('../stem-mp3.js');
const frameSize=Math.floor(144000*128/44100);
function frame() {
  const f=new Uint8Array(frameSize);f.set([255,251,144,0]);return f;
}
const one=frame();
// ID3v2 metadata must never be interpreted as frame data or permit an
// out-of-bounds start. A valid synchsafe tag may precede MP3 frames.
const id3=(version,flags,size)=>Uint8Array.from([73,68,51,version,0,flags,
  (size>>>21)&127,(size>>>14)&127,(size>>>7)&127,size&127]);
const taggedValid=new Uint8Array(10+one.length);
taggedValid.set(id3(4,0,0));taggedValid.set(one,10);
assert.equal(Decoder.startOfFrames(taggedValid),10);
const taggedFooter=new Uint8Array(20+one.length);
taggedFooter.set(id3(4,16,0));taggedFooter.set(one,20);
assert.equal(Decoder.startOfFrames(taggedFooter),20);
for (const invalid of [
  Uint8Array.from([73,68,51]),
  id3(4,0,128),
  id3(4,0,0).map((x,i)=>i===6?128:x),
  id3(3,16,0),
  id3(4,1,0),
  id3(1,0,0),
  id3(4,0,500)
]) {
  assert.throws(()=>Decoder.startOfFrames(invalid),/ID3v2/);
}
assert.equal(Decoder.header(one,0).rate,44100);
assert.equal(Decoder.header(one,0).size,frameSize);
assert.equal(Decoder.header(one,0).channels,2);
const frames=Array.from({length:40},frame), bytes=new Uint8Array(frameSize*frames.length);
frames.forEach((f,i)=>bytes.set(f,i*frameSize));
// Frame index must validate reservoir backward references before any seek
// can be considered. Synthetic frames have empty reservoir dependencies.
{
  const indexed=await Decoder.indexFrames(bytes);
  assert.equal(indexed.frames.length,40);
  assert.equal(indexed.sourceFrames,40*1152);
  assert.equal(indexed.frames[1].offset,frameSize);
  assert.equal(indexed.frames[1].sampleStart,1152);
  // Offline indexing must not claim exact sample timing when the encoder
  // advertises gapless delay/padding through Xing or Info.
  for (const marker of ['Xing','Info']) {
    const tagged=bytes.slice();
    tagged.set(Buffer.from(marker),36); // MPEG-1 stereo side-info ends at byte 36
    await assert.rejects(Decoder.indexFrames(tagged),/Xing\/Info encoder timing metadata/);
  }
  // Header bytes outside the first frame are not gapless metadata.
  const ordinary=bytes.slice();
  ordinary.set(Buffer.from('Xing'),frameSize+36);
  assert.equal((await Decoder.indexFrames(ordinary)).frames.length,40);
  const invalid=bytes.slice();
  invalid[4]=1; // first frame claims a 2-byte backward dependency
  await assert.rejects(Decoder.indexFrames(invalid),/unavailable bit-reservoir/);
  const later=bytes.slice();
  later[frameSize+4]=255;
  later[frameSize+5]=128; // 511-byte reference exceeds one prior payload
  await assert.rejects(Decoder.indexFrames(later),/unavailable bit-reservoir/);
  const aborted=new AbortController();
  aborted.abort();
  await assert.rejects(Decoder.indexFrames(bytes,aborted.signal),/indexing cancelled/);
  const many=new Uint8Array(frameSize*12000);
  for(let i=0;i<12000;i++) many.set(one,i*frameSize);
  const controller=new AbortController();
  let fired=false;
  const pending=Decoder.indexFrames(many,controller.signal);
  setTimeout(()=>{fired=true;controller.abort();},0);
  await assert.rejects(pending,/indexing cancelled/);
  assert(fired,'index scan must yield to scheduled cancellation');
  console.log('Bounded MP3 frame index, reservoir and cancellation tests passed.');
}
await (async()=>{
  await assert.rejects(Decoder.decodePassage(bytes,0,0.2),/WebCodecs/);
  await assert.rejects(Decoder.decodePassage(bytes,0,200),/WebCodecs/);
  assert.equal(Decoder.header(new Uint8Array([0,0,0,0]),0),null);
  console.log('MP3 framing and unsupported-browser tests passed. WebCodecs browser decode not simulated.');
})().catch(e=>{console.error(e);process.exitCode=1;});

// Finite seconds are not necessarily representable as exact sample frames.
// Reject unsafe or rounded-to-zero intervals before codec probing/allocation.
await (async()=>{
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
  let probes=0,constructed=0;
  class CountingDecoder {
    static async isConfigSupported(){probes++;return {supported:true};}
    constructor(){constructed++;}
  }
  const root={AudioDecoder:CountingDecoder,EncodedAudioChunk:class {}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../stem-mp3.js'),'utf8'),
    {self:root,Uint8Array,Float32Array,Array,Number,Math,Promise,setTimeout});
  for(const [start,end] of [
    [Number.MAX_SAFE_INTEGER/44100+1,Number.MAX_SAFE_INTEGER/44100+2],
    [0,1e-12],
    [1e12,1e12+0.1]
  ]) {
    await assert.rejects(root.SunoStemMp3.decodePassage(bytes,start,end),
      /sample-frame boundaries are invalid or unsafe/);
  }
  assert.equal(probes,0,'invalid frame boundaries must not probe browser codec');
  assert.equal(constructed,0,'invalid frame boundaries must not allocate decoder');
  // A passage beyond the indexed source duration is refused before codec
  // probing or decoder allocation.
  for (const [start,end] of [[462,474],[1e6,1e6+1]]) {
    await assert.rejects(root.SunoStemMp3.decodePassage(bytes,start,end),
      /exceeds source duration/);
  }
  const longFrameCount=Math.ceil(480*44100/1152);
  const longBytes=new Uint8Array(longFrameCount*frameSize);
  for(let i=0;i<longFrameCount;i++) longBytes.set(one,i*frameSize);
  await assert.rejects(root.SunoStemMp3.decodePassage(longBytes,479,481),
    /exceeds source duration/);
  assert.equal(probes,0,'out-of-range passage must not probe codec');
  assert.equal(constructed,0,'out-of-range passage must not construct decoder');
  const aborted=new AbortController();
  aborted.abort();
  await assert.rejects(root.SunoStemMp3.decodePassage(longBytes,0,1,aborted.signal),
    /MP3 decoding cancelled/);
  assert.equal(probes,0,'pre-aborted request must not probe codec');
  assert.equal(constructed,0,'pre-aborted request must not construct decoder');
  console.log('Out-of-range MP3 passages fail closed before decoder allocation.');
  console.log('Unsafe and sub-sample MP3 passage boundaries rejected before codec probing.');
})();

class FakeChunk { constructor(options){Object.assign(this,options);} }
class FakeDecoder {
  static instances=[];
  static async isConfigSupported(config) { return {supported:config.codec==='mp3',config}; }
  constructor(callbacks){this.callbacks=callbacks;this.pending=[];this.decodeQueueSize=0;this.flushes=0;this.closed=false;FakeDecoder.instances.push(this);}
  configure(options){this.config=options;}
  decode(chunk){(this.decoded||(this.decoded=[])).push(chunk);this.pending.push(chunk);}
  async flush(){
    this.flushes++;
    for(const chunk of this.pending) {
      const rate=this.config.sampleRate, begin=Math.round(chunk.timestamp*rate/1000000);
      const audio={sampleRate:rate,numberOfChannels:this.config.numberOfChannels,numberOfFrames:1152,
        timestamp:chunk.timestamp,
        copyTo(out,{planeIndex}){out.fill(planeIndex===0?.25:-.125);},
        close(){}};
      this.callbacks.output(audio);
    }
    this.pending=[];
  }
  close(){this.closed=true;}
}
await (async()=>{
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
  const root={AudioDecoder:FakeDecoder,EncodedAudioChunk:FakeChunk};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../stem-mp3.js'),'utf8'),
    {self:root,Uint8Array,Float32Array,Array,Number,Math,Promise,setTimeout});
  {
    const out=await root.SunoStemMp3.decodePassage(bytes,1152/44100,3*1152/44100);
    assert.equal(out.channels[0].length,2304);
    assert.equal(out.passageStartFrame,1152);
    assert.equal(out.sourceFrames,40*1152);
    assert.equal(out.channels[0][0],.25);
    assert.equal(out.channels[1][2303],-.125);
    assert.equal(FakeDecoder.instances.at(-1).flushes,1,'MP3 reservoir must not be reset every 16 frames');
    assert(FakeDecoder.instances.at(-1).closed,'decoder must close');
    // Late passage: only the passage plus bounded pre-roll and guard frames
    // are fed, with absolute timestamps. Synthetic frames carry no reservoir
    // dependency, so pre-roll is the fixed safety margin (state frame + 2).
    // Fake output cannot validate real MP3 audio; see
    // tests/stem_mp3_ffmpeg_parity_test.js for decoder parity evidence.
    const count=Math.ceil(480*44100/1152);
    const long=new Uint8Array(count*frameSize);
    for(let i=0;i<count;i++) long.set(one,i*frameSize);
    const late=await root.SunoStemMp3.decodePassage(long,462,474);
    const lateDecoder=FakeDecoder.instances.at(-1);
    const s=Math.round(462*44100),e=Math.round(474*44100),k=Math.floor(s/1152);
    assert.equal(late.passageStartFrame,s);
    assert.equal(late.channels[0].length,e-s);
    assert.equal(late.sourceFrames,count*1152);
    assert.equal(late.preRollFrames,3);
    assert.equal(late.timeline,'mp3-decoder-output');
    assert(late.channels[0].every(x=>x===.25),'late passage fully covered');
    assert(late.channels[1].every(x=>x===-.125),'late passage fully covered');
    assert.equal(lateDecoder.decoded.length,Math.floor((e-1)/1152)+2-(k-3)+1,'bounded feed');
    assert.equal(lateDecoder.decoded[0].timestamp,Math.round((k-3)*1152*1000000/44100),
      'first fed frame is the planned pre-roll start, on the absolute timeline');
    assert(lateDecoder.closed,'decoder must close');
    for (const tag of ['Xing','Info']) {
      const tagged=bytes.slice();
      tagged.set(Buffer.from(tag),36); // MPEG-1 stereo: 4-byte header + 32-byte side information
      await assert.rejects(root.SunoStemMp3.decodePassage(tagged,0,.1),/Xing\/Info/);
    }
    const protectedFrame=bytes.slice();protectedFrame[1]&=~1;
    await assert.rejects(root.SunoStemMp3.decodePassage(protectedFrame,0,.1),/CRC-protected/);
    // A later CRC-protected frame must fail even if it falls after the
    // requested preview: the complete source framing is scanned.
    const laterProtected=bytes.slice();
    laterProtected[20*frameSize+1]&=~1;
    await assert.rejects(root.SunoStemMp3.decodePassage(laterProtected,0,.1),/CRC-protected/);
    // Frame after the first, within the decoded window.
    const secondProtected=bytes.slice();
    secondProtected[frameSize+1]&=~1;
    await assert.rejects(root.SunoStemMp3.decodePassage(secondProtected,0,.1),/CRC-protected/);
  }
  // Decoder output beginning after sample zero must not silently produce
  // a zero-filled passage prefix that appears correctly aligned.
  class MissingInitialFrameDecoder extends FakeDecoder {
    decode(chunk) {
      if (this.pending.length===0) {
        chunk={...chunk,timestamp:Math.round(1152*1000000/this.config.sampleRate)};
      }
      super.decode(chunk);
    }
  }
  const shiftedRoot={AudioDecoder:MissingInitialFrameDecoder,EncodedAudioChunk:FakeChunk};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../stem-mp3.js'),'utf8'),
    {self:shiftedRoot,Uint8Array,Float32Array,Array,Number,Math,Promise,setTimeout});
  await assert.rejects(shiftedRoot.SunoStemMp3.decodePassage(bytes,0,.1),/omitted initial audio frames/);
  assert(MissingInitialFrameDecoder.instances.at(-1).closed,'decoder must close on missing initial frames');
  // Late passage: output may begin inside the discarded pre-roll (a decoder
  // can drop a frame whose reservoir was never fed), but never after the
  // first kept frame, which would zero-fill the start of the passage.
  {
    const n=Math.ceil(480*44100/1152), long=new Uint8Array(n*frameSize);
    for(let i=0;i<n;i++) long.set(one,i*frameSize);
    const dropping=(drop)=>class extends FakeDecoder {
      decode(chunk){this.seen=(this.seen||0)+1;if(this.seen>drop)super.decode(chunk);}
    };
    const load=(D)=>{const r={AudioDecoder:D,EncodedAudioChunk:FakeChunk};
      vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../stem-mp3.js'),'utf8'),
        {self:r,Uint8Array,Float32Array,Array,Number,Math,Promise,setTimeout});return r.SunoStemMp3;};
    const ok=await load(dropping(1)).decodePassage(long,462,474);
    assert(ok.channels[0].every(x=>x===.25),'pre-roll drop still covers passage');
    await assert.rejects(load(dropping(4)).decodePassage(long,462,474),/omitted initial audio frames/);
    console.log('Late-passage pre-roll drop accepted; kept-region omission rejected.');
  }
  // A timestamp hole must fail instead of silently padding the output.
  class GappedDecoder extends FakeDecoder {
    decode(chunk) {
      if (this.pending.length===1) {
        chunk={...chunk,timestamp:Math.round(3*1152*1000000/this.config.sampleRate)};
      }
      super.decode(chunk);
    }
  }
  const gapRoot={AudioDecoder:GappedDecoder,EncodedAudioChunk:FakeChunk};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../stem-mp3.js'),'utf8'),
    {self:gapRoot,Uint8Array,Float32Array,Array,Number,Math,Promise,setTimeout});
  await assert.rejects(gapRoot.SunoStemMp3.decodePassage(bytes,0,.1),
    /Gap in MP3 decoded timestamps/);
  assert(GappedDecoder.instances.at(-1).closed,'decoder must close on timestamp gap');
  console.log('Synthetic decoder timestamp and single-flush tests passed; real WebCodecs remains unverified.');
})().catch(e=>{console.error(e);process.exitCode=1;});

{
  // Seek planner: frame k-1 must decode correctly, so its whole bit-reservoir
  // span is fed, plus a two-frame margin. 32 kbit/s 48 kHz frames have a
  // 60-byte payload, so a 511-byte back-reference spans nine frames.
  // As indexFrames guarantees, a frame never references bytes before audio.
  const mk=(n,payload,back)=>({sourceFrames:n*1152,
    frames:Array.from({length:n},(_,i)=>({payload,mainDataBegin:Math.min(back,i*payload)}))});
  const lowRate=mk(1000,60,511);
  const p=Decoder.planSeek(lowRate,500*1152,510*1152);
  assert.equal(p.keepFrame,500);
  assert.equal(p.feedStart,499-9-2,'reservoir of frame k-1 plus margin');
  assert.equal(p.lastFrame,511);
  assert.equal(p.preRollFrames,500-488);
  const none=Decoder.planSeek(mk(1000,400,0),500*1152+7,500*1152+8);
  assert.equal(none.feedStart,499-2);
  // Near the start the plan clamps to frame 0 instead of failing.
  assert.equal(Decoder.planSeek(lowRate,3*1152,4*1152).feedStart,0);
  assert.equal(Decoder.planSeek(lowRate,0,1).feedStart,0);
  // End guard never runs past the last frame.
  assert.equal(Decoder.planSeek(lowRate,999*1152,1000*1152).lastFrame,999);
  // An unresolvable reservoir at a planned seek fails closed.
  const broken={sourceFrames:10*1152,frames:Array.from({length:10},()=>({payload:10,mainDataBegin:511}))};
  assert.throws(()=>Decoder.planSeek(broken,5*1152,6*1152),/unavailable bit-reservoir/);
  assert.throws(()=>Decoder.planSeek(lowRate,999*1152,1000*1152+1),/exceeds source duration/);
  assert.throws(()=>Decoder.planSeek(lowRate,5,5),/valid sample-frame interval/);
  assert.throws(()=>Decoder.planSeek(lowRate,-1,5),/valid sample-frame interval/);
  console.log('Indexed MP3 seek planner reservoir, margin and boundary tests passed.');
}

{
  const fs=require('node:fs'),path=require('node:path');
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const mp3='<script src="stem-mp3.js"></script>';
  const resample='<script src="stem-resample.js"></script>';
  assert(html.includes(mp3+'\n'+resample) || html.includes(mp3+'\r\n'+resample),
    'script tags must be separated by an actual LF or CRLF newline');
  assert(!html.includes(mp3+String.fromCharCode(92)+'n'+resample),'literal escaped newline is invalid');
  assert.equal(html.split(mp3).length-1,1);
  assert.equal(html.split(resample).length-1,1);
}

await (async()=>{
  // Closing a decoder must settle a build even if flush() never resolves.
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
  class NeverFlushDecoder extends FakeDecoder {
    async flush(){this.flushes++;return new Promise(()=>{});}
  }
  const root={AudioDecoder:NeverFlushDecoder,EncodedAudioChunk:FakeChunk};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../stem-mp3.js'),'utf8'),
    {self:root,Uint8Array,Float32Array,Array,Number,Math,Promise,setTimeout});
  const controller=new AbortController();
  const pending=root.SunoStemMp3.decodePassage(bytes,0,.1,controller.signal);
  await Promise.resolve();
  controller.abort();
  await assert.rejects(
    Promise.race([pending,new Promise((_,reject)=>setTimeout(()=>reject(new Error('flush abort timed out')),150))]),
    /MP3 decoding cancelled/);
  const instance=NeverFlushDecoder.instances.at(-1);
  assert(instance.closed,'cancelled decoder must close');
  assert.equal(instance.flushes,1,'test must reach pending flush');
  console.log('Never-settling WebCodecs flush cancellation regression passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});

await (async()=>{
  // A long valid trailer must not monopolize the event loop after the short
  // excerpt has stopped feeding the decoder. A timer must be able to abort.
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
  const root={AudioDecoder:FakeDecoder,EncodedAudioChunk:FakeChunk};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../stem-mp3.js'),'utf8'),
    {self:root,Uint8Array,Float32Array,Array,Number,Math,Promise,setTimeout});
  const trailing=new Uint8Array(frameSize*12000);
  for(let i=0;i<12000;i++) trailing.set(one,i*frameSize);
  const controller=new AbortController();
  let timerFired=false;
  const pending=root.SunoStemMp3.decodePassage(trailing,0,.1,controller.signal);
  setTimeout(()=>{timerFired=true;controller.abort();},0);
  await assert.rejects(pending,/MP3 decoding cancelled/);
  assert(timerFired,'scan must yield so timer-driven abort can fire');
  assert(FakeDecoder.instances.at(-1).closed,'cancelled scan closes decoder');
  // The compressed-source budget must reject before support probing.
  let probed=0;
  class ProbeDecoder extends FakeDecoder {
    static async isConfigSupported(config){probed++;return super.isConfigSupported(config);}
  }
  const limitedRoot={AudioDecoder:ProbeDecoder,EncodedAudioChunk:FakeChunk};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../stem-mp3.js'),'utf8'),
    {self:limitedRoot,Uint8Array,Float32Array,Array,Number,Math,Promise,setTimeout});
  await assert.rejects(limitedRoot.SunoStemMp3.decodePassage(new Uint8Array(64*1048576+1),0,.1),
    /64 MiB scan budget/);
  assert.equal(probed,0,'oversized compressed source must not probe codec');
  console.log('Cooperative trailing scan abort and compressed-source admission passed.');
})();

await (async()=>{
  // A hostile decoder must not force a full-duration plane allocation in a
  // small preview, regardless of its reported output frame count.
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
  const oversizedAudio={closed:false};
  class OversizedDecoder extends FakeDecoder {
    async flush() {
      this.flushes++;
      this.callbacks.output({
        sampleRate:this.config.sampleRate,
        numberOfChannels:this.config.numberOfChannels,
        numberOfFrames:1152*33,
        timestamp:0,
        copyTo(){throw new Error('oversized copyTo must never be called');},
        close(){oversizedAudio.closed=true;}
      });
    }
  }
  const root={AudioDecoder:OversizedDecoder,EncodedAudioChunk:FakeChunk};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../stem-mp3.js'),'utf8'),
    {self:root,Uint8Array,Float32Array,Array,Number,Math,Promise,setTimeout});
  await assert.rejects(root.SunoStemMp3.decodePassage(bytes,0,.1),
    /bounded callback budget/);
  const instance=OversizedDecoder.instances.at(-1);
  assert(oversizedAudio.closed,'oversized AudioData must be closed');
  assert(instance.closed,'decoder must close after oversized output');
  console.log('Oversized decoded audio callback rejected before plane copy.');
})().catch(e=>{console.error(e);process.exitCode=1;});

await (async()=>{
  // A browser exposing AudioDecoder without MP3 support must fail closed.
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
  const load=(decoder)=>{
    const root={AudioDecoder:decoder,EncodedAudioChunk:FakeChunk};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../stem-mp3.js'),'utf8'),
      {self:root,Uint8Array,Float32Array,Array,Number,Math,Promise,setTimeout});
    return root.SunoStemMp3;
  };
  class UnsupportedDecoder extends FakeDecoder {
    static async isConfigSupported(){return {supported:false};}
  }
  const before=FakeDecoder.instances.length;
  await assert.rejects(load(UnsupportedDecoder).decodePassage(bytes,0,.1),/configuration is unsupported/);
  assert.equal(FakeDecoder.instances.length,before,'unsupported codec must not construct decoder');
  class MissingProbeDecoder extends FakeDecoder {}
  MissingProbeDecoder.isConfigSupported=undefined;
  await assert.rejects(load(MissingProbeDecoder).decodePassage(bytes,0,.1),/cannot verify/);
  assert.equal(FakeDecoder.instances.length,before,'missing probe must not construct decoder');
  class ProbeRejectDecoder extends FakeDecoder {
    static async isConfigSupported(){throw new Error('codec probe failed');}
  }
  await assert.rejects(load(ProbeRejectDecoder).decodePassage(bytes,0,.1),/codec probe failed/);
  assert.equal(FakeDecoder.instances.length,before,'failed probe must not construct decoder');
  const ok=await load(FakeDecoder).decodePassage(bytes,0,.1);
  assert.equal(ok.channels[0].length,Math.round(.1*44100));
  console.log('WebCodecs runtime codec support probe regressions passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});

})().catch(err=>{console.error(err);process.exitCode=1;});
