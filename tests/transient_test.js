/* GS SunoShimmerFree v5d transient regression.
 * Run: node tests/transient_test.js
 */
'use strict';
const assert = require('node:assert/strict');
const Transient = require('../transient.js');
const Polish = require('../polish.js');
const sr = 48000;

function sineBurst(hz, amplitude, seconds = 1.5, onset = 0.4, off = 0.72) {
  return Float32Array.from({ length: Math.round(seconds * sr) }, (_, i) => {
    const t = i / sr;
    return t >= onset && t < off ? amplitude * Math.sin(2 * Math.PI * hz * (t - onset)) : 0;
  });
}
function rms(samples, begin, end) {
  const from = Math.floor(begin * sr), until = Math.floor(end * sr);
  let sum = 0;
  for (let i = from; i < until; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / (until - from));
}
const low = sineBurst(160, 0.60);
const noChange = Polish.process([low], sr, { clarity: 0, presence: 0, dynamics: 0,
  transients: 0, targetLufs: null });
assert.deepEqual(noChange.channels[0], low, 'disabled transient processing preserves all source samples');
assert.equal(noChange.transientMaxBandBoostDb, 0);

const withAttack = Polish.process([low], sr, { clarity: 0, presence: 0, dynamics: 0,
  transients: 100, targetLufs: null });
assert(withAttack.transientMaxBandBoostDb > 0.4 && withAttack.transientMaxBandBoostDb < 3,
  'effect produces bounded low/mid attack boost');
assert(rms(withAttack.channels[0], 0.413, 0.445) > 1.01 * rms(low, 0.413, 0.445),
  'drum-like 160 Hz onset should be more prominent');
assert(withAttack.peak <= 0.97001, 'peak safety must also apply after transient enhancement');
assert.deepEqual(low, sineBurst(160, 0.60), 'input audio remains untouched');

const shimmer = sineBurst(8000, 0.6);
const shimmerOut = Polish.process([shimmer], sr, { transients: 100 });
const inRms = rms(shimmer, 0.42, 0.52);
const outRms = rms(shimmerOut.channels[0], 0.42, 0.52);
assert(Math.abs(outRms - inRms) / inRms < 0.005,
  'transient emphasis must not appreciably amplify high-frequency shimmer');
// Stereo-linked detection and identical filters preserve proportional L/R gains.
const right = Float32Array.from(low, x => x / 2);
const stereo = Polish.process([low, right], sr, { transients: 75 });
for (let i = 0; i < low.length; i += 91) {
  assert(Number.isFinite(stereo.channels[0][i]));
  assert(Math.abs(stereo.channels[0][i] - 2 * stereo.channels[1][i]) < 1e-6,
    'linked envelope preserves proportional stereo channels');
}
// Steady tones should not be continuously boosted after the initial onset.
const sustained = Float32Array.from({ length: sr * 2 }, (_, i) =>
  0.3 * Math.sin(2 * Math.PI * 160 * i / sr));
const steady = Polish.process([sustained], sr, { transients: 100 });
assert(Math.abs(rms(steady.channels[0], 1, 1.5) - rms(sustained, 1, 1.5)) < 0.0015,
  'effect must decay to near-zero on a sustained tone');
const silence = new Float32Array(sr);
const silent = Polish.process([silence], sr, { transients: 100 });
assert.deepEqual(silent.channels[0], silence, 'silence remains silent');
assert.equal(silent.transientMaxBandBoostDb, 0);
assert.deepEqual(Polish.process([low], sr, { clarity: 40, presence: 30, dynamics: 20 }).channels[0],
  Polish.process([low], sr, { clarity: 40, presence: 30, dynamics: 20, transients: 0 }).channels[0],
  'zero transients changes nothing in existing tone/dynamics path');
assert.equal(Polish.settings({ transients: -8 }).transients, 0);
assert.equal(Polish.settings({ transients: 1000 }).transients, 100);
assert.equal(Polish.settings({ transients: NaN }).transients, 0);
assert.equal(Polish.PRESETS.natural.transients, 0);
assert(Polish.PRESETS.punchy.transients > 0);
assert.throws(() => Transient.processInPlace([Float32Array.of(NaN)], sr, 10), /non-finite/);
assert.throws(() => Transient.processInPlace([Float32Array.of(0), new Float32Array(2)], sr, 10), /different/);
for (const sampleRate of [8000, 11025, 44100, 48000, 96000, 192000, 384000]) {
  const input = Float32Array.from({ length: Math.floor(sampleRate / 4) },
    (_, i) => 0.5 * Math.sin(2 * Math.PI * 170 * i / sampleRate));
  const processed = Polish.process([input], sampleRate, { transients: 65, dynamics: 10 });
  assert(Number.isFinite(processed.peak));
  assert(processed.channels[0].every(Number.isFinite),
    'transients remain finite at sample rate ' + sampleRate);
}
console.log('Transient tests passed: true bypass, onset gain, high-frequency restraint, stereo, steady tone, peak safety.');
