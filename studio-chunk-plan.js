/* Pure local memory-budget planning; no audio decoding or retention. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SunoStudioChunkPlan = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DEFAULT_BUDGET_BYTES = 32 * 1024 * 1024;
  const MAX_TRACKS = 10, MAX_CHANNELS = 2, MAX_CHUNK_FRAMES = 16384;
  function integer(name, value, min, max = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new RangeError(name + ' must be a safe integer in [' + min + ', ' + max + ']');
    return value;
  }
  // Reserves one decoded input chunk per stem, a mix accumulation chunk, and
  // one output chunk, each Float32. Actual renderers must enforce other allocations.
  function planChunks({ frames, tracks, channels = 2, budgetBytes = DEFAULT_BUDGET_BYTES, maxChunkFrames = MAX_CHUNK_FRAMES }) {
    integer('frames', frames, 1);
    integer('tracks', tracks, 1, MAX_TRACKS);
    integer('channels', channels, 1, MAX_CHANNELS);
    integer('budgetBytes', budgetBytes, 1);
    integer('maxChunkFrames', maxChunkFrames, 1, MAX_CHUNK_FRAMES);
    const bytesPerFrame = (tracks + 2) * channels * Float32Array.BYTES_PER_ELEMENT;
    const capacity = Math.min(maxChunkFrames, Math.floor(budgetBytes / bytesPerFrame));
    if (capacity < 1) throw new RangeError('Budget cannot hold one frame of all inputs and output');
    return Object.freeze({ frames, tracks, channels, budgetBytes, bytesPerFrame, chunkFrames: capacity,
      chunkCount: Math.ceil(frames / capacity), peakPlannedBytes: capacity * bytesPerFrame });
  }
  function* chunkRanges(plan) {
    if (!plan || !Number.isSafeInteger(plan.frames) || !Number.isSafeInteger(plan.chunkFrames) ||
        plan.frames < 1 || plan.chunkFrames < 1) throw new TypeError('Invalid chunk plan');
    for (let start = 0; start < plan.frames;) {
      const count = Math.min(plan.chunkFrames, plan.frames - start);
      yield Object.freeze({ startFrame: start, frameCount: count, endFrame: start + count });
      start += count;
    }
  }
  return Object.freeze({ DEFAULT_BUDGET_BYTES, MAX_TRACKS, MAX_CHANNELS, MAX_CHUNK_FRAMES, planChunks, chunkRanges });
});
