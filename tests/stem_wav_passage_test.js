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

{
  // Declared RIFF boundary, not physical buffer length, governs all chunks.
  const original=fixture(1);
  for(const declared of [4, 36, original.byteLength, 0xFFFFFFFF]) {
    const buf=original.slice(0),dv=new DataView(buf);
    dv.setUint32(4,declared,true);
    assert.throws(()=>Wav.decodeWavPassage(buf,0,.1,1048576),/RIFF|trailing|Truncated/);
  }
  const withSuffix=new Uint8Array(original.byteLength+4);
  withSuffix.set(new Uint8Array(original));
  assert.throws(()=>Wav.decodeWavPassage(withSuffix.buffer,0,.1,1048576),/trailing/);
}
{
  // RIFF can physically contain a chunk whose declared data extends beyond
  // the container; the physical bytes do not authorize the overrun.
  const buf=fixture(1),dv=new DataView(buf);
  dv.setUint32(4,36+4,true);
  assert.throws(()=>Wav.decodeWavPassage(buf,0,.1,1048576),/trailing/);
}
{
  // Valid odd-sized ancillary chunk with a padding byte before fmt.
  const base=fixture(1),bytes=new Uint8Array(base.byteLength+10);
  bytes.set(new Uint8Array(base,0,12),0);
  bytes.set([74,85,78,75,1,0,0,0,42,0],12); // JUNK, one byte + pad
  bytes.set(new Uint8Array(base,12),22);
  const dv=new DataView(bytes.buffer);
  dv.setUint32(4,bytes.byteLength-8,true);
  assert.equal(Wav.decodeWavPassage(bytes.buffer,0,.1,1048576).channels[0].length,4800);
  // Missing the odd pad at the end of a declared RIFF is invalid.
  const malformed=new Uint8Array(21);
  malformed.set([82,73,70,70,13,0,0,0,87,65,86,69,74,85,78,75,1,0,0,0,42]);
  assert.throws(()=>Wav.decodeWavPassage(malformed.buffer,0,.1,1048576),/pad byte/);
}
{
  // WAVE_FORMAT_EXTENSIBLE: check complete subtype GUID, not just its low word.
  const base=fixture(1),bytes=new Uint8Array(base.byteLength+24);
  bytes.set(new Uint8Array(base,0,12));
  bytes.set(new Uint8Array(base,12,36),12);
  bytes.set(new Uint8Array(base,36),60);
  const dv=new DataView(bytes.buffer);
  dv.setUint32(4,bytes.byteLength-8,true);
  dv.setUint32(16,40,true);dv.setUint16(20,65534,true);
  dv.setUint16(36,22,true);dv.setUint16(38,32,true);
  dv.setUint32(44,3,true);
  bytes.set([0,0,16,0,128,0,0,170,0,56,155,113],48);
  assert.equal(Wav.decodeWavPassage(bytes.buffer,0,.1,1048576).channels[0].length,4800);
  // The canonical 40-byte extensible format has exactly 22 extension bytes.
  // Contradictory lengths must not be silently accepted.
  for(const cbSize of [0,21,23,65535]) {
    dv.setUint16(36,cbSize,true);
    assert.throws(()=>Wav.decodeWavPassage(bytes.buffer,0,.1,1048576),/extensible/);
  }
  dv.setUint16(36,22,true);
  bytes[55]^=1;
  assert.throws(()=>Wav.decodeWavPassage(bytes.buffer,0,.1,1048576),/GUID/);
  bytes[55]^=1;dv.setUint32(44,0x10003,true);
  assert.throws(()=>Wav.decodeWavPassage(bytes.buffer,0,.1,1048576),/GUID/);
}

{
  // Both ordinary IEEE float and extensible WAV must reject a contradictory
  // nAvgBytesPerSec before allocating the excerpt. Preserve valid controls.
  const ordinary=fixture(1),ordinaryView=new DataView(ordinary);
  assert.equal(Wav.decodeWavPassage(ordinary,0,.1,1048576).channels[0].length,4800);
  for(const badRate of [0,1,383999,384001,0xFFFFFFFF]) {
    ordinaryView.setUint32(28,badRate,true);
    assert.throws(()=>Wav.decodeWavPassage(ordinary,0,.1,1048576),/unaligned|format/);
  }
  ordinaryView.setUint32(28,384000,true);
  const bytes=new Uint8Array(ordinary.byteLength+24);
  bytes.set(new Uint8Array(ordinary,0,12));
  bytes.set(new Uint8Array(ordinary,12,36),12);
  bytes.set(new Uint8Array(ordinary,36),60);
  const dv=new DataView(bytes.buffer);
  dv.setUint32(4,bytes.byteLength-8,true);
  dv.setUint32(16,40,true);
  dv.setUint16(20,65534,true);
  dv.setUint16(36,22,true);
  dv.setUint16(38,32,true);
  dv.setUint32(44,3,true);
  bytes.set([0,0,16,0,128,0,0,170,0,56,155,113],48);
  assert.equal(Wav.decodeWavPassage(bytes.buffer,0,.1,1048576).channels[0].length,4800);
  dv.setUint32(28,0,true);
  assert.throws(()=>Wav.decodeWavPassage(bytes.buffer,0,.1,1048576),/unaligned|format/);
}

console.log('Bounded WAV passage parity, late-window memory and hostile-header tests passed.');
