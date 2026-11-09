/* SSF v5c loudness reference regression. Run: node tests/loudness_test.js
 * FFmpeg is optional for local execution, required in GitHub Actions.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const Loudness = require('../loudness.js');
const Polish = require('../polish.js');
const Wav = require('../wav.js');

function sine(sr, seconds, hz, amplitude) {
  const data = new Float32Array(Math.round(sr * seconds));
  for (let i = 0; i < data.length; i++) {
    data[i] = amplitude * Math.sin(2 * Math.PI * hz * i / sr);
  }
  return data;
}
function referenceViaFFmpeg(channels, sr) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssf-loudness-'));
  const file = path.join(dir, 'reference.wav');
  try {
    fs.writeFileSync(file, Buffer.from(Wav.encodeWav(channels, sr, 24)));
    const out = cp.spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file,
      '-filter_complex', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 8e6 });
    assert.equal(out.status, 0, out.stderr);
    const lines = [...(out.stderr || '').matchAll(/\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)];
    assert(lines.length, 'FFmpeg loudness summary must be present');
    return Number(lines.at(-1)[1]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

assert.equal(Polish.settings({}).targetLufs, null, 'normalization default is OFF');
assert.throws(() => Polish.settings({ targetLufs: -13 }), /supported loudness target/);
const silent = Loudness.measure([new Float32Array(48000)], 48000);
assert.equal(silent.valid, false);
const tooShort = Loudness.measure([new Float32Array(2000)], 48000);
assert.equal(tooShort.valid, false);
assert.match(tooShort.reason, /400 milliseconds/);
const multichannel = Loudness.measure([new Float32Array(48000),
  new Float32Array(48000), new Float32Array(48000)], 48000);
assert.equal(multichannel.valid, false);

const sr = 48000, track = sine(sr, 3, 1000, 0.18);
const measured = Loudness.measure([track, track.slice()], sr);
assert(measured.valid && Number.isFinite(measured.lufs));
const lowered = Float32Array.from(track, x => x * 0.5);
const half = Loudness.measure([lowered, lowered.slice()], sr);
assert(Math.abs((half.lufs - measured.lufs) + 6.0206) < 0.1,
  'halving amplitude should reduce loudness by 6 decibels');
const withSilence = Float32Array.from({ length: sr * 6 }, (_, i) => i < track.length ? track[i] : 0);
const gated = Loudness.measure([withSilence, withSilence.slice()], sr);
assert(Math.abs(gated.lufs - measured.lufs) < 1.2,
  'relative gate should exclude sustained trailing silence');

const source = sine(sr, 3, 500, 0.05);
const before = Loudness.measure([source, source.slice()], sr);
const target = before.lufs < -18 ? -18 : -16;
const processed = Polish.process([source, source.slice()], sr,
  { clarity: 0, presence: 0, dynamics: 0, targetLufs: target });
assert(processed.normalizationGainDb <= 6.00001, 'maximum boost must be six decibels');
assert(processed.normalizationGainDb >= -12.00001, 'maximum attenuation must be twelve decibels');
assert(processed.peak <= 0.97001, 'sample peaks must be protected');
assert(processed.loudnessBefore !== null && processed.loudnessAfter !== null);
assert.deepEqual(source, sine(sr, 3, 500, 0.05), 'original samples must remain unchanged');
for (let i = 0; i < source.length; i += 89) {
  assert(Math.abs(processed.channels[0][i] - processed.channels[1][i]) < 1e-7,
    'normalization must preserve stereo channel equality');
}
if (!processed.normalizationLimited) assert(Math.abs(processed.loudnessAfter - target) < 0.25,
  'attainable target must be reached');

const quiet = sine(sr, 3, 1000, 0.004);
quiet[50000] = 0.9;
const constrained = Polish.process([quiet], sr, { targetLufs: -14 });
assert(constrained.normalizationLimited, 'peak-constrained loudness target must be flagged');
assert(constrained.peak <= 0.97001, 'constrained output must stay under peak ceiling');
assert(constrained.loudnessAfter < -14, 'reported achieved loudness must remain below unattainable target');
const unchanged = Polish.process([track], sr, { dynamics: 0, clarity: 0, presence: 0, targetLufs: null });
assert.deepEqual(unchanged.channels[0], track, 'meter-only output bypass is transparent');

// Reviewer-A M8-1: adding gain can change which blocks pass the absolute gate.
// Measure the final audio instead of estimating output LUFS by adding gain dB.
const nearGateLength = sr * 10;
const nearGate = Float32Array.from({ length: nearGateLength }, (_, i) =>
  (i < sr ? 0.0005 : 0.00017) * Math.sin(2 * Math.PI * 1000 * i / sr));
const beforeNear = Loudness.measure([nearGate, nearGate.slice()], sr);
const afterNear = Polish.process([nearGate, nearGate.slice()], sr, {
  clarity: 0, presence: 0, dynamics: 0, targetLufs: -14
});
const measuredFinal = Loudness.measure(afterNear.channels, sr);
assert(beforeNear.valid && measuredFinal.valid, 'near-gate signals must remain measurable');
assert(Math.abs(afterNear.loudnessAfter - measuredFinal.lufs) < 0.02,
  'reported output loudness must equal remeasured actual output near the absolute gate');
assert.notEqual(beforeNear.gatedBlocks, measuredFinal.gatedBlocks,
  'test fixture must cross the absolute gate and exercise block membership changes');
assert(afterNear.normalizationLimited, 'unattainable near-gate target must be marked limited');

// Reviewer-A M8-2: rejected target-only processing must be a byte-identical
// bypass even when source peaks exceed the normal enabled-processing ceiling.
const unsupportedShort = Float32Array.from({ length: sr / 4 }, () => 0.99);
const shortInput = [unsupportedShort, unsupportedShort.slice()];
const shortResult = Polish.process(shortInput, sr, { targetLufs: -16 });
assert.equal(shortResult.loudnessAfter, null);
assert.equal(shortResult.normalizationGainDb, 0);
assert.equal(shortResult.safetyGainDb, 0);
assert(shortResult.normalizationLimited);
shortResult.channels.forEach((ch, idx) =>
  assert.deepEqual(ch, shortInput[idx], 'rejected short target-only request must leave samples unchanged'));

const unsupportedTriple = [
  Float32Array.from({ length: sr }, () => 1.2),
  Float32Array.from({ length: sr }, () => 0.99),
  Float32Array.from({ length: sr }, () => -0.8)
];
const tripleResult = Polish.process(unsupportedTriple, sr, { targetLufs: -18 });
assert.equal(tripleResult.safetyGainDb, 0);
assert.equal(tripleResult.normalizationGainDb, 0);
assert.equal(tripleResult.loudnessAfter, null);
assert(tripleResult.normalizationLimited);
tripleResult.channels.forEach((ch, idx) =>
  assert.deepEqual(ch, unsupportedTriple[idx],
    'rejected multi-channel target-only request must not change samples above peak ceiling'));
// Other enabled processing still uses its original sample-peak protection.
const shortTone = Polish.process(shortInput, sr, { clarity: 50, targetLufs: -16 });
assert(shortTone.peak <= 0.97001, 'enabled tone correction keeps pre-edit safety');

const reference = cp.spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
if (reference.status !== 0) throw new Error('FFmpeg is required to run the independent loudness reference test.');
for (const sampleRate of [44100, 48000]) {
  for (const channels of [1, 2]) {
    const signal = sine(sampleRate, 3, 1000, 0.13);
    const arrays = Array.from({ length: channels }, () => signal.slice());
    const ours = Loudness.measure(arrays, sampleRate);
    const independent = referenceViaFFmpeg(arrays, sampleRate);
    assert(Math.abs(ours.lufs - independent) < 0.35,
      'loudness mismatch against FFmpeg at ' + sampleRate +
      ' Hz/' + channels + ' channels: ours=' + ours.lufs + ', FFmpeg=' + independent);
  }
}
console.log('Loudness tests passed: gating, samples, target limits, stereo, FFmpeg reference.');
