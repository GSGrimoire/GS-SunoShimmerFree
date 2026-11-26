'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mixChunk}=require('../studio-chunk-mix.js');
const stem=(id,arr,extras={})=>({id,samples:new Float32Array(arr),...extras});
test('stereo sum preserves frame and channel alignment',()=>{
 const r=mixChunk([stem('a',[0.1,0.2,0.3,0.4]),stem('b',[0.2,0.1,0.4,0.3])],2,2);
 for(let i=0;i<4;i++)assert.ok(Math.abs(r.samples[i]-[0.3,0.3,0.7,0.7][i])<1e-6);
 assert.equal(r.clippedSamples,0);
});
test('solo and mute precedence',()=>assert.equal(mixChunk([stem('a',[0.5],{solo:true,mute:true}),stem('b',[0.4])],1,1).samples[0],0));
test('unity bypass is bit-identical and input remains unchanged',()=>{
 const src=new Float32Array([0.25,-0.75,0,1]),r=mixChunk([{id:'a',samples:src}],2,2);
 assert.deepEqual(r.samples,src);assert.deepEqual(src,new Float32Array([0.25,-0.75,0,1]));
});
test('clipping is explicit and bounded',()=>{
 const r=mixChunk([stem('a',[0.8,-0.8]),stem('b',[0.8,-0.8])],2,1);
 assert.deepEqual([...r.samples],[1,-1]);assert.equal(r.clippedSamples,2);assert.ok(r.peak>1);
});
test('non-finite samples fail closed',()=>{for(const n of [NaN,Infinity,-Infinity])assert.throws(()=>mixChunk([stem('a',[n])],1,1),/Non-finite/);});
test('invalid IDs, lengths and gains fail closed',()=>{
 assert.throws(()=>mixChunk([stem('a',[0]),stem('a',[0])],1,1),/duplicate/);
 assert.throws(()=>mixChunk([stem('a',[0,0])],1,1),/length/);
 assert.throws(()=>mixChunk([stem('a',[0],{gain:Infinity})],1,1),/gain/);
});
test('chunk and stem limits enforced',()=>{
 assert.throws(()=>mixChunk([stem('a',[0])],16385,1),/frames/);
 assert.throws(()=>mixChunk(Array.from({length:11},(_,i)=>stem(String(i),[0])),1,1),/stem count/);
});
test('maximum chunk allocates only output Float32 array',()=>{
 const stems=Array.from({length:10},(_,i)=>({id:String(i),samples:new Float32Array(16384*2)}));
 const r=mixChunk(stems,16384,2);assert.equal(r.samples.byteLength,131072);assert.equal(r.peak,0);
});
test('frozen stem descriptors are never mutated',()=>{
 const s=Object.freeze({id:'a',samples:new Float32Array([0.25])});
 assert.equal(mixChunk([s],1,1).samples[0],0.25);
});
