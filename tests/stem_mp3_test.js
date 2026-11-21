'use strict';
const assert=require('node:assert/strict');
const Decoder=require('../stem-mp3.js');
const frameSize=Math.floor(144000*128/44100);
function frame() {
  const f=new Uint8Array(frameSize);f.set([255,251,144,0]);return f;
}
const one=frame();
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
  const priorDecoder=global.AudioDecoder,priorChunk=global.EncodedAudioChunk;
  global.AudioDecoder=FakeDecoder;global.EncodedAudioChunk=FakeChunk;
  // The module's root is Node global in this CommonJS environment.
  try {
    const out=await Decoder.decodePassage(bytes,1152/44100,3*1152/44100);
    assert.equal(out.channels[0].length,2304);
    assert.equal(out.passageStartFrame,1152);
    assert.equal(out.sourceFrames,40*1152);
    assert.equal(out.channels[0][0],.25);
    assert.equal(out.channels[1][2303],-.125);
    assert.equal(FakeDecoder.instances.at(-1).flushes,1,'MP3 reservoir must not be reset every 16 frames');
    assert(FakeDecoder.instances.at(-1).closed,'decoder must close');
  } finally {global.AudioDecoder=priorDecoder;global.EncodedAudioChunk=priorChunk;}
  console.log('Synthetic decoder timestamp and single-flush tests passed; real WebCodecs remains unverified.');
})().catch(e=>{console.error(e);process.exitCode=1;});
