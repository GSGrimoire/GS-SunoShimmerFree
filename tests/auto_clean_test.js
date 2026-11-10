/* SSF v5e deterministic local Auto Clean diagnostics.
 * Run: node tests/auto_clean_test.js
 */
'use strict';
const assert = require('node:assert/strict');
const Auto = require('../auto-clean.js');

const sr = 48000;
function sine(hz, amp, seconds = 0.5) {
  return Float32Array.from({ length: Math.round(seconds * sr) },
    (_, i) => amp * Math.sin(2 * Math.PI * hz * i / sr));
}
function windows(signals) {
  return signals.map(s => ({ channels: [s.slice(), s.slice()] }));
}
function noise(length, amplitude, seed) {
  let x = seed || 12345;
  return Float32Array.from({ length }, () => {
    x = (1664525 * x + 1013904223) >>> 0;
    return amplitude * (x / 4294967296 * 2 - 1);
  });
}
// A clean midrange source should not trigger destructive processing.
const cleanAudio = windows(Array.from({ length: 8 }, () => sine(1000, 0.22)));
const clean = Auto.inspect(cleanAudio, sr);
assert.equal(clean.shouldProcess, false, 'clear midrange music should be left untouched');
assert.equal(clean.findings.clipping, false);
assert.equal(clean.findings.noisy, false);
assert.equal(clean.findings.clicks, false);
assert.equal(clean.polish.transients, 0);
assert.equal(clean.polish.targetLufs, null);
assert.match(clean.explanation, /original unchanged/);

// Broadband high-frequency energy during quiet passages should cause a
// conservative suggestion, not loudness enhancement or compression.
const hiss = windows([
  noise(24000, 0.04, 101),
  noise(24000, 0.04, 202),
  noise(24000, 0.04, 303),
  noise(24000, 0.04, 404),
  sine(1000, 0.26), sine(1000, 0.26),
  sine(1000, 0.26), sine(1000, 0.26)
]);
const hissPlan = Auto.inspect(hiss, sr);
assert.equal(hissPlan.findings.noisy, true, 'persistent quiet high-band energy should be detected');
assert.equal(hissPlan.shouldProcess, true);
assert(hissPlan.clean.denoise && hissPlan.clean.denoiseStrength <= 0.7);
assert(hissPlan.clean.maxAttenDb <= 5 && hissPlan.clean.shimmer <= 0.35);
assert.equal(hissPlan.polish.presence, 0);
assert.equal(hissPlan.polish.dynamics, 0);
assert.equal(hissPlan.polish.transients, 0);

// Large flat-topped waveforms can indicate clipped or hard-limited drums,
// but do not prove source corruption and should not trigger a 'repair' claim.
const clipped = sine(220, 1.25);
for (let i = 0; i < clipped.length; i++) {
  clipped[i] = Math.max(-0.78, Math.min(0.78, clipped[i]));
}
const clipPlan = Auto.inspect(windows(Array.from({ length: 8 }, () => clipped)), sr);
assert.equal(clipPlan.findings.clipping, true, 'hard-clipped signal should flag flat tops');
assert.match(clipPlan.explanation, /cannot reconstruct damaged drum hits/);
assert.equal(clipPlan.polish.transients, 0, 'clipped source must not automatically receive transient enhancement');
assert.equal(clipPlan.polish.presence, 0, 'clipped source must not automatically receive presence boost');

const clicks = sine(1000, 0.11);
for (const index of [201, 901, 4401, 10001, 16001]) clicks[index] += 0.70;
const clickPlan = Auto.inspect(windows([clicks]), sr);
assert.equal(clickPlan.findings.clicks, true, 'isolated one-sample spikes should be flagged');
assert.equal(clickPlan.shouldProcess, false, 'no false claim to remove unfixable single-sample clicks');
assert.match(clickPlan.explanation, /not a reliable de-clicker/);

const muddy = Auto.inspect(windows(Array.from({ length: 8 }, () => sine(320, 0.35))), sr);
assert.equal(muddy.findings.muddy, true, 'low-mid-heavy source should offer a restrained clarity cut');
assert(muddy.polish.clarity > 0 && muddy.polish.clarity <= 25);
assert.equal(muddy.applyPolish, true);
assert.equal(muddy.polish.dynamics, 0);
assert.equal(muddy.polish.transients, 0);
assert.equal(muddy.polish.targetLufs, null);

// A change confined to the ending must be surfaced despite music being
// loud throughout. The recommendation uses only shimmer, with static OFF.
// A high-frequency rise may be musical cymbals, not actual recording damage.
const body=Array.from({length:8},()=>({
  region:'body', startSeconds:20,
  channels:[sine(1200,0.32),sine(1200,0.32)]
}));
const tail=Array.from({length:8},(_,i)=>{
  const base=sine(1200,0.32), grain=noise(24000,0.17,170+i);
  for(let j=0;j<base.length;j++)base[j]+=grain[j];
  return {region:'tail',startSeconds:150+i,channels:[base,base.slice()]};
});
const latePlan=Auto.inspect(body.concat(tail),sr);
assert.equal(latePlan.findings.tailShimmerCandidate,true,
  'sustained relative high-band increase localized in the tail must be reported');
assert(latePlan.metrics.tailHighBandLiftDb>=4);
assert.equal(latePlan.clean.denoise,false,
  'a tail-only high-band change must not activate broad static subtraction');
assert.equal(latePlan.clean.shimmer,0.75);
assert.equal(latePlan.clean.shimmerMaxDb,6);
assert.equal(latePlan.polish.presence,0);
assert.equal(latePlan.polish.transients,0);
assert.match(latePlan.explanation,/cymbals or intentional music/i);
// An uniformly bright track must not be treated as a newly damaged ending.
const allBright=tail.map(w=>({...w,region:'body'})).concat(tail);
const brightPlan=Auto.inspect(allBright,sr);
assert.equal(brightPlan.findings.tailShimmerCandidate,false,
  'bright music without relative ending change is not automatically shimmer');
assert.equal(brightPlan.shouldProcess,false);
// The browser-side sampler reserves half its fixed budget for the end.
const fixture={
 numberOfChannels:1,length:sr*180,
 getChannelData(){return {
   slice(from,to){return new Float32Array(to-from);}
 }}
};
const localizedSamples=Auto.sampleWindows(fixture,sr);
assert.equal(localizedSamples.length,16);
assert.equal(localizedSamples.filter(w=>w.region==='tail').length,8);
assert(localizedSamples.filter(w=>w.region==='tail')
  .every(w=>w.startSeconds>=153), 'ending should be sampled explicitly');
assert(localizedSamples.every(w=>w.channels[0].length<=24000));

// Sampling cannot allocate a complete copy of a long recording.
let copied = 0;
const fakeLong = {
  numberOfChannels: 2, length: sr * 3600,
  getChannelData: () => ({
    slice: (start, end) => {
      copied += end - start;
      assert(start >= 0 && end <= sr * 3600);
      return new Float32Array(end - start);
    }
  })
};
const samples = Auto.sampleWindows(fakeLong, sr);
assert.equal(samples.length, 16);
assert(copied <= 16 * 24000 * 2, 'only a small fraction of the song is copied');
assert(samples.every(w => w.channels.length === 2));
assert.equal(samples[0].channels[0].length, 24000);
assert.throws(() => Auto.analyze([{ channels: [Float32Array.of(NaN, 0, 0, 0)] }], sr),
  /Non-finite/);
assert.throws(() => Auto.analyze([{ channels: [new Float32Array(8), new Float32Array(6)] }], sr),
  /lengths differ/);
assert.throws(() => Auto.sampleWindows(null, sr), /requires a loaded/);
console.log('Auto Clean tests passed: clean bypass, quiet treble noise, flat clipping, click warning, low-mid, bounded sampling, localized tail comparison and shimmer-only recommendation.');
