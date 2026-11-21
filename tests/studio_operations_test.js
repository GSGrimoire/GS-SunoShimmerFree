import test from 'node:test';
import assert from 'node:assert/strict';
import {createOperationHistory,appendOperation,moveHistoryCursor,activeOperations} from '../studio-operations.js';
const base=()=>createOperationHistory({trackIds:Array.from({length:10},(_,i)=>'stem'+i),durationFrames:480*48000});
const op=(gain=0.5)=>({type:'gain',trackId:'stem0',startFrame:100,endFrame:200,gain});
test('source input and earlier history stay immutable',()=>{
 const a=base(), input=op(), b=appendOperation(a,input); input.gain=3;
 assert.equal(a.operations.length,0); assert.equal(b.operations[0].gain,0.5);
 assert.ok(Object.isFrozen(b.operations[0])); assert.throws(()=>{b.operations[0].gain=2},TypeError);
});
test('undo redo and divergent edit drop redo tail',()=>{
 const a=appendOperation(appendOperation(base(),op()),{type:'mute',trackId:'stem1',startFrame:200,endFrame:300});
 const undo=moveHistoryCursor(a,1); assert.equal(activeOperations(undo).length,1);
 assert.equal(activeOperations(moveHistoryCursor(undo,2)).length,2);
 const fork=appendOperation(undo,op(0.8)); assert.equal(fork.operations.length,2);
 assert.equal(fork.operations[1].gain,0.8); assert.equal(a.operations[1].type,'mute');
});
test('invalid gains, frames, intervals fail closed',()=>{
 for(const gain of [NaN,Infinity,-1,4.01]) assert.throws(()=>appendOperation(base(),op(gain)));
 for(const startFrame of [2**53,1.5,-1]) assert.throws(()=>appendOperation(base(),{...op(),startFrame}));
 assert.throws(()=>appendOperation(base(),{...op(),endFrame:23040001}));
 assert.throws(()=>appendOperation(base(),{...op(),endFrame:100}));
});
test('reject unknown track, destructive operation, mute gain override',()=>{
 assert.throws(()=>appendOperation(base(),{...op(),trackId:'unknown'}));
 assert.throws(()=>appendOperation(base(),{...op(),type:'delete'}));
 assert.throws(()=>appendOperation(base(),{...op(),type:'mute',gain:1}));
 assert.equal(appendOperation(base(),{type:'mute',trackId:'stem0',startFrame:0,endFrame:1}).operations[0].gain,0);
});
test('invalid history and cursor reject',()=>{
 assert.throws(()=>createOperationHistory({trackIds:['x','x'],durationFrames:1}));
 assert.throws(()=>createOperationHistory({trackIds:['x'],durationFrames:Infinity}));
 assert.throws(()=>moveHistoryCursor(base(),1));
 assert.throws(()=>appendOperation({...base(),cursor:1},op()));
});
test('eight-minute ten-stem final frame is exact',()=>{
 const b=appendOperation(base(),{type:'mute',trackId:'stem9',startFrame:23039999,endFrame:23040000});
 assert.equal(activeOperations(b)[0].endFrame,23040000);
});

function frozenHistory(operation, { trackIds = ['stem0'], durationFrames = 10, cursor = 1 } = {}) {
 const ops = Object.freeze([Object.freeze(operation)]);
 return Object.freeze({ schemaVersion: 1, trackIds: Object.freeze(trackIds), durationFrames, operations: ops, cursor });
}
function goodOperation() {
 return {type:'gain',trackId:'stem0',startFrame:0,endFrame:5,gain:0.7};
}
function rejectsAtEveryEntryPoint(h, label) {
 assert.throws(()=>activeOperations(h), /history/, label+' active');
 assert.throws(()=>moveHistoryCursor(h,0), /history/, label+' cursor');
 assert.throws(()=>appendOperation(h,goodOperation()), /history/, label+' append');
}
test('frozen but forged destructive edit history is rejected at every entry point',()=>{
 const malformed=frozenHistory({type:'delete',trackId:'stem0',startFrame:0,endFrame:1,gain:Infinity});
 rejectsAtEveryEntryPoint(malformed,'reviewer reproduction');
});
test('malformed frozen operations fail closed, including values outside valid ranges',()=>{
 const mutations=[
  ['unknown type',{type:'delete'}],
  ['unknown track',{trackId:'foreign'}],
  ['negative frame',{startFrame:-1}],
  ['fractional frame',{startFrame:0.5}],
  ['unsafe frame',{startFrame:Number.MAX_SAFE_INTEGER+1}],
  ['reversed interval',{startFrame:5,endFrame:1}],
  ['empty interval',{endFrame:0}],
  ['beyond duration',{endFrame:11}],
  ['nonfinite end',{endFrame:Infinity}],
  ['infinite gain',{gain:Infinity}],
  ['NaN gain',{gain:NaN}],
  ['negative gain',{gain:-1}],
  ['excess gain',{gain:4.01}],
  ['noncanonical mute',{type:'mute',gain:1}],
  ['extra destructive property',{action:'delete-all'}],
 ];
 for(const [label,change] of mutations) {
   const h=frozenHistory({...goodOperation(),...change});
   rejectsAtEveryEntryPoint(h,label);
 }
 const omitted=goodOperation(); delete omitted.gain;
 rejectsAtEveryEntryPoint(frozenHistory(omitted),'missing gain');
});
test('frozen but forged track registry or sparse history is rejected',()=>{
 const malformedRegistries=[
  ['missing track', ['']],
  ['nonstring',[null]],
  ['too long',['x'.repeat(129)]],
  ['duplicate',['stem0','stem0']],
  ['sparse',new Array(1)],
 ];
 for(const [label,ids] of malformedRegistries){
   rejectsAtEveryEntryPoint(frozenHistory(goodOperation(),{trackIds:ids}),label);
 }
 const ops=Object.freeze(new Array(1));
 const sparse=Object.freeze({schemaVersion:1,trackIds:Object.freeze(['stem0']),durationFrames:10,operations:ops,cursor:1});
 rejectsAtEveryEntryPoint(sparse,'sparse operations');
});
test('frozen accessor operation is rejected without invoking the accessor',()=>{
 let getterCalls=0;
 const op=goodOperation();
 Object.defineProperty(op,'gain',{configurable:true,enumerable:true,get(){
   getterCalls++; throw Error('Hostile getter called');
 }});
 const malformed=frozenHistory(op);
 rejectsAtEveryEntryPoint(malformed,'accessor value');
 assert.equal(getterCalls,0,'validation should reject accessors, not run them');
});
test('canonical rehydrated frozen history remains usable',()=>{
 const restored=frozenHistory(goodOperation());
 assert.deepEqual(activeOperations(restored).map(o=>o.gain),[0.7]);
 assert.equal(moveHistoryCursor(restored,0).cursor,0);
 const revised=appendOperation(restored,{type:'mute',trackId:'stem0',startFrame:5,endFrame:10});
 assert.equal(revised.operations.length,2);
 assert.equal(revised.operations[1].gain,0);
 assert.equal(activeOperations(revised).length,2);
});
