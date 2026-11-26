// Local-only bounded interleaved audio metering. No samples retained.
export const MAX_METER_FRAMES = 16384;
export function createMeter(channels) {
  if (channels !== 1 && channels !== 2) throw new RangeError('channels must be 1 or 2');
  return Object.freeze({ channels, frames: 0, peak: 0, sumSquares: 0, clippedSamples: 0 });
}
export function measureChunk(previous, samples) {
  if (!previous || !Object.isFrozen(previous) || ![1, 2].includes(previous.channels) ||
      !Number.isSafeInteger(previous.frames) || previous.frames < 0 ||
      !Number.isFinite(previous.peak) || previous.peak < 0 ||
      !Number.isFinite(previous.sumSquares) || previous.sumSquares < 0 ||
      !Number.isSafeInteger(previous.clippedSamples) || previous.clippedSamples < 0) {
    throw new TypeError('invalid meter state');
  }
  if (!(samples instanceof Float32Array) || samples.length === 0 ||
      samples.length % previous.channels !== 0 ||
      samples.length / previous.channels > MAX_METER_FRAMES) {
    throw new RangeError('invalid bounded interleaved chunk');
  }
  const frames = samples.length / previous.channels;
  if (!Number.isSafeInteger(previous.frames + frames) ||
      !Number.isSafeInteger(previous.clippedSamples + samples.length)) {
    throw new RangeError('meter counter overflow');
  }
  let peak = previous.peak, sumSquares = previous.sumSquares, clippedSamples = previous.clippedSamples;
  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    if (!Number.isFinite(value)) throw new RangeError('nonfinite audio');
    const magnitude = Math.abs(value);
    peak = Math.max(peak, magnitude);
    sumSquares += value * value;
    if (magnitude >= 1) clippedSamples++;
  }
  if (!Number.isFinite(sumSquares)) throw new RangeError('meter overflow');
  return Object.freeze({ channels: previous.channels, frames: previous.frames + frames, peak, sumSquares, clippedSamples });
}
export function summarizeMeter(state) {
  const checked = createMeter(state?.channels);
  if (!Object.isFrozen(state) || !Number.isSafeInteger(state.frames) || state.frames < 0 ||
      !Number.isFinite(state.sumSquares) || state.sumSquares < 0 ||
      !Number.isFinite(state.peak) || state.peak < 0 ||
      !Number.isSafeInteger(state.clippedSamples) || state.clippedSamples < 0 ||
      state.clippedSamples > state.frames * checked.channels) throw new TypeError('invalid meter state');
  return Object.freeze({ frames: state.frames, peak: state.peak,
    rms: state.frames ? Math.sqrt(state.sumSquares / state.frames / state.channels) : 0,
    clippedSamples: state.clippedSamples });
}
