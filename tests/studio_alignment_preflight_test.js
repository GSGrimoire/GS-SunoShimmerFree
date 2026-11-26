import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightAlignedStems } from '../studio-alignment-preflight.js';
const stem = (id, changes = {}) => ({ id, sampleRate: 48000, channels: 2, decodedFrames: 480 * 48000, offsetFrames: 0, alignmentVerified: true, ...changes });
test('ten eight-minute stems admit without decoding or allocating audio', () => {
  const result = preflightAlignedStems(Array.from({ length: 10 }, (_, i) => stem(`s${i}`)));
  assert.equal(result.totalFrames, 23040000);
  assert.equal(result.tracks.length, 10);
});
test('offsets and unequal lengths preserve exact sample-frame ends', () => {
  const result = preflightAlignedStems([stem('a', { decodedFrames: 100, offsetFrames: 23 }), stem('b', { decodedFrames: 50, offsetFrames: 100 })]);
  assert.equal(result.totalFrames, 150);
  assert.deepEqual(result.tracks.map(t => t.endFrame), [123, 150]);
});
test('rejects unresolved alignment and incompatible rates rather than guessing', () => {
  assert.throws(() => preflightAlignedStems([stem('a', { alignmentVerified: false })]), /Unverified/);
  assert.throws(() => preflightAlignedStems([stem('a'), stem('b', { sampleRate: 44100 })]), /Resampling/);
});
test('rejects malformed and duplicate track descriptors', () => {
  for (const input of [[], [stem('a'), stem('a')], [stem('a', { channels: 3 })], [stem('a', { decodedFrames: NaN })], [stem('a', { offsetFrames: -1 })], [stem('a', { id: '../bad' })], Array.from({ length: 11 }, (_, i) => stem(`s${i}`))]) assert.throws(() => preflightAlignedStems(input));
});
test('rejects safe integer overflow even when individual coordinates are safe', () => {
  assert.throws(() => preflightAlignedStems([stem('a', { offsetFrames: Number.MAX_SAFE_INTEGER, decodedFrames: 1 })]), /overflow/);
});
test('output is immutable and independent of mutated input', () => {
  const input = [stem('a')];
  const result = preflightAlignedStems(input);
  input[0].decodedFrames = 1;
  assert.equal(result.tracks[0].decodedFrames, 23040000);
  assert.throws(() => { result.tracks[0].decodedFrames = 1; }, TypeError);
  assert.throws(() => { result.tracks.push('x'); }, TypeError);
});
