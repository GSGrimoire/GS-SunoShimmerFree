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
