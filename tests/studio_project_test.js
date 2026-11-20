'use strict';
const assert = require('node:assert/strict');
const P = require('../studio-project.js');
let count = 0;
function test(label, fn) { fn(); count++; console.log('PASS', label); }
const src = {id:'source', label:'Source WAV', sampleRate:48000, channels:2, frames:480000};
const track = {id:'track', sourceId:'source', startFrame:480, sourceStartFrame:0, frameCount:480000};
let p = P.empty(48000);
test('immutable empty manifest', () => { assert(Object.isFrozen(p)); assert(Object.isFrozen(p.sources)); });
p = P.apply(p,{type:'addSource',source:src});
p = P.apply(p,{type:'addTrack',track});
test('source and track metadata are frozen', () => { assert(Object.isFrozen(p.tracks[0])); assert(Object.isFrozen(p.sources[0])); });
test('sample exact timeline and bypass', () => {
  assert.equal(P.gainAt(p,'track',479),0); assert.equal(P.gainAt(p,'track',480),1);
  assert.equal(P.gainAt(p,'track',480479),1); assert.equal(P.gainAt(p,'track',480480),0);
});
const original = p;
p = P.apply(p,{type:'addEdit',edit:{id:'attenuation',trackId:'track',type:'gain',startFrame:500,endFrame:520,value:0.25}});
test('undo by immutable history and half-open gain edit', () => {
  assert.equal(P.gainAt(p,'track',499),1); assert.equal(P.gainAt(p,'track',500),0.25);
  assert.equal(P.gainAt(p,'track',519),0.25); assert.equal(P.gainAt(p,'track',520),1);
  assert.equal(P.gainAt(original,'track',500),1);
});
p = P.apply(p,{type:'addEdit',edit:{id:'mute',trackId:'track',type:'mute',startFrame:510,endFrame:515}});
test('mute overrides overlapping gain', () => {
  assert.equal(P.gainAt(p,'track',510),0); assert.equal(P.gainAt(p,'track',514),0);
  assert.equal(P.gainAt(p,'track',515),0.25);
});
test('serialize and reload without mutating original', () => {
  assert.deepEqual(P.validate(JSON.parse(JSON.stringify(p))),p);
  assert.equal(P.gainAt(p,'track',510),0);
});
p = P.apply(p,{type:'removeEdit',id:'mute'});
test('reversible edit removal', () => assert.equal(P.gainAt(p,'track',510),0.25));
test('reject invalid or destructive operations', () => {
  assert.throws(()=>P.apply(p,{type:'removeEdit',id:'missing'}));
  assert.throws(()=>P.apply(p,{type:'setTrack',id:'track',field:'sourceId',value:'other'}));
  assert.throws(()=>P.apply(p,{type:'addEdit',edit:{id:'bad',trackId:'track',type:'mute',startFrame:0,endFrame:500}}));
  assert.throws(()=>P.apply(p,{type:'addEdit',edit:{id:'bad',trackId:'track',type:'gain',startFrame:500,endFrame:501,value:NaN}}));
  assert.throws(()=>P.apply(p,{type:'addEdit',edit:{id:'bad',trackId:'track',type:'gain',startFrame:500,endFrame:501,value:Infinity}}));
  assert.throws(()=>P.apply(p,{type:'addEdit',edit:{id:'bad',trackId:'track',type:'gain',startFrame:500,endFrame:500,value:1}}));
  assert.throws(()=>P.apply(p,{type:'addTrack',track:{...track,id:'bad',sourceStartFrame:1}}));
  assert.throws(()=>P.apply(p,{type:'addSource',source:src}));
});
test('reject unsupported source rate and bad schema', () => {
  assert.throws(()=>P.validate({...p,schemaVersion:2}));
  assert.throws(()=>P.validate({...p,sources:[{...src,sampleRate:44100}]}));
});
test('muted track and gain bounds', () => {
  const m=P.apply(p,{type:'setTrack',id:'track',field:'muted',value:true});
  assert.equal(P.gainAt(m,'track',510),0); assert.equal(P.gainAt(p,'track',510),0.25);
  assert.throws(()=>P.apply(p,{type:'setTrack',id:'track',field:'gain',value:-1}));
});
console.log(`${count} studio project tests passed`);
