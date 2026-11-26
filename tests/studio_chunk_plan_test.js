const test = require('node:test');
const assert = require('node:assert/strict');
const { planChunks, chunkRanges } = require('../studio-chunk-plan.js');

test('eight-minute ten-stem 48 kHz stereo is bounded and frame-exact', () => {
  const frames = 480 * 48000;
  const p = planChunks({ frames, tracks: 10, budgetBytes: 1024 * 1024 });
  assert.ok(p.peakPlannedBytes <= 1024 * 1024);
  assert.ok(p.chunkCount > 1);
  let next = 0, count = 0;
  for (const r of chunkRanges(p)) {
    assert.equal(r.startFrame, next);
    assert.ok(r.frameCount > 0 && r.frameCount <= p.chunkFrames);
    next = r.endFrame;
    count++;
  }
  assert.equal(next, frames);
  assert.equal(count, p.chunkCount);
});

test('exact budget boundary and final short chunk', () => {
  const p = planChunks({ frames: 5, tracks: 1, channels: 1, budgetBytes: 24 });
  assert.equal(p.chunkFrames, 2);
  assert.deepEqual([...chunkRanges(p)].map(x => x.frameCount), [2, 2, 1]);
});

test('insufficient budget rejects before allocating', () => {
  assert.throws(() => planChunks({ frames: 1, tracks: 10, channels: 2, budgetBytes: 95 }), /Budget cannot/);
});

test('fractional, non-finite and unsafe parameters fail closed', () => {
  for (const frames of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => planChunks({ frames, tracks: 10 }));
  for (const tracks of [0, 11, NaN, 1.2])
    assert.throws(() => planChunks({ frames: 1, tracks }));
  for (const channels of [0, 3, 1.5])
    assert.throws(() => planChunks({ frames: 1, tracks: 1, channels }));
  for (const budgetBytes of [0, Infinity, -1, 1.2])
    assert.throws(() => planChunks({ frames: 1, tracks: 1, budgetBytes }));
  assert.throws(() => planChunks({ frames: 1, tracks: 1, maxChunkFrames: 16385 }));
});

test('safe integer maximum cannot overflow first range', () => {
  const p = planChunks({ frames: Number.MAX_SAFE_INTEGER, tracks: 1 });
  const first = chunkRanges(p).next().value;
  assert.equal(first.startFrame, 0);
  assert.equal(first.endFrame, p.chunkFrames);
  assert.ok(Number.isSafeInteger(p.chunkCount));
});
