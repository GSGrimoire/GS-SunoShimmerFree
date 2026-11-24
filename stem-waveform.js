/* Bounded waveform extrema and RMS. The caller owns each PCM window. */
(function (root) {
  'use strict';

  const MAX_COLUMNS = 1024;
  const accumulators = new WeakMap();

  function create(frameCount, sampleRate, columns, channelCount) {
    if (!Number.isSafeInteger(columns) || columns < 1 || columns > MAX_COLUMNS) {
      throw new RangeError('Waveform column count must be between 1 and ' + MAX_COLUMNS + '.');
    }
    if (!Number.isSafeInteger(frameCount) || frameCount < 1 ||
        !Number.isSafeInteger(frameCount * columns)) {
      throw new RangeError('Invalid waveform source frame count.');
    }
    if (!Number.isSafeInteger(sampleRate) || sampleRate < 1) {
      throw new RangeError('Invalid waveform sample rate.');
    }
    if (channelCount !== 1 && channelCount !== 2) {
      throw new RangeError('Waveforms require mono or stereo PCM.');
    }

    const progress = { written: 0, squares: new Float64Array(columns) };
    const state = Object.freeze({
      frames: frameCount,
      sampleRate,
      columns,
      channelCount,
      min: new Float32Array(columns),
      max: new Float32Array(columns),
      rms: new Float64Array(columns),
      counts: new Float64Array(columns),
      get written() { return progress.written; }
    });
    accumulators.set(state, progress);
    return state;
  }

  function append(state, planes, offset) {
    const progress = accumulators.get(state);
    if (!progress) throw new TypeError('Invalid waveform summary.');
    if (!Array.isArray(planes) || planes.length !== state.channelCount ||
        !(planes[0] instanceof Float32Array) ||
        (state.channelCount === 2 && !(planes[1] instanceof Float32Array))) {
      throw new TypeError('Expected planar Float32 PCM matching the waveform channel count.');
    }

    const left = planes[0];
    const right = planes[1];
    const length = left.length;
    if (!Number.isSafeInteger(offset) || offset !== progress.written ||
        !length || (right && right.length !== length) || length > state.frames - offset) {
      throw new RangeError('Waveform PCM must be a nonempty contiguous passage within the source.');
    }

    // Validate before changing the summary so a rejected passage can be retried.
    for (let i = 0; i < length; i++) {
      if (!Number.isFinite(left[i]) || (right && !Number.isFinite(right[i]))) {
        throw new RangeError('Waveform samples must be finite.');
      }
    }

    let cursor = offset;
    const end = offset + length;
    while (cursor < end) {
      // Column j owns frames in [ceil(j*N/C), ceil((j+1)*N/C)).
      const column = Math.floor(cursor * state.columns / state.frames);
      const stop = Math.min(end, Math.ceil((column + 1) * state.frames / state.columns));
      const count = state.counts[column];
      let low = count ? state.min[column] : left[cursor - offset];
      let high = count ? state.max[column] : low;
      let squares = progress.squares[column];
      for (let i = cursor - offset; i < stop - offset; i++) {
        const sample = left[i];
        low = Math.min(low, sample);
        high = Math.max(high, sample);
        squares += sample * sample;
        if (right) {
          const other = right[i];
          low = Math.min(low, other);
          high = Math.max(high, other);
          squares += other * other;
        }
      }
      const total = count + stop - cursor;
      state.min[column] = low;
      state.max[column] = high;
      state.counts[column] = total;
      state.rms[column] = Math.sqrt(squares / (total * state.channelCount));
      progress.squares[column] = squares;
      cursor = stop;
    }
    progress.written = end;
    return state;
  }

  const api = { create, append, MAX_COLUMNS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SunoStemWaveform = api;
})(typeof self !== 'undefined' ? self : globalThis);
