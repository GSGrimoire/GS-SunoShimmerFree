'use strict';
const assert=require('node:assert/strict');
const codec=require('../wav.js');
globalThis.WavCodec=codec;
const stream=require('../stem-wav-stream.js');
(async()=>{
  const chunks=[];let closed=false,aborted=false;
  const sink={async write(b){chunks.push(new Uint8Array(b));},async close(){closed=true;},
    async abort(){aborted=true;}};
  await stream.write({rate:48000,startFrame:100,endFrame:111,bits:16,chunkFrames:4,codec:codec,
    writable:sink,getChunk:async(pos,n)=>[
      Float32Array.from({length:n},(_,i)=>(pos+i)/1000),
      Float32Array.from({length:n},(_,i)=>-(pos+i)/1000)]});
  assert(closed&&!aborted);assert.equal(chunks.length,4);
  const bytes=Buffer.concat(chunks.map(b=>Buffer.from(b)));
  assert.equal(bytes.length,44+11*4);
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  assert.equal(view.getUint32(4,true),36+44);
  assert.equal(view.getUint32(40,true),44);
  const decoded=codec.decodeWav(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  assert.equal(decoded.channels[0].length,11);
  assert(Math.abs(decoded.channels[0][0]-.1)<.0001);
  assert(Math.abs(decoded.channels[1][10]+.11)<.0001);
  const failed={async write(){},async close(){throw Error('must not close');},async abort(){aborted=true;}};
  aborted=false;
  await assert.rejects(stream.write({rate:48000,startFrame:0,endFrame:10,bits:24,
    chunkFrames:5,writable:failed,codec:codec,getChunk:async()=>{throw Error('chunk failed');}}),/chunk failed/);
  assert(aborted,'failed chunk must abort output sink');
  assert.throws(()=>stream.header(48000,0xffffffff,32),/4 GiB/);
  console.log('Streaming WAV tests passed: sample parity, RIFF length, chunks, abort, size cap.');
})().catch(e=>{console.error(e);process.exitCode=1;});
