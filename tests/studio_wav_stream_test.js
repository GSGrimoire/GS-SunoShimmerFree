'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const {header,encodeChunk,writeWav}=require('../studio-wav-stream');
async function* seq(...xs) { for (const x of xs) yield x; }
function chunk(startFrame, samples) {return {startFrame,samples:new Float32Array(samples)};}
test('standard mono RIFF header with exact data sizes',()=>{const h=header(48000,1,3),v=new DataView(h.buffer);assert.equal(Buffer.from(h.slice(0,4)).toString(),'RIFF');assert.equal(v.getUint32(4,true),42);assert.equal(v.getUint32(40,true),6);assert.equal(v.getUint32(28,true),96000);});
test('signed PCM16 exact endpoints and channel ordering',()=>{const x=encodeChunk(new Float32Array([-1,1,0.5,-0.5]),2),v=new DataView(x.buffer);assert.deepEqual([0,1,2,3].map(i=>v.getInt16(i*2,true)),[-32768,32767,16384,-16384]);});
test('rejects NaN, infinity, overrange and invalid chunk size',()=>{for(const x of [NaN,Infinity,-Infinity,1.1])assert.throws(()=>encodeChunk(new Float32Array([x]),1));assert.throws(()=>encodeChunk(new Float32Array(16385),1));assert.throws(()=>encodeChunk(new Float32Array([0,1,0]),2));});
test('rejects WAV classic RIFF overflow and malformed parameters',()=>{assert.throws(()=>header(48000,2,0x40000000));assert.throws(()=>header(0,2,1));assert.throws(()=>header(48000,3,1));});
test('writes bounded chunks sequentially without full mix buffer',async()=>{const writes=[];const r=await writeWav({sampleRate:48000,channels:2,frames:3,chunks:seq(chunk(0,[0,1,1,0]),chunk(2,[-1,-1])),write:async x=>writes.push(new Uint8Array(x))});assert.equal(r.bytes,56);assert.deepEqual(writes.map(x=>x.length),[44,8,4]);});
test('refuses gaps, overlaps and excess data',async()=>{for(const c of [chunk(2,[0]),chunk(0,[0,0])])await assert.rejects(writeWav({sampleRate:48000,channels:1,frames:1,chunks:seq(c),write:async()=>{}}));});
test('refuses missing tail and cancellation',async()=>{await assert.rejects(writeWav({sampleRate:48000,channels:1,frames:2,chunks:seq(chunk(0,[0])),write:async()=>{}}),/incomplete/);const controller=new AbortController();const writes=[];await assert.rejects(writeWav({sampleRate:48000,channels:1,frames:2,chunks:seq(chunk(0,[0]),chunk(1,[0])),write:async x=>{writes.push(x.length);if(writes.length===2)controller.abort();},signal:controller.signal}),/cancelled/);assert.deepEqual(writes,[44,2]);});
test('rejects invalid async input and failed sink',async()=>{await assert.rejects(writeWav({sampleRate:48000,channels:1,frames:1,chunks:[],write:async()=>{}}));await assert.rejects(writeWav({sampleRate:48000,channels:1,frames:1,chunks:seq(chunk(0,[0])),write:async()=>{throw Error('sink failure');}}),/sink failure/);});
