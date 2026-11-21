import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimeline, mapTimelineWindow } from '../studio-frame-timeline.js';
const build = tracks => createTimeline({sampleRate:48000,durationFrames:480*48000,tracks});
test('eight minute ten stem alignment maps exact sample frames',()=>{
  const t=build(Array.from({length:10},(_,i)=>({id:`stem${i}`,startFrame:0,sourceStartFrame:0,frameCount:480*48000,sourceFrames:480*48000})));
  const spans=mapTimelineWindow(t,{startFrame:370*48000,frameCount:16384});
  assert.equal(spans.length,10);
  for(const s of spans) assert.deepEqual([s.sourceStartFrame,s.frameCount,s.outputOffsetFrames],[370*48000,16384,0]);
});
test('offset, trimmed source and silence preserve sample alignment',()=>{
  const t=build([{id:'late',startFrame:100,sourceStartFrame:7,frameCount:100,sourceFrames:200}]);
  assert.deepEqual(mapTimelineWindow(t,{startFrame:90,frameCount:30})[0],{id:'late',silent:false,outputOffsetFrames:10,sourceStartFrame:7,frameCount:20});
  assert.equal(mapTimelineWindow(t,{startFrame:200,frameCount:1})[0].silent,true);
});
test('window touching final frame is valid, overflow is rejected',()=>{
  const t=build([]);
  assert.deepEqual(mapTimelineWindow(t,{startFrame:t.durationFrames-1,frameCount:1}),[]);
  assert.throws(()=>mapTimelineWindow(t,{startFrame:t.durationFrames,frameCount:1}),/outside/);
  assert.throws(()=>mapTimelineWindow(t,{startFrame:Number.MAX_SAFE_INTEGER,frameCount:2}),/overflow/);
});
test('invalid track regions, duplicate IDs and noninteger positions fail closed',()=>{
  assert.throws(()=>build([{id:'a',startFrame:0,sourceStartFrame:0,frameCount:2,sourceFrames:1}]),/outside/);
  assert.throws(()=>build([{id:'a',startFrame:0,sourceStartFrame:0,frameCount:1,sourceFrames:1},{id:'a',startFrame:0,sourceStartFrame:0,frameCount:1,sourceFrames:1}]),/duplicate/);
  assert.throws(()=>build([{id:'a',startFrame:0.5,sourceStartFrame:0,frameCount:1,sourceFrames:1}]),/Invalid/);
  assert.throws(()=>build(Array.from({length:11},(_,i)=>({id:String(i),startFrame:0,sourceStartFrame:0,frameCount:1,sourceFrames:1}))),/tracks/);
});
test('input mutations cannot change immutable timeline',()=>{
  const region={id:'a',startFrame:0,sourceStartFrame:0,frameCount:10,sourceFrames:10};
  const t=build([region]);region.frameCount=1;
  assert.equal(mapTimelineWindow(t,{startFrame:0,frameCount:10})[0].frameCount,10);
  assert.ok(Object.isFrozen(t.tracks[0]));
});
test('large safe source coordinates map without intermediate rounding',()=>{
  const M=Number.MAX_SAFE_INTEGER;
  const t=createTimeline({sampleRate:48000,durationFrames:200,tracks:[{id:'a',startFrame:101,sourceStartFrame:M-2,frameCount:2,sourceFrames:M}]});
  assert.deepEqual(mapTimelineWindow(t,{startFrame:102,frameCount:1})[0],{id:'a',silent:false,outputOffsetFrames:0,sourceStartFrame:M-1,frameCount:1});
  assert.deepEqual(mapTimelineWindow(t,{startFrame:101,frameCount:2})[0],{id:'a',silent:false,outputOffsetFrames:0,sourceStartFrame:M-2,frameCount:2});
});
test('adjacent windows map contiguous source frames at safe integer boundary',()=>{
  const M=Number.MAX_SAFE_INTEGER;
  const t=createTimeline({sampleRate:48000,durationFrames:200,tracks:[{id:'a',startFrame:101,sourceStartFrame:M-3,frameCount:3,sourceFrames:M}]});
  const spans=[101,102,103].map(startFrame=>mapTimelineWindow(t,{startFrame,frameCount:1})[0]);
  assert.deepEqual(spans.map(s=>s.sourceStartFrame),[M-3,M-2,M-1]);
  for(const s of spans) assert.ok(s.sourceStartFrame>=M-3 && s.sourceStartFrame+s.frameCount<=M);
});
