/* GS SunoShimmerFree edit engine v1
 *
 * Non-destructive editing for the page. An edit is a list of sections, each
 * a stretch of the source audio with its own volume and fades:
 *   { s: first source sample, e: source sample after the last,
 *     g: volume in dB, fi: fade-in length in samples, fo: fade-out length }
 * Sections play back to back. Cutting removes a stretch of the timeline,
 * so the sections either side become neighbours. All operations return a
 * new list and never change the one passed in, which makes undo a stack.
 *
 * Gain envelope inside a section (envK):
 *   - the section volume, ramped over 10 ms from the previous section's
 *     volume when the two are continuous audio with different volumes, so
 *     a volume change does not click;
 *   - quarter-sine fade in and fade out;
 *   - a 4 ms declick fade wherever the audio jumps (both sides of a cut,
 *     and the ends of a cropped track), so splices do not click.
 * The same function drives export (render) and playback (curve), so what
 * plays is what downloads.
 *
 * Version history
 *   v1  First release: split, cut, keep only, make section, section volume
 *       and fades, declick at joins, render, playback curves.
 */
(function (root) {
  'use strict';

  var VERSION = '1';
  var DECLICK_S = 0.004, RAMP_S = 0.01;
  var GAIN_MIN = -60, GAIN_MAX = 12;

  function seg(s, e, g, fi, fo) { return { s: s, e: e, g: g || 0, fi: fi || 0, fo: fo || 0 }; }
  function len(x) { return x.e - x.s; }
  function clone(segs) { return segs.map(function (x) { return seg(x.s, x.e, x.g, x.fi, x.fo); }); }
  function initial(n) {
    if (!(n > 0)) throw new Error('Cannot edit empty audio.');
    return [seg(0, n, 0, 0, 0)];
  }
  function total(segs) { var t = 0; for (var i = 0; i < segs.length; i++) t += len(segs[i]); return t; }
  function startOf(segs, i) { var t = 0; for (var j = 0; j < i; j++) t += len(segs[j]); return t; }
  function isPristine(segs, n) {
    return segs.length === 1 && segs[0].s === 0 && segs[0].e === n && !segs[0].g && !segs[0].fi && !segs[0].fo;
  }
  function clampT(segs, t) { return Math.max(0, Math.min(total(segs), Math.round(t))); }

  // edited sample t -> section index and offset inside it (t on a boundary maps to the later section)
  function locate(segs, t) {
    var acc = 0;
    for (var i = 0; i < segs.length; i++) {
      var l = len(segs[i]);
      if (t < acc + l) return { i: i, k: Math.max(0, t - acc) };
      acc += l;
    }
    var last = segs.length - 1;
    return { i: last, k: len(segs[last]) };
  }
  // edited sample -> source sample
  function toSource(segs, t) { var p = locate(segs, clampT(segs, t)); return segs[p.i].s + p.k; }
  // source sample -> edited sample; inside a removed stretch it snaps to the next kept audio
  function fromSource(segs, src) {
    var acc = 0;
    for (var i = 0; i < segs.length; i++) {
      var x = segs[i];
      if (src >= x.s && src < x.e) return acc + (src - x.s);
      if (src < x.s) return acc;
      acc += len(x);
    }
    return acc;
  }
  // stretches of the source that no section uses, sorted
  function removedRanges(segs, n) {
    var kept = segs.map(function (x) { return [x.s, x.e]; }).sort(function (a, b) { return a[0] - b[0]; });
    var out = [], pos = 0;
    for (var i = 0; i < kept.length; i++) {
      if (kept[i][0] > pos) out.push([pos, kept[i][0]]);
      pos = Math.max(pos, kept[i][1]);
    }
    if (pos < n) out.push([pos, n]);
    return out;
  }

  function splitAt(segs, t) {
    var out = clone(segs);
    t = clampT(out, t);
    var p = locate(out, t), x = out[p.i], L = len(x);
    if (p.k <= 0 || p.k >= L) return out;
    var a = seg(x.s, x.s + p.k, x.g, Math.min(x.fi, p.k), 0);
    var b = seg(x.s + p.k, x.e, x.g, 0, Math.min(x.fo, L - p.k));
    out.splice(p.i, 1, a, b);
    return out;
  }
  // index of the section that starts exactly at t (t must be on a boundary)
  function boundaryIndex(segs, t) {
    var acc = 0;
    for (var i = 0; i < segs.length; i++) { if (acc >= t) return i; acc += len(segs[i]); }
    return segs.length;
  }
  function range(segs, a, b) {
    a = clampT(segs, a); b = clampT(segs, b);
    if (b < a) { var tmp = a; a = b; b = tmp; }
    return [a, b];
  }
  function cut(segs, a, b) {
    var r = range(segs, a, b);
    if (r[1] - r[0] < 1) return clone(segs);
    if (r[0] === 0 && r[1] === total(segs)) throw new Error('That would cut the whole track.');
    var out = splitAt(splitAt(segs, r[0]), r[1]);
    var i0 = boundaryIndex(out, r[0]), i1 = boundaryIndex(out, r[1]);
    out.splice(i0, i1 - i0);
    return out;
  }
  function crop(segs, a, b) {
    var r = range(segs, a, b);
    if (r[1] - r[0] < 1) throw new Error('Select some audio to keep first.');
    var out = splitAt(splitAt(segs, r[0]), r[1]);
    return out.slice(boundaryIndex(out, r[0]), boundaryIndex(out, r[1]));
  }
  // split at both ends of the range; returns the new list and the first section inside it
  function section(segs, a, b) {
    var r = range(segs, a, b);
    if (r[1] - r[0] < 1) throw new Error('Select some audio first.');
    var out = splitAt(splitAt(segs, r[0]), r[1]);
    return { segs: out, index: boundaryIndex(out, r[0]), count: boundaryIndex(out, r[1]) - boundaryIndex(out, r[0]) };
  }
  // change volume (dB) and fades (samples) of section i; fades are clamped so they fit
  function setSection(segs, i, p) {
    if (i < 0 || i >= segs.length) throw new Error('No section ' + (i + 1) + '.');
    var out = clone(segs), x = out[i], L = len(x);
    if (p.g !== undefined) x.g = Math.max(GAIN_MIN, Math.min(GAIN_MAX, Number(p.g) || 0));
    if (p.fi !== undefined) x.fi = Math.max(0, Math.min(Math.round(p.fi), L - x.fo));
    if (p.fo !== undefined) x.fo = Math.max(0, Math.min(Math.round(p.fo), L - x.fi));
    return out;
  }

  function contiguousBefore(segs, i) { return i > 0 && segs[i - 1].e === segs[i].s; }
  function contiguousAfter(segs, i) { return i < segs.length - 1 && segs[i + 1].s === segs[i].e; }

  // precompute what the envelope of section i needs
  function setup(segs, i, n, sr) {
    var x = segs[i], c = {
      L: len(x), g: Math.pow(10, x.g / 20), fi: x.fi, fo: x.fo,
      D: Math.max(1, Math.round(DECLICK_S * sr)), R: Math.max(1, Math.round(RAMP_S * sr)),
      ramp: false, gp: 1,
      dIn: i === 0 ? x.s > 0 : !contiguousBefore(segs, i),
      dOut: i === segs.length - 1 ? x.e < n : !contiguousAfter(segs, i)
    };
    if (contiguousBefore(segs, i) && segs[i - 1].g !== x.g) { c.ramp = true; c.gp = Math.pow(10, segs[i - 1].g / 20); }
    c.head = Math.max(c.ramp ? c.R : 0, c.fi, c.dIn ? c.D : 0);
    c.tail = Math.max(c.fo, c.dOut ? c.D : 0);
    return c;
  }
  // envelope value at sample k of the section (0 <= k <= L)
  function envK(c, k) {
    var v = (c.ramp && k < c.R) ? c.gp + (c.g - c.gp) * k / c.R : c.g;
    if (c.fi > 0 && k < c.fi) v *= Math.sin(Math.PI / 2 * k / c.fi);
    if (c.fo > 0 && k > c.L - c.fo) v *= Math.sin(Math.PI / 2 * (c.L - k) / c.fo);
    if (c.dIn && k < c.D) v *= k / c.D;
    if (c.dOut && k > c.L - c.D) v *= (c.L - k) / c.D;
    return v;
  }
  function envAt(segs, i, k, n, sr) { return envK(setup(segs, i, n, sr), k); }
  // true when the envelope is flat from k to the end of the section
  function flatFrom(c, k) { return k >= c.head && c.tail === 0; }
  // envelope sampled evenly from k0 to the section end, for Web Audio setValueCurveAtTime
  function curve(c, k0, step) {
    var span = c.L - k0, m = Math.max(2, Math.ceil(span / step) + 1), out = new Float32Array(m);
    for (var j = 0; j < m; j++) out[j] = envK(c, k0 + span * j / (m - 1));
    return out;
  }

  // apply the edit to source channels; returns new channels and the output peak
  function render(channels, segs, sampleRate) {
    var n = channels[0].length, C = channels.length, L = total(segs), out = [], peak = 0, ch;
    for (ch = 0; ch < C; ch++) out.push(new Float32Array(L));
    var T = 0;
    for (var i = 0; i < segs.length; i++) {
      var x = segs[i], c = setup(segs, i, n, sampleRate), l = c.L;
      if (x.s < 0 || x.e > n || l <= 0) throw new Error('Section ' + (i + 1) + ' lies outside the audio.');
      for (var k = 0; k < l; k++) {
        var e = envK(c, k);
        for (ch = 0; ch < C; ch++) {
          var v = channels[ch][x.s + k] * e;
          out[ch][T + k] = v;
          var a = v < 0 ? -v : v;
          if (a > peak) peak = a;
        }
      }
      T += l;
    }
    return { channels: out, peak: peak };
  }

  var api = {
    VERSION: VERSION, initial: initial, total: total, len: len, startOf: startOf, isPristine: isPristine,
    locate: locate, toSource: toSource, fromSource: fromSource, removedRanges: removedRanges,
    splitAt: splitAt, cut: cut, crop: crop, section: section, setSection: setSection,
    setup: setup, envK: envK, envAt: envAt, flatFrom: flatFrom, curve: curve, render: render,
    GAIN_MIN: GAIN_MIN, GAIN_MAX: GAIN_MAX
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShimmerEdit = api;
})(typeof self !== 'undefined' ? self : this);
