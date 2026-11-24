'use strict';

const assert = require('node:assert/strict');
const { append, create, MAX_COLUMNS } = require('../stem-waveform.js');

// Compute the reference directly from all samples assigned to each column.
const left = Float32Array.of(0, .25, .5, 0, 0, 0, -.125, -.25, -2, -2.5, -.5, 1, 1.25);
const right = Float32Array.of(.75, .75, .125, 0, 0, 0, -.25, -.5, -1.25, -.25, -.75, 2, .5);
const columns = 5;
const summary = create(left.length, 48000, columns, 2);
assert.equal(summary.frames, left.length);
assert.equal(summary.sampleRate, 48000);
assert.equal(summary.columns, columns);
assert.equal(summary.written, 0);
const missingRight = [left];
missingRight.length = 2;
assert.throws(() => append(summary, missingRight, 0), /Float32/);
assert.throws(() => append(summary, [left, right.subarray(0, 1)], 0), /nonempty contiguous/);

for (const [start, end] of [[0, 2], [2, 7], [7, 8], [8, 13]]) {
  assert.equal(append(summary, [left.subarray(start, end), right.subarray(start, end)], start), summary);
  assert.equal(summary.written, end);
}

for (let column = 0; column < columns; column++) {
  const values = [];
  for (let frame = 0; frame < left.length; frame++) {
    if (Math.floor(frame * columns / left.length) === column) values.push(left[frame], right[frame]);
  }
  assert.equal(summary.min[column], Math.min(...values));
  assert.equal(summary.max[column], Math.max(...values));
  assert.equal(summary.rms[column], Math.sqrt(values.reduce((sum, x) => sum + x ** 2, 0) / values.length));
  assert.equal(summary.counts[column], values.length / 2);
}
assert.equal(summary.rms[1], 0, 'silent frames stay silent in the summary');
assert.equal(summary.min[3], -2.5, 'finite overrange peaks are preserved');
assert.equal(summary.max[4], 2, 'positive overrange peaks are preserved');

const sparse = create(2, 44100, 4, 1);
const source = Float32Array.of(.5, -.25);
append(sparse, [source], 0);
source.fill(0);
assert.deepEqual([...sparse.min], [.5, 0, -.25, 0]);
assert.deepEqual([...sparse.max], [.5, 0, -.25, 0]);
assert.deepEqual([...sparse.counts], [1, 0, 1, 0]);

const bounded = create(4, 48000, 2, 1);
append(bounded, [Float32Array.of(.75)], 0);
assert.throws(() => append(bounded, [Float32Array.of(.5)], 0), /contiguous/);
assert.throws(() => append(bounded, [Float32Array.of(.5)], 2), /contiguous/);
assert.throws(() => append(bounded, [new Float32Array(0)], 1), /nonempty/);
assert.throws(() => append(bounded, [new Float32Array(4)], 1), /within the source/);
assert.throws(() => append(bounded, [Float32Array.of(.5, NaN)], 1), /finite/);
assert.throws(() => append(bounded, [new Float64Array(1)], 1), /Float32/);
assert.equal(bounded.written, 1, 'rejected appends leave progress intact');
assert.deepEqual([...bounded.min], [.75, 0], 'rejected appends leave extrema intact');
assert.deepEqual([...bounded.counts], [1, 0], 'rejected appends leave counts intact');
append(bounded, [Float32Array.of(.25, -.5, -.5)], 1);
assert.equal(bounded.written, 4, 'a valid retry completes the waveform');
assert.deepEqual([...bounded.max], [.75, -.5]);

assert.equal(create(48000 * 480, 48000, MAX_COLUMNS, 2).min.length, MAX_COLUMNS);
assert.throws(() => create(48000, 48000, MAX_COLUMNS + 1, 2), /column count/);
assert.throws(() => create(Number.MAX_SAFE_INTEGER, 48000, 2, 2), /frame count/);
assert.throws(() => create(0, 48000, 2, 1), /frame count/);
assert.throws(() => create(48000, 0, 2, 1), /sample rate/);
assert.throws(() => create(48000, 48000, 2, 3), /mono or stereo/);

console.log('Stem waveform tests passed: bounded columns, stereo peaks and RMS, silence, overrange and contiguous input.');
