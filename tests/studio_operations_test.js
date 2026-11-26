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
