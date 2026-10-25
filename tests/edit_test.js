#!/usr/bin/env node
/* GS SunoShimmerFree edit engine tests v1
 *
 * Runs fixed edit sequences through edit.js, checks the invariants that must
 * hold after every operation, and writes each rendered result plus its
 * section list so tests/edit_reference.py can render the same edit
 * independently and compare.
 *
 *   node tests/edit_test.js input.wav outdir
 *
 * Version history
 *   v1  First release.
 */
'use strict';
var fs = require('fs'), path = require('path');
var E = require('../edit.js'), wav = require('../wav.js');

var input = process.argv[2], outDir = process.argv[3];
if (!input || !outDir) { console.error('Usage: node tests/edit_test.js input.wav outdir'); process.exit(1); }
var buf = fs.readFileSync(input);
var audio = wav.decodeWav(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
var sr = audio.sampleRate, n = audio.channels[0].length;
fs.mkdirSync(outDir, { recursive: true });

var failures = 0;
function check(cond, msg) { if (!cond) { failures++; console.log('  FAIL: ' + msg); } }
function invariants(segs, label) {
  check(segs.length > 0, label + ': no sections');
  segs.forEach(function (x, i) {
    check(x.s >= 0 && x.e <= n && x.e > x.s, label + ': section ' + i + ' out of range');
    check(x.fi >= 0 && x.fo >= 0 && x.fi + x.fo <= x.e - x.s, label + ': section ' + i + ' fades do not fit');
  });
  // no source sample used twice
  var r = segs.map(function (x) { return [x.s, x.e]; }).sort(function (a, b) { return a[0] - b[0]; });
  for (var i = 1; i < r.length; i++) check(r[i][0] >= r[i - 1][1], label + ': overlapping sections');
}

var s = function (sec) { return Math.round(sec * sr); };
var L0 = n;
var scenarios = {
  untouched: function () { return E.initial(n); },
  split_only: function () { return E.splitAt(E.splitAt(E.initial(n), s(1)), s(2.5)); },
  cut_middle: function () { return E.cut(E.initial(n), s(1.2), s(2.7)); },
  cut_start_and_end: function () { var x = E.cut(E.initial(n), 0, s(0.8)); return E.cut(x, E.total(x) - s(0.5), E.total(x)); },
  crop: function () { return E.crop(E.initial(n), s(0.7), s(3.9)); },
  section_volume: function () {
    var r = E.section(E.initial(n), s(1), s(2));
    return E.setSection(r.segs, r.index, { g: -9 });
  },
  section_boost_fades: function () {
    var r = E.section(E.initial(n), s(1.5), s(3));
    var x = E.setSection(r.segs, r.index, { g: 4, fi: s(0.3), fo: s(0.4) });
    x = E.setSection(x, 0, { fi: s(0.5) });
    return E.setSection(x, x.length - 1, { fo: s(1) });
  },
  everything: function () {
    var x = E.initial(n);
    x = E.setSection(x, 0, { fi: s(0.25), fo: s(0.6) });
    var r = E.section(x, s(0.9), s(1.6)); x = E.setSection(r.segs, r.index, { g: -6, fo: s(0.1) });
    x = E.cut(x, s(1.3), s(2.1));            // cut across a section boundary
    x = E.splitAt(x, s(2.2));
    x = E.setSection(x, 2, { g: 3 });
    x = E.cut(x, s(0.4), s(0.45));           // tiny cut inside a fade
    return x;
  },
  fades_clamped: function () {
    var x = E.section(E.initial(n), s(1), s(1.2));
    return E.setSection(E.setSection(x.segs, x.index, { fi: s(5) }), x.index, { fo: s(5) });
  }
};

Object.keys(scenarios).forEach(function (name) {
  var segs = scenarios[name]();
  invariants(segs, name);
  var res = E.render(audio.channels, segs, sr);
  check(res.channels[0].length === E.total(segs), name + ': output length');
  fs.writeFileSync(path.join(outDir, name + '.wav'), Buffer.from(wav.encodeWav(res.channels, sr, 32)));
  fs.writeFileSync(path.join(outDir, name + '.json'), JSON.stringify({ sampleRate: sr, n: n, segs: segs }));
  console.log(name + ': ' + segs.length + ' sections, ' + (E.total(segs) / sr).toFixed(3) + ' s');
});

// operation-level checks
var x = E.cut(E.initial(n), s(1), s(2));
check(E.total(x) === L0 - s(1), 'cut shortens by the cut length');
check(E.toSource(x, s(1)) === s(2), 'audio after a cut resumes at the cut end');
check(E.fromSource(x, s(1.5)) === s(1), 'a position inside a cut maps to the join');
check(JSON.stringify(E.removedRanges(x, n)) === JSON.stringify([[s(1), s(2)]]), 'removed ranges');
check(E.splitAt(x, 0).length === x.length, 'split at the very start does nothing');
check(E.isPristine(E.initial(n), n) && !E.isPristine(x, n), 'pristine detection');
var threw = false; try { E.cut(E.initial(n), 0, n); } catch (e) { threw = true; }
check(threw, 'cutting the whole track is refused');
var before = JSON.stringify(x); E.cut(x, 0, s(0.5)); E.setSection(x, 0, { g: 5 });
check(JSON.stringify(x) === before, 'operations never change their input');
var flat = E.setup(E.initial(n), 0, n, sr);
check(E.flatFrom(flat, 0) && E.envK(flat, 12345) === 1, 'untouched track has a flat unity envelope');

console.log(failures ? failures + ' check(s) failed' : 'All invariant checks passed');
process.exit(failures ? 1 : 0);
