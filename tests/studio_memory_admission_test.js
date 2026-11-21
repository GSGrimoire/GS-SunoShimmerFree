import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryAdmission, decodedPcmBytes } from '../studio-memory-admission.js';

test('ten stereo stems fit only within explicit budget', () => {
  const m = createMemoryAdmission({limitBytes: 80, maxReservations:10});
  const r = Array.from({length:10},(_,i)=>m.reserve(`stem-${i}`,8));
  assert.equal(m.snapshot().usedBytes,80);
  assert.throws(()=>m.reserve('eleventh',1),/budget exceeded/);
  assert.equal(r[0].release(),true);
  assert.equal(r[0].release(),false);
  assert.equal(m.snapshot().usedBytes,72);
});
test('overbudget and duplicate reservations do not change accounting',()=>{
  const m=createMemoryAdmission({limitBytes:100});m.reserve('a',60);
  assert.throws(()=>m.reserve('a',10),/Duplicate/);
  assert.throws(()=>m.reserve('b',41),/budget/);
  assert.deepEqual([m.snapshot().usedBytes,m.snapshot().count],[60,1]);
});
test('stale worker releases cannot free a new generation',()=>{
  const m=createMemoryAdmission({limitBytes:100});const old=m.reserve('same',80);const generation=m.reset();
  m.reserve('same',60,generation);
  assert.equal(old.release(),false);
  assert.equal(m.snapshot().usedBytes,60);
  assert.throws(()=>m.reserve('late',1,generation-1),/Stale/);
});
test('rejects invalid and overflow dimensions',()=>{
  assert.equal(decodedPcmBytes({frames:48000,channels:2}),384000);
  assert.throws(()=>decodedPcmBytes({frames:Number.MAX_SAFE_INTEGER,channels:10}),/overflow/);
  for(const frames of [0,-1,1.2,Infinity,NaN]) assert.throws(()=>decodedPcmBytes({frames,channels:2}));
});
test('eight minute ten-stem Float32 full decode exceeds 96 MiB',()=>{
  const perStem=decodedPcmBytes({frames:480*48000,channels:2});
  assert.equal(perStem,184320000);
  const m=createMemoryAdmission({limitBytes:96*1024*1024});
  assert.throws(()=>m.reserve('full-stem',perStem),/budget/);
  assert.equal(m.snapshot().usedBytes,0);
});
test('invalid reservation parameters and caps fail closed',()=>{
  assert.throws(()=>createMemoryAdmission({limitBytes:0}));
  const m=createMemoryAdmission({limitBytes:10,maxReservations:1});
  for(const id of ['',{},'a'.repeat(129)]) assert.throws(()=>m.reserve(id,1));
  for(const bytes of [0,-1,NaN,Infinity,1.5]) assert.throws(()=>m.reserve('a',bytes));
  assert.equal(m.snapshot().count,0);
});
