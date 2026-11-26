import test from 'node:test';
import assert from 'node:assert/strict';
import { createWaveformPeaks, appendWaveformPeaks, finishWaveformPeaks } from '../studio-waveform-peaks.js';

test('zero signal and empty result', () => {
  const s = createWaveformPeaks({ channels: 2, framesPerBucket: 2 });
  assert.deepEqual(finishWaveformPeaks(s).buckets, []);
  const t = appendWaveformPeaks(s, new Float32Array(8), 0);
  assert.deepEqual(finishWaveformPeaks(t).buckets, [{ min: 0, max: 0 }, { min: 0, max: 0 }]);
});
test('chunk boundary alignment and stereo extrema', () => {
  const s = createWaveformPeaks({ channels: 2, framesPerBucket: 3 });
  const a = appendWaveformPeaks(s, Float32Array.from([-.2,.5,.4,-.8]), 0);
  const b = appendWaveformPeaks(a, Float32Array.from([.1,.9,-.7,.3]), 2);
  assert.deepEqual(finishWaveformPeaks(b).buckets, [{ min: Math.fround(-.8), max: Math.fround(.9) }, { min: Math.fround(-.7), max: Math.fround(.3) }]);
});
test('source and prior state remain unchanged', () => {
  const s = createWaveformPeaks({ channels: 1, framesPerBucket: 2 });
  const pcm = Float32Array.of(.25,-.5);
  const t = appendWaveformPeaks(s, pcm, 0); pcm[0] = 1;
  assert.equal(s.nextFrame, 0);
  assert.deepEqual(finishWaveformPeaks(t).buckets, [{ min: -.5, max: .25 }]);
  assert.throws(() => t.buckets.push({ min: 0, max: 0 }), TypeError);
});
test('reject gaps, repeats and malformed samples', () => {
  const s = createWaveformPeaks({ channels: 2, framesPerBucket: 2 });
  assert.throws(() => appendWaveformPeaks(s, Float32Array.of(0,0), 1), RangeError);
  assert.throws(() => appendWaveformPeaks(s, Float32Array.of(NaN,0), 0), RangeError);
  assert.throws(() => appendWaveformPeaks(s, Float32Array.of(2,0), 0), RangeError);
  assert.throws(() => appendWaveformPeaks(s, Float32Array.of(0), 0), TypeError);
});
test('empty chunks cannot bypass frame progress or repeat an offset', () => {
  const initial = createWaveformPeaks({ channels: 2, framesPerBucket: 2 });
  assert.throws(() => appendWaveformPeaks(initial, new Float32Array(0), 0), RangeError);
  const next = appendWaveformPeaks(initial, Float32Array.of(0.25, -0.5), 0);
  assert.equal(next.nextFrame, 1);
  assert.throws(() => appendWaveformPeaks(next, new Float32Array(0), 1), RangeError);
  assert.throws(() => appendWaveformPeaks(next, Float32Array.of(0, 0), 0), RangeError);
  assert.equal(next.nextFrame, 1);
  assert.deepEqual(finishWaveformPeaks(next).buckets, [{ min: -0.5, max: 0.25 }]);
});
test('capacity fails before any partial accumulation', () => {
  const s = createWaveformPeaks({ channels: 1, framesPerBucket: 2, maxBuckets: 1 });
  assert.throws(() => appendWaveformPeaks(s, new Float32Array(4), 0), RangeError);
  assert.equal(s.nextFrame, 0);
  assert.throws(() => appendWaveformPeaks(s, new Float32Array(16385), 0), RangeError);
});
test('eight minute stereo summary without storing prior samples', () => {
  const frames = 480 * 48000;
  let state = createWaveformPeaks({ channels: 2, framesPerBucket: 4800, maxBuckets: 4800 });
  const chunk = new Float32Array(2 * 9600);
  for (let f = 0; f < frames; f += 9600) state = appendWaveformPeaks(state, chunk, f);
  const summary = finishWaveformPeaks(state);
  assert.equal(summary.frameCount, frames);
  assert.equal(summary.buckets.length, 4800);
  assert.equal(summary.buckets[0].min, 0);
});
