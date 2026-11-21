// Pure, frame-exact timeline geometry. No audio allocation, decoding or mutation.
function integer(value, label, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) throw new RangeError(`Invalid ${label}`);
  return value;
}
function add(a, b) {
  if (a > Number.MAX_SAFE_INTEGER - b) throw new RangeError('Timeline frame overflow');
  return a + b;
}
export function createTimeline({ sampleRate, durationFrames, tracks }) {
  integer(sampleRate, 'sample rate', 1);
  integer(durationFrames, 'duration frames');
  if (!Array.isArray(tracks) || tracks.length > 10) throw new RangeError('Invalid tracks');
  const ids = new Set();
  const normalized = tracks.map((track) => {
    if (!track || typeof track !== 'object' || typeof track.id !== 'string' || !track.id || ids.has(track.id))
      throw new TypeError('Invalid or duplicate track identifier');
    ids.add(track.id);
    const startFrame = integer(track.startFrame, 'start frame');
    const sourceStartFrame = integer(track.sourceStartFrame, 'source start frame');
    const frameCount = integer(track.frameCount, 'frame count', 1);
    const sourceFrames = integer(track.sourceFrames, 'source frames');
    if (add(startFrame, frameCount) > durationFrames || add(sourceStartFrame, frameCount) > sourceFrames)
      throw new RangeError('Track region outside timeline or source');
    return Object.freeze({ id: track.id, startFrame, sourceStartFrame, frameCount, sourceFrames });
  });
  return Object.freeze({ sampleRate, durationFrames, tracks: Object.freeze(normalized) });
}
export function mapTimelineWindow(timeline, { startFrame, frameCount }) {
  integer(startFrame, 'window start');
  integer(frameCount, 'window length', 1);
  const endFrame = add(startFrame, frameCount);
  if (endFrame > timeline.durationFrames) throw new RangeError('Window outside timeline');
  return Object.freeze(timeline.tracks.map(track => {
    const overlapStart = Math.max(startFrame, track.startFrame);
    const overlapEnd = Math.min(endFrame, track.startFrame + track.frameCount);
    if (overlapStart >= overlapEnd) return Object.freeze({ id: track.id, silent: true });
    return Object.freeze({ id: track.id, silent: false,
      outputOffsetFrames: overlapStart - startFrame,
      sourceStartFrame: track.sourceStartFrame + overlapStart - track.startFrame,
      frameCount: overlapEnd - overlapStart });
  }));
}
