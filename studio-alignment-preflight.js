// Local-only alignment admission for a shared sample-frame timeline.
const MAX_TRACKS = 10;
const MAX_FRAMES = Number.MAX_SAFE_INTEGER;
function integer(value, label, min = 0) {
  if (!Number.isSafeInteger(value) || value < min) throw new RangeError(`Invalid ${label}`);
  return value;
}
export function preflightAlignedStems(stems, { maxTracks = MAX_TRACKS } = {}) {
  if (!Array.isArray(stems) || stems.length === 0 || stems.length > integer(maxTracks, 'maxTracks', 1) || stems.length > MAX_TRACKS) throw new RangeError('Invalid stem count');
  const ids = new Set();
  let rate;
  let maxEnd = 0;
  const tracks = stems.map((stem) => {
    if (!stem || typeof stem !== 'object' || Array.isArray(stem)) throw new TypeError('Invalid stem');
    const { id, sampleRate, channels, decodedFrames, offsetFrames, alignmentVerified } = stem;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ids.has(id)) throw new RangeError('Invalid or duplicate stem id');
    ids.add(id);
    integer(sampleRate, 'sampleRate', 1);
    if (sampleRate > 384000) throw new RangeError('Unsupported sampleRate');
    integer(channels, 'channels', 1);
    if (channels > 2) throw new RangeError('Unsupported channel count');
    integer(decodedFrames, 'decodedFrames', 1);
    integer(offsetFrames, 'offsetFrames');
    if (alignmentVerified !== true) throw new Error('Unverified source alignment');
    if (rate === undefined) rate = sampleRate;
    if (sampleRate !== rate) throw new Error('Resampling required before alignment');
    const end = offsetFrames + decodedFrames;
    if (!Number.isSafeInteger(end) || end > MAX_FRAMES) throw new RangeError('Timeline frame overflow');
    maxEnd = Math.max(maxEnd, end);
    return Object.freeze({ id, sampleRate, channels, decodedFrames, offsetFrames, endFrame: end });
  });
  return Object.freeze({ sampleRate: rate, totalFrames: maxEnd, tracks: Object.freeze(tracks) });
}
