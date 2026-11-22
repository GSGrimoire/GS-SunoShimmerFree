'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validateReceipt,GROUPS,TYPES}=require('./consent-receipt-contract.cjs');
const fresh=()=>({
 schemaVersion:1,consentVersion:'consent_v1',subjectPseudonym:'subject_0001',
 recordedAt:'2026-11-22T05:10:00.000Z',purpose:'local_studio',
 processing:{externalTransferAllowed:false,processorId:null},
 training:Object.fromEntries(GROUPS.map(g=>[g,{enabled:false,types:Object.fromEntries(TYPES[g].map(t=>[t,false]))}])),
 rightsAttested:false,revokedAt:null
});
test('all five optional datasets default off, independent of processing',()=>{
 const r=fresh();assert.equal(validateReceipt(r),true);
 r.processing.externalTransferAllowed=true;r.processing.processorId='processor_01';
 assert.equal(validateReceipt(r),true);
 assert.ok(GROUPS.every(g=>!r.training[g].enabled));
});
test('training needs specific data type and rights attestation',()=>{
 const r=fresh();r.training.audio_examples.enabled=true;
 assert.equal(validateReceipt(r),false);
 r.training.audio_examples.types.original_excerpts=true;
 assert.equal(validateReceipt(r),false);
 r.rightsAttested=true;assert.equal(validateReceipt(r),true);
});
test('disabled group cannot hide enabled data types',()=>{
 const r=fresh();r.training.processing_decisions.types.manual_edits=true;
 assert.equal(validateReceipt(r),false);
});
test('revocation blocks continuing permission and cannot predate consent',()=>{
 const r=fresh();r.revokedAt='2026-11-22T05:11:00.000Z';assert.equal(validateReceipt(r),true);
 r.training.perceptual_preferences.enabled=true;r.training.perceptual_preferences.types.ratings=true;r.rightsAttested=true;
 assert.equal(validateReceipt(r),false);
 r.training.perceptual_preferences.enabled=false;r.training.perceptual_preferences.types.ratings=false;
 r.revokedAt='2026-11-21T05:11:00.000Z';assert.equal(validateReceipt(r),false);
});
test('no extra audio payload, account identifiers or hidden permission fields',()=>{
 for(const key of ['audioBytes','email','uploadAllowed','trainingAll','logPayload']){
  const r=fresh();r[key]='secret';assert.equal(validateReceipt(r),false,key);
 }
});
test('reject malformed version, timestamps, processor and unknown dataset types',()=>{
 const cases=[
  r=>r.consentVersion='x',r=>r.recordedAt='yesterday',
  r=>r.processing.processorId='unapproved',
  r=>r.training.audio_examples.types.hidden_upload=true,
  r=>r.training.extra={enabled:true,types:{}}
 ];
 for(const change of cases){const r=fresh();change(r);assert.equal(validateReceipt(r),false);}
});

test('canonical UTC timestamps reject impossible dates in both fields',()=>{
 for(const bad of ['2026-02-30T05:10:00.000Z','2025-02-29T05:10:00.000Z','2026-04-31T05:10:00.000Z']){
  const recorded=fresh();recorded.recordedAt=bad;
  assert.equal(validateReceipt(recorded),false,'recordedAt '+bad);
  const revoked=fresh();revoked.revokedAt=bad;
  assert.equal(validateReceipt(revoked),false,'revokedAt '+bad);
 }
 const leap=fresh();leap.recordedAt='2024-02-29T05:10:00.000Z';
 leap.revokedAt='2024-02-29T05:11:00.000Z';
 assert.equal(validateReceipt(leap),true);
 leap.revokedAt='2024-02-29T05:09:00.000Z';
 assert.equal(validateReceipt(leap),false,'revocation cannot predate recording');
});
test('exact type keys reject delimiter-collision replacements',()=>{
 const r=fresh();
 r.rightsAttested=true;
 r.training.processing_decisions.enabled=true;
 delete r.training.processing_decisions.types.manual_edits;
 delete r.training.processing_decisions.types.model_errors;
 r.training.processing_decisions.types['manual_edits|model_errors']=true;
 assert.equal(validateReceipt(r),false,'combined key must not replace two required keys');
});
