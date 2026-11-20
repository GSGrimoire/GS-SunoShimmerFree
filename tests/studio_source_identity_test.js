'use strict';
const assert = require('node:assert/strict');
const I = require('../studio-source-identity.js');
const digest = 'a1'.repeat(32);
const source = Object.freeze({id:'s',digest,frames:23040000,sampleRate:48000,channels:2});
const actual = Object.freeze({digest:digest.toUpperCase(),frames:23040000,sampleRate:48000,channels:2});
const project = {sources:[source],tracks:[{id:'t',sourceId:'s'}]};
let count = 0;
function test(label, fn) { fn(); console.log('PASS',label); count++; }
test('verified eight-minute stereo source',()=>assert.equal(I.verifyProject(project,new Map([['s',actual]])),true));
test('fingerprint missing fails closed',()=>assert.throws(()=>I.verifySource({...source,digest:undefined},actual),/fingerprint required/));
test('actual digest missing fails closed',()=>assert.throws(()=>I.verifySource(source,{...actual,digest:undefined}),/unavailable/));
test('digest mismatch rejects',()=>assert.throws(()=>I.verifySource(source,{...actual,digest:'b2'.repeat(32)}),/fingerprint mismatch/));
test('decoded frame mismatch rejects',()=>assert.throws(()=>I.verifySource(source,{...actual,frames:23039999}),/frame count mismatch/));
test('rate and channel mismatch reject',()=>{assert.throws(()=>I.verifySource(source,{...actual,sampleRate:44100}),/sample rate mismatch/);assert.throws(()=>I.verifySource(source,{...actual,channels:1}),/channel count mismatch/);});
test('missing and extra source reject',()=>{assert.throws(()=>I.verifyProject(project,new Map()),/count mismatch/);assert.throws(()=>I.verifyProject(project,new Map([['s',actual],['other',actual]])),/count mismatch/);});
test('duplicate ids and dangling track reject',()=>{assert.throws(()=>I.verifyProject({...project,sources:[source,source]},new Map([['s',actual],['x',actual]])),/duplicate source id/);assert.throws(()=>I.verifyProject({...project,tracks:[{sourceId:'missing'}]},new Map([['s',actual]])),/missing source/);});
test('malformed metadata and unsafe frame counts reject',()=>{assert.throws(()=>I.verifySource({...source,frames:Number.MAX_SAFE_INTEGER+1},actual),/frame count mismatch/);assert.throws(()=>I.verifySource(source,{...actual,digest:'bad'}),/unavailable/);});
console.log(count+' identity tests passed');
