import { mapTimelineWindow } from './studio-frame-timeline.js';

// Render one bounded timeline window. readFrames must return interleaved, exact-frame
// Float32 samples from an already verified, aligned source. No full-file decoding here.
// readFrames must accept { signal } and release its own decoder resources on abort.
// A noncooperative reader may remain active after the renderer rejects.
export async function renderTimelineChunk(timeline, window, { channels, readFrames, mixChunk, signal, isCurrent = () => true, gains = {} }) {
  if (channels !== 1 && channels !== 2) throw new RangeError('Invalid channel count');
  if (typeof readFrames !== 'function' || typeof mixChunk !== 'function' || typeof isCurrent !== 'function') throw new TypeError('Invalid renderer dependencies');
  if (!window || !Number.isSafeInteger(window.frameCount) || window.frameCount < 1 || window.frameCount > 16384) throw new RangeError('Invalid render window');
  const spans = mapTimelineWindow(timeline, window);
  const cancelled = () => new Error('Stale or cancelled render');
  const check = () => { if (signal?.aborted || !isCurrent()) throw cancelled(); };
  check();
  const stems = [];
  for (const span of spans) {
    check();
    const samples = new Float32Array(window.frameCount * channels);
    if (!span.silent) {
      // Race against abort to settle promptly even if the source reader stalls.
      // Promise.race observes late rejections but cannot stop a reader that
      // ignores the signal or release its internally owned allocations.
      let onAbort;
      const abortPromise = signal && new Promise((_, reject) => {
        onAbort = () => reject(cancelled());
        signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        check();
        const read = Promise.resolve().then(() => {
          check();
          return readFrames(span.id, span.sourceStartFrame, span.frameCount, channels, { signal });
        });
        const part = await (abortPromise ? Promise.race([read, abortPromise]) : read);
        check();
        if (!(part instanceof Float32Array) || part.length !== span.frameCount * channels) throw new RangeError('Source frame count mismatch');
        const offset = span.outputOffsetFrames * channels;
        // Copy only after validating every sample. Never mutate the source array.
        for (let i = 0; i < part.length; i++) if (!Number.isFinite(part[i])) throw new RangeError('Non-finite source sample');
        samples.set(part, offset);
      } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort);
      }
    }
    const gain = Object.hasOwn(gains, span.id) ? gains[span.id] : 1;
    if (!Number.isFinite(gain) || gain < 0 || gain > 4) throw new RangeError('Invalid track gain');
    stems.push({ id: span.id, samples, gain });
  }
  check();
  // Mixer is the bounded PCM kernel from PR #23, injected because that
  // unmerged dependency is not installed on this branch.
  const result = mixChunk(stems, window.frameCount, channels);
  check();
  return result;
}
