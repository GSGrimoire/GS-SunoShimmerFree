// Pure, allocation-bounded gain automation for frame-aligned stereo/mono chunks.
// Input samples are never mutated. Fade intervals use half-open frame coordinates.
// Outside fade intervals the multiplier is 1; callers must explicitly model held attenuation.
export function applyGainEnvelope(channels, { startFrame, gain = 1, fades = [] }) {
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 2) throw new RangeError('channels');
  const frames = channels[0]?.length;
  if (!Number.isSafeInteger(frames) || frames < 1 || frames > 16384 || !channels.every(c => c instanceof Float32Array && c.length === frames)) throw new RangeError('frames');
  if (!Number.isSafeInteger(startFrame) || startFrame < 0 || startFrame > Number.MAX_SAFE_INTEGER - frames) throw new RangeError('startFrame');
  if (!Number.isFinite(gain) || gain < 0 || gain > 4) throw new RangeError('gain');
  if (!Array.isArray(fades) || fades.length > 64) throw new RangeError('fades');
  let previousEnd = -1;
  for (const fade of fades) {
    if (!fade || !Number.isSafeInteger(fade.startFrame) || !Number.isSafeInteger(fade.endFrame) || fade.startFrame < 0 || fade.endFrame <= fade.startFrame || !Number.isFinite(fade.from) || !Number.isFinite(fade.to) || fade.from < 0 || fade.to < 0 || fade.from > 1 || fade.to > 1 || fade.startFrame < previousEnd) throw new RangeError('fade');
    previousEnd = fade.endFrame;
  }
  const output = channels.map(c => new Float32Array(frames));
  let index = 0;
  for (let i = 0; i < frames; i++) {
    const frame = startFrame + i;
    while (index < fades.length && frame >= fades[index].endFrame) index++;
    const fade = fades[index];
    let factor = 1;
    if (fade && frame >= fade.startFrame && frame < fade.endFrame) {
      const length = fade.endFrame - fade.startFrame;
      const position = frame - fade.startFrame;
      // Last included sample reaches the endpoint; a one-frame fade uses 'to'.
      factor = length === 1 ? fade.to : fade.from + (fade.to - fade.from) * (position / (length - 1));
    }
    for (let ch = 0; ch < channels.length; ch++) {
      const sample = channels[ch][i];
      if (!Number.isFinite(sample)) throw new RangeError('non-finite sample');
      const value = sample * gain * factor;
      if (!Number.isFinite(value)) throw new RangeError('non-finite result');
      output[ch][i] = value === 0 ? 0 : value;
    }
  }
  return output;
}
