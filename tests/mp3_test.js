#!/usr/bin/env node
// Decode real exports with ffmpeg; do not merely check a filename or mocked encoder.
'use strict';
var assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
var cp = require('child_process'), mp3 = require('../mp3.js'), wav = require('../wav.js'), edits = require('../edit.js');
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shimmer-mp3-test-'));
var root = path.resolve(__dirname, '..');

function signal(sr, seconds, count) {
  return Array.from({ length: count }, function (_, c) {
    return Float32Array.from({ length: Math.round(sr * seconds) }, function (_, i) {
      var t = i / sr;
      return 0.25 * Math.sin(2 * Math.PI * ((350 + 600 * c) * t + 100 * t * t));
    });
  });
}
function probe(file) {
  return JSON.parse(cp.execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], { encoding: 'utf8' })).streams[0];
}
function decode(file) {
  var raw = cp.execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'f32le', '-c:a', 'pcm_f32le', '-'], { maxBuffer: 16 * 1024 * 1024 });
  return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}
function checkExport(name, channels, sr, bitrate, expectedRate, expectedBitrate) {
  var before = channels.map(function (c) { return c.slice(); }), progress = [];
  var result = mp3.encodeMp3(channels, sr, bitrate, function (f) { progress.push(f); });
  channels.forEach(function (c, i) { assert.deepEqual(c, before[i], 'input must remain usable for playback'); });
  assert.equal(progress[progress.length - 1], 1);
  var file = path.join(dir, name + '.mp3'); fs.writeFileSync(file, result.bytes);
  var info = probe(file), samples = decode(file);
  assert.equal(info.codec_name, 'mp3');
  assert.equal(info.channels, channels.length);
  assert.equal(Number(info.sample_rate), expectedRate || sr);
  assert.equal(Number(info.bit_rate), expectedBitrate || bitrate * 1000);
  var seconds = samples.length / info.channels / Number(info.sample_rate), original = channels[0].length / sr;
  assert.ok(seconds >= original - 0.005 && seconds < original + 0.2, name + ': duration including padding');
  assert.ok(samples.every(Number.isFinite));
  console.log('PASS ' + name);
  return { samples: samples, result: result, info: info };
}
function similarity(samples, expected, count) {
  // MP3 adds delay. Find it, then compare both channels through cuts and fades.
  var best = Infinity, bestDelay = 0;
  for (var delay = 0; delay < 1800; delay++) {
    var error = 0;
    for (var i = 0; i < expected[0].length; i += 29) {
      error += Math.pow(samples[(i + delay) * count] - expected[0][i], 2);
    }
    if (error < best) { best = error; bestDelay = delay; }
  }
  for (var c = 0; c < count; c++) {
    var error = 0, power = 0;
    for (var i = 0; i < expected[c].length; i++) {
      error += Math.pow(samples[(i + bestDelay) * count + c] - expected[c][i], 2);
      power += expected[c][i] * expected[c][i];
    }
    assert.ok(Math.sqrt(error / power) < 0.06, 'decoded edits/channel ' + c + ' differ from the rendered audio');
  }
}

try {
  cp.execFileSync('ffmpeg', ['-version']); cp.execFileSync('ffprobe', ['-version']);
  [192, 256, 320].forEach(function (rate) { checkExport('stereo-44100-' + rate, signal(44100, 0.7, 2), 44100, rate); });
  checkExport('mono-48000', signal(48000, 0.7, 1), 48000, 320);
  checkExport('high-rate-96000', signal(96000, 0.7, 2), 96000, 320, 48000);
  checkExport('low-rate-22050', signal(22050, 0.7, 1), 22050, 320, 22050, 160000);
  var silent = checkExport('silence', [new Float32Array(44100)], 44100, 192);
  assert.ok(silent.samples.every(function (v) { return Math.abs(v) < 1e-7; }));
  checkExport('short-tail', signal(44100, 0.001, 2), 44100, 320);
  var sr = 44100, input = signal(sr, 2.5, 2);
  var segs = edits.cut(edits.initial(input[0].length), 22050, 44100);
  segs = edits.setSection(segs, 0, { g: -6, fi: 4400, fo: 2200 });
  var rendered = edits.render(input, segs, sr).channels;
  var edited = checkExport('edited-stereo', rendered, sr, 320);
  similarity(edited.samples, rendered, 2);
  assert.throws(function () { mp3.encodeMp3(signal(sr, 0.1, 3), sr, 320); }, /mono or stereo/);
  assert.throws(function () { mp3.encodeMp3([new Float32Array(0)], sr, 320); }, /nonempty/);
  assert.throws(function () { mp3.encodeMp3([new Float32Array([NaN])], sr, 320); }, /invalid audio/);
  assert.throws(function () { mp3.encodeMp3(input, sr, 123); }, /bitrate/);
  assert.throws(function () { mp3.encodeMp3(input, 0, 320); }, /sample rates/);
  var clipped = mp3.encodeMp3([Float32Array.from({ length: 1153 }, function (_, i) { return i % 2 ? 1.5 : -1.5; })], sr, 320);
  assert.equal(clipped.peak, 1.5, 'report clipping instead of wrapping integer samples');

  var source = path.join(dir, 'fixture.wav');
  fs.writeFileSync(source, Buffer.from(wav.encodeWav(signal(sr, 0.7, 2), sr, 24)));
  ['wav', 'mp3', 'both'].forEach(function (format) {
    var out = path.join(dir, format);
    var args = [path.join(root, 'cli.js'), source, '--out', out];
    if (format !== 'wav') args.push('--format', format, '--mp3-bitrate', '256');
    var run = cp.spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    ['Clean', 'Removed'].forEach(function (kind) {
      ['wav', 'mp3'].forEach(function (ext) {
        var file = path.join(out, 'fixture - ' + kind + '.' + ext);
        assert.equal(fs.existsSync(file), format === 'both' || format === ext);
        if (fs.existsSync(file)) { assert.equal(probe(file).channels, 2); assert.ok(decode(file).length > 0); }
      });
    });
    assert.ok(fs.existsSync(path.join(out, 'fixture - report.txt')));
    console.log('PASS command line ' + format);
  });
  ['Clean', 'Removed'].forEach(function (kind) {
    var name = 'fixture - ' + kind + '.wav';
    assert.deepEqual(fs.readFileSync(path.join(dir, 'wav', name)), fs.readFileSync(path.join(dir, 'both', name)), 'adding MP3 must not change WAV samples');
  });
  console.log('All MP3 and format regression checks passed.');
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
