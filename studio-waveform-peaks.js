// Local-only, frame-exact, bounded waveform display summary. No audio retention.
export const MAX_WAVEFORM_FRAMES = 16384;
export const MAX_WAVEFORM_BUCKETS = 8192;

export function createWaveformPeaks({ channels, framesPerBucket, maxBuckets = MAX_WAVEFORM_BUCKETS }) {
  if (!Number.isSafeInteger(channels) || channels < 1 || channels > 2) throw new RangeError('channels');
  if (!Number.isSafeInteger(framesPerBucket) || framesPerBucket < 1) throw new RangeError('framesPerBucket');
  if (!Number.isSafeInteger(maxBuckets) || maxBuckets < 1 || maxBuckets > MAX_WAVEFORM_BUCKETS) throw new RangeError('maxBuckets');
  return Object.freeze({ channels, framesPerBucket, maxBuckets, nextFrame: 0, buckets: Object.freeze([]), pending: Object.freeze({ count: 0, min: 1, max: -1 }) });
}

export function appendWaveformPeaks(state, interleaved, startFrame) {
  if (!state || !Object.isFrozen(state) || !Array.isArray(state.buckets) || !Object.isFrozen(state.buckets) || !state.pending || !Object.isFrozen(state.pending)) throw new TypeError('state');
  const { channels, framesPerBucket, maxBuckets, nextFrame } = state;
  if (![channels, framesPerBucket, maxBuckets, nextFrame].every(Number.isSafeInteger) || channels < 1 || channels > 2 || framesPerBucket < 1 || maxBuckets < 1 || maxBuckets > MAX_WAVEFORM_BUCKETS || nextFrame < 0) throw new TypeError('state dimensions');
  if (!(interleaved instanceof Float32Array) || interleaved.length % channels !== 0) throw new TypeError('interleaved');
  const frames = interleaved.length / channels;
  if (frames === 0 || frames > MAX_WAVEFORM_FRAMES || !Number.isSafeInteger(startFrame) || startFrame !== nextFrame || !Number.isSafeInteger(nextFrame + frames)) throw new RangeError('frame sequence');
  if (!Number.isSafeInteger(state.pending.count) || state.pending.count < 0 || state.pending.count >= framesPerBucket || !Number.isFinite(state.pending.min) || !Number.isFinite(state.pending.max)) throw new TypeError('pending');
  const required = Math.floor((state.pending.count + frames) / framesPerBucket);
  if (state.buckets.length + required > maxBuckets) throw new RangeError('waveform capacity');
  for (const sample of interleaved) if (!Number.isFinite(sample) || Math.abs(sample) > 1) throw new RangeError('sample');
  const buckets = state.buckets.slice();
  let { count, min, max } = state.pending;
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const sample = interleaved[frame * channels + channel];
      min = Math.min(min, sample);
      max = Math.max(max, sample);
    }
    if (++count === framesPerBucket) {
      buckets.push(Object.freeze({ min, max }));
      count = 0; min = 1; max = -1;
    }
  }
  return Object.freeze({ channels, framesPerBucket, maxBuckets, nextFrame: nextFrame + frames, buckets: Object.freeze(buckets), pending: Object.freeze({ count, min, max }) });
}

export function finishWaveformPeaks(state) {
  if (!state || !Object.isFrozen(state) || !Array.isArray(state.buckets) || !Object.isFrozen(state.buckets) || !state.pending || !Object.isFrozen(state.pending)) throw new TypeError('state');
  const { count, min, max } = state.pending;
  if (!Number.isSafeInteger(count) || count < 0 || count >= state.framesPerBucket || !Number.isFinite(min) || !Number.isFinite(max)) throw new TypeError('pending');
  const buckets = state.buckets.slice();
  if (count) {
    if (buckets.length >= state.maxBuckets) throw new RangeError('waveform capacity');
    buckets.push(Object.freeze({ min, max }));
  }
  return Object.freeze({ frameCount: state.nextFrame, framesPerBucket: state.framesPerBucket, buckets: Object.freeze(buckets) });
}
