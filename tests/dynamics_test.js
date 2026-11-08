/* SSF v5b dynamics regression tests. Run: node tests/dynamics_test.js */
'use strict';
const assert = require('node:assert/strict');
const Polish = require('../polish.js');

function signal(sr, seconds, hz, amplitude) {
  const n = Math.round(sr * seconds), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin(2 * Math.PI * hz * i / sr);
  return out;
}
function power(samples, startIndex) {
  let s = 0, count = 0;
  for (let i = startIndex || 0; i < samples.length; i++) { s += samples[i] * samples[i]; count++; }
  return Math.sqrt(s / count);
}
function ratioDb(out, original, startIndex) {
  return 20 * Math.log10(power(out, startIndex) / power(original, startIndex));
}
const sr = 48000, src = signal(sr, 2, 1000, 0.70);
const dry = Polish.process([src], sr, { clarity: 0, presence: 0, dynamics: 0 });
assert.deepEqual(dry.channels[0], src, 'full bypass must copy samples exactly');
assert.notEqual(dry.channels[0], src, 'bypass should not alias input');
const compressed = Polish.process([src], sr, { clarity: 0, presence: 0, dynamics: 100 });
assert(compressed.dynamicMaxReductionDb > 2, 'sustained loud signal must trigger compression');
assert(ratioDb(compressed.channels[0], src, sr) < -2, 'compression must reduce sustained level');
assert(compressed.channels[0][0] === src[0], 'zero-valued onset remains exact');
assert(compressed.peak <= 0.97001, 'peak guard still applies');
assert.deepEqual(src, signal(sr, 2, 1000, 0.70), 'input must not be modified');
const gentle = Polish.process([src], sr, { dynamics: 15 });
assert(gentle.dynamicMaxReductionDb > 0 && gentle.dynamicMaxReductionDb < compressed.dynamicMaxReductionDb,
  'small dynamics amount must compress less than full strength');
const short = new Float32Array(sr);
short[50] = 0.8;
const transient = Polish.process([short], sr, { dynamics: 100 });
assert(transient.channels[0][50] > 0.79, 'brief isolated impulse should not be strongly attenuated');

const right = Float32Array.from(src, x => x / 2);
const stereo = Polish.process([src, right], sr, { dynamics: 100 });
for (let i = 0; i < src.length; i += 113) {
  assert(Number.isFinite(stereo.channels[0][i]));
  assert(Math.abs(stereo.channels[0][i] - 2 * stereo.channels[1][i]) < 1e-6,
    'linked compressor must preserve channel gain ratio');
}
assert(stereo.peak <= 0.97001, 'stereo peak must remain safe');

const silence = Polish.process([new Float32Array(4096)], sr, { dynamics: 100 });
assert.equal(silence.peak, 0);
assert(silence.channels[0].every(x => x === 0), 'silent samples must remain silent');
assert.equal(Polish.settings({ dynamics: 150 }).dynamics, 100);
assert.equal(Polish.settings({ dynamics: -10 }).dynamics, 0);
assert.equal(Polish.settings({ dynamics: NaN }).dynamics, 0);
for (const sampleRate of [8000, 11025, 44100, 48000, 96000, 192000, 384000]) {
  const samples = signal(sampleRate, 0.15, 260, 0.5);
  const r = Polish.process([samples], sampleRate, { clarity: 30, presence: 25, dynamics: 60 });
  assert(Number.isFinite(r.peak) && Number.isFinite(r.dynamicMaxReductionDb),
    'finite response at ' + sampleRate);
  assert(r.channels[0].every(Number.isFinite), 'no NaNs or infinities at ' + sampleRate);
}
assert.throws(() => Polish.process([Float32Array.of(NaN)], sr, { dynamics: 25 }), /invalid sample/);
assert.throws(() => Polish.process([src, new Float32Array(2)], sr, { dynamics: 25 }), /different lengths/);
console.log('Dynamics tests passed: bypass, soft compression, transients, stereo, peak guard, validation, sample rates.');
