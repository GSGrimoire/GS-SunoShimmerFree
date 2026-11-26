// Local, deterministic, non-destructive stereo placement for bounded planar PCM.
export function panChunk(left, right, pan, {maxFrames = 16384} = {}) {
  if (!(left instanceof Float32Array) || !(right instanceof Float32Array) || left.length !== right.length || left.length > 16384 || left.length > maxFrames || !Number.isSafeInteger(maxFrames) || maxFrames < 1) throw new RangeError('invalid bounded stereo chunk');
  if (!Number.isFinite(pan) || pan < -1 || pan > 1) throw new RangeError('pan must be within [-1,1]');
  // Balance stereo rather than folding left into right: preserve channel identity.
  const lg = pan > 0 ? (pan === 1 ? 0 : Math.cos(pan * Math.PI / 2)) : 1;
  const rg = pan < 0 ? (pan === -1 ? 0 : Math.cos(-pan * Math.PI / 2)) : 1;
  const outL = new Float32Array(left.length), outR = new Float32Array(right.length);
  for (let i=0; i<left.length; i++) {
    if (!Number.isFinite(left[i]) || !Number.isFinite(right[i])) throw new RangeError('nonfinite PCM sample');
    outL[i] = left[i] * lg; outR[i] = right[i] * rg;
  }
  return Object.freeze({left: outL, right: outR});
}
