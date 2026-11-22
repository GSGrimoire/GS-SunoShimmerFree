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
(async()=>{
  await assert.rejects(Decoder.decodePassage(bytes,0,0.2),/WebCodecs/);
  await assert.rejects(Decoder.decodePassage(bytes,0,200),/WebCodecs/);
  assert.equal(Decoder.header(new Uint8Array([0,0,0,0]),0),null);
  console.log('MP3 framing and unsupported-browser tests passed. WebCodecs browser decode not simulated.');
})().catch(e=>{console.error(e);process.exitCode=1;});

class FakeChunk { constructor(options){Object.assign(this,options);} }
class FakeDecoder {
  static instances=[];
  constructor(callbacks){this.callbacks=callbacks;this.pending=[];this.decodeQueueSize=0;this.flushes=0;this.closed=false;FakeDecoder.instances.push(this);}
  configure(options){this.config=options;}
  decode(chunk){this.pending.push(chunk);}
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
(async()=>{
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
  console.log('Synthetic decoder timestamp and single-flush tests passed; real WebCodecs remains unverified.');
})().catch(e=>{console.error(e);process.exitCode=1;});

{
  const fs=require('node:fs'),path=require('node:path');
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const mp3='<script src="stem-mp3.js"></script>';
  const resample='<script src="stem-resample.js"></script>';
  assert(html.includes(mp3+String.fromCharCode(10)+resample),'script tags must be separated by an actual newline');
  assert(!html.includes(mp3+String.fromCharCode(92)+'n'+resample),'literal escaped newline is invalid');
  assert.equal(html.split(mp3).length-1,1);
  assert.equal(html.split(resample).length-1,1);
}

(async()=>{
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

(async()=>{
  // A hostile decoder must not force a full-duration plane allocation in a
  // small preview, regardless of its reported output frame count.
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
  class OversizedDecoder extends FakeDecoder {
    async flush() {
      this.flushes++;
      this.callbacks.output({
        sampleRate:this.config.sampleRate,
        numberOfChannels:this.config.numberOfChannels,
        numberOfFrames:1152*33,
        timestamp:0,
        copyTo(){throw new Error('oversized copyTo must never be called');},
        close(){this.audioClosed=true;}
      });
    }
  }
  const root={AudioDecoder:OversizedDecoder,EncodedAudioChunk:FakeChunk};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../stem-mp3.js'),'utf8'),
    {self:root,Uint8Array,Float32Array,Array,Number,Math,Promise,setTimeout});
  await assert.rejects(root.SunoStemMp3.decodePassage(bytes,0,.1),
    /bounded callback budget/);
  const instance=OversizedDecoder.instances.at(-1);
  assert(instance.audioClosed,'oversized AudioData must be closed');
  assert(instance.closed,'decoder must close after oversized output');
  console.log('Oversized decoded audio callback rejected before plane copy.');
})().catch(e=>{console.error(e);process.exitCode=1;});
