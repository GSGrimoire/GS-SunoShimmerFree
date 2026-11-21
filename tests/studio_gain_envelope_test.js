import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGainEnvelope } from '../studio-gain-envelope.js';
const run = (data, options) => applyGainEnvelope([Float32Array.from(data)], options)[0];
test('bypass preserves samples and does not mutate source', () => {
  const source = Float32Array.of(-1, 0, .5, 1);
  const out = applyGainEnvelope([source], { startFrame: 0 });
  assert.deepEqual([...out[0]], [...source]); assert.notEqual(out[0], source);
});
test('fade boundaries align across adjacent chunks', () => {
  const fades = [{ startFrame: 2, endFrame: 6, from: 0, to: 1 }];
  const whole = run(Array(8).fill(1), { startFrame: 0, fades });
  const a = run(Array(4).fill(1), { startFrame: 0, fades });
  const b = run(Array(4).fill(1), { startFrame: 4, fades });
  assert.deepEqual([...a, ...b], [...whole]);
  assert.equal(whole[2], 0); assert.equal(whole[5], 1); assert.equal(whole[6], 1);
});
test('stereo uses identical envelope', () => {
  const out = applyGainEnvelope([Float32Array.of(1, 1, 1), Float32Array.of(-1, -1, -1)], {
    startFrame: 0, gain: .5, fades: [{ startFrame: 0, endFrame: 3, from: 0, to: 1 }]
  });
  assert.deepEqual([...out[0]], [0, .25, .5]);
  assert.deepEqual([...out[1]], [0, -.25, -.5]);
});
test('single frame fade is deterministic', () =>
  assert.deepEqual([...run([1, 1], { startFrame: 0, fades: [{ startFrame: 0, endFrame: 1, from: 1, to: 0 }] })], [0, 1]));
test('rejects overlap, unsorted, invalid gain and nonfinite audio', () => {
  for (const options of [
    { gain: NaN }, { gain: -1 },
    { fades: [{ startFrame: 0, endFrame: 2, from: 1, to: 0 }, { startFrame: 1, endFrame: 3, from: 0, to: 1 }] },
    { fades: [{ startFrame: 0, endFrame: 1, from: 0, to: Infinity }] }
  ]) assert.throws(() => run([1, 1], { startFrame: 0, ...options }), RangeError);
  assert.throws(() => run([NaN], { startFrame: 0 }), RangeError);
});
test('rejects oversized buffers and unsafe timeline coordinates', () => {
  assert.throws(() => run(new Array(16385).fill(0), { startFrame: 0 }), RangeError);
  assert.throws(() => run([1, 1], { startFrame: Number.MAX_SAFE_INTEGER }), RangeError);
});
