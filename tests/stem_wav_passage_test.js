'use strict';
const assert=require('node:assert/strict');
const Wav=require('../wav.js');
const sr=48000;
function fixture(seconds=1) {
  const n=sr*seconds, a=new Float32Array(n),b=new Float32Array(n);
  for(let i=0;i<n;i++){a[i]=(i%97)/97;b[i]=-(i%89)/89;}
  return Wav.encodeWav([a,b],sr,32);
}
{
  const bytes=fixture(2),full=Wav.decodeWav(bytes),cut=Wav.decodeWavPassage(bytes,.5,1.5,1048576);
  assert.equal(cut.passageStartFrame,24000);
  assert.equal(cut.sourceFrames,96000);
  assert.equal(cut.channels[0].length,48000);
  for(let c=0;c<2;c++) assert.deepEqual(cut.channels[c],full.channels[c].subarray(24000,72000));
}
{
  // A full eight-minute 48 kHz stereo float source is 176 MiB; the
  // twelve-second late passage is 4.4 MiB and must not decode full length.
  const n=480*sr,buf=new ArrayBuffer(44+n*8),v=new DataView(buf);
  const header=fixture(1);new Uint8Array(buf,0,44).set(new Uint8Array(header,0,44));
  v.setUint32(4,36+n*8,true);v.setUint32(40,n*8,true);
  const result=Wav.decodeWavPassage(buf,462,474,96*1048576);
  assert.equal(result.channels[0].length,12*sr);
  assert.equal(result.sourceFrames,n);
  assert.equal(result.channels[0].byteLength+result.channels[1].byteLength,4608000);
}
for(const [field,value] of [[22,0],[22,20],[34,12],[32,0],[24,0]]) {
  const buf=fixture(),dv=new DataView(buf);dv.setUint16(field,value,true);
  assert.throws(()=>Wav.decodeWavPassage(buf,0,.1,1048576));
}
{
  const buf=fixture(),dv=new DataView(buf);
  dv.setUint32(40,buf.byteLength*4,true);
  assert.throws(()=>Wav.decodeWavPassage(buf,0,.1,1048576),/Truncated/);
  assert.throws(()=>Wav.decodeWavPassage(fixture(),0,1,100),/budget/);
  assert.throws(()=>Wav.decodeWavPassage(fixture(),.1,Infinity,1048576),/boundaries/);
}
console.log('Bounded WAV passage parity, late-window memory and hostile-header tests passed.');
