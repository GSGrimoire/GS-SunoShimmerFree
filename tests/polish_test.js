/* Run: node tests/polish_test.js */
'use strict';
var assert = require('assert');
var Polish = require('../polish.js');
var sr = 48000, n = sr;
function sine(hz, amplitude) {
  var a = new Float32Array(n);
  for (var i = 0; i < n; i++) a[i] = Math.sin(2 * Math.PI * hz * i / sr) * amplitude;
  return a;
}
function rms(x) {
  var sum = 0;
  for (var i = Math.floor(sr / 4); i < x.length; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / (x.length - Math.floor(sr / 4)));
}
function ratioDb(a, b) { return 20 * Math.log10(rms(a) / rms(b)); }
var source = sine(320, 0.4);
var zero = Polish.process([source], sr, { clarity: 0, presence: 0 });
assert.notStrictEqual(zero.channels[0], source, 'bypass should copy, not mutate');
assert.deepStrictEqual(Array.from(zero.channels[0]), Array.from(source), 'bypass is transparent');
var cut = Polish.process([source], sr, { clarity: 100, presence: 0 });
assert(ratioDb(cut.channels[0], source) < -2.5, 'clarity should attenuate low mids');
var high = sine(2500, 0.25);
var boost = Polish.process([high], sr, { clarity: 0, presence: 100 });
assert(ratioDb(boost.channels[0], high) > 2.2, 'presence should boost upper mids');
var l = sine(2500, 0.8), r = sine(2500, 0.4);
var stereo = Polish.process([l, r], sr, { presence: 100 });
assert(stereo.peak <= 0.97001, 'enabled process should protect sample peaks');
for (var i = 0; i < n; i += 97) {
  assert(Math.abs(stereo.channels[0][i] - 2 * stereo.channels[1][i]) < 1e-6,
    'stereo balance should remain linked');
  assert(Number.isFinite(stereo.channels[0][i]), 'output must be finite');
}
assert(Math.abs(source[0]) < 1e-8, 'inputs must not be mutated');
assert.throws(function () { Polish.process([new Float32Array([NaN])], sr, { clarity: 50 }); }, /non-finite/);
assert.throws(function () { Polish.process([source, new Float32Array(2)], sr, {}); }, /different lengths/);
var odd = Polish.process([sine(180, 0.1)], 11025, { clarity: 30, presence: 55 });
assert(Number.isFinite(odd.peak), 'lower sample rates must work');
console.log('Sound Polish tests passed: bypass, frequency response, stereo, peaks, inputs, validation.');
