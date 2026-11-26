import test from 'node:test';
import assert from 'node:assert/strict';
import {panChunk} from '../studio-pan.js';
test('center is bit-exact bypass, preserving inputs',()=>{const l=Float32Array.of(.25,-.5),r=Float32Array.of(.75,-.25);const o=panChunk(l,r,0);assert.deepEqual([...o.left],[...l]);assert.deepEqual([...o.right],[...r]);assert.notEqual(o.left,l)});
test('hard left and right mute only opposing channel',()=>{const a=Float32Array.of(1);assert.equal(panChunk(a,a,-1).right[0],0);assert.equal(panChunk(a,a,1).left[0],0);assert.equal(panChunk(a,a,-1).left[0],1)});
test('balanced stereo does not crossfeed channels',()=>{const a=panChunk(Float32Array.of(1),Float32Array.of(0),.5);assert.equal(a.right[0],0);assert.ok(a.left[0]>.7&&a.left[0]<.71)});
test('rejects nonfinite and invalid pan',()=>{for(const p of [NaN,Infinity,-1.01,1.01])assert.throws(()=>panChunk(Float32Array.of(0),Float32Array.of(0),p));assert.throws(()=>panChunk(Float32Array.of(NaN),Float32Array.of(0),0))});
test('rejects mismatched or oversized chunks and non-PCM',()=>{assert.throws(()=>panChunk(Float32Array.of(1),Float32Array.of(),0));assert.throws(()=>panChunk(new Float32Array(16385),new Float32Array(16385),0));assert.throws(()=>panChunk([1],[1],0))});
test('separate chunks equal contiguous processing',()=>{const l=Float32Array.from({length:100},(_,i)=>Math.sin(i)),r=Float32Array.from({length:100},(_,i)=>Math.cos(i));const all=panChunk(l,r,-.25),a=panChunk(l.slice(0,43),r.slice(0,43),-.25),b=panChunk(l.slice(43),r.slice(43),-.25);assert.deepEqual([...all.left],[...a.left,...b.left]);assert.deepEqual([...all.right],[...a.right,...b.right])});
