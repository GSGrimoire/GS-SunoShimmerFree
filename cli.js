#!/usr/bin/env node
/* GS SunoShimmerFree command line v1
 *
 * Runs the same engine as the web page on a file from disk. WAV files are
 * read directly. Any other format (MP3, FLAC, M4A, OGG) is decoded with
 * ffmpeg, which must be installed and on the PATH.
 *
 *   node cli.js "My Song.mp3" [--out folder] [--bits 24]
 *        [--shimmer 0.6] [--shimmer-max-db 6] [--shimmer-from 4000]
 *        [--no-static] [--strength 1] [--max-cut 7] [--quiet 12] [--bass 350]
 *
 * Writes "<name> - Clean.wav", "<name> - Removed.wav" and
 * "<name> - report.txt".
 *
 * Version history
 *   v1  First release.
 */
'use strict';
var fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
var engine = require('./engine.js'), wav = require('./wav.js');

var FLAGS = {
  '--shimmer': 'shimmer', '--shimmer-max-db': 'shimmerMaxDb', '--shimmer-from': 'shimmerFromHz',
  '--strength': 'denoiseStrength', '--max-cut': 'maxAttenDb', '--quiet': 'quietPct', '--bass': 'bassHz'
};

function main(argv) {
  var input = null, outDir = null, bits = 24, params = {};
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--out') outDir = argv[++i];
    else if (a === '--bits') bits = Number(argv[++i]);
    else if (a === '--no-static') params.denoise = false;
    else if (FLAGS[a]) params[FLAGS[a]] = Number(argv[++i]);
    else if (a.indexOf('--') === 0) throw new Error('Unknown option ' + a);
    else input = a;
  }
  if (!input) throw new Error('Give an audio file: node cli.js "My Song.wav"');
  if (!fs.existsSync(input)) throw new Error('File not found: ' + input);
  var title = path.basename(input).replace(/\.[^.]+$/, '');
  outDir = outDir || path.dirname(input);

  var src = input, tmp = null;
  if (!/\.wav$/i.test(input)) {
    tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ssf-')), 'decoded.wav');
    var r = cp.spawnSync('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', input, '-map', '0:a:0', '-c:a', 'pcm_f32le', tmp]);
    if (r.error || r.status !== 0) {
      throw new Error('Could not decode ' + input + ' with ffmpeg. Install ffmpeg or convert the file to WAV first.' +
        (r.stderr ? '\n' + r.stderr.toString() : ''));
    }
    src = tmp;
  }
  var buf = fs.readFileSync(src);
  var audio = wav.decodeWav(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  if (tmp) fs.rmSync(path.dirname(tmp), { recursive: true, force: true });

  var t0 = Date.now(), last = -1;
  var res = engine.process(audio.channels, audio.sampleRate, params, {
    progress: function (f, stage) {
      var pct = Math.floor(f * 20) * 5;
      if (pct !== last) { last = pct; process.stderr.write('\r' + stage + ' ' + pct + '%   '); }
    }
  });
  process.stderr.write('\n');
  fs.mkdirSync(outDir, { recursive: true });
  var clean = path.join(outDir, title + ' - Clean.wav'), removed = path.join(outDir, title + ' - Removed.wav');
  fs.writeFileSync(clean, Buffer.from(wav.encodeWav(res.clean, audio.sampleRate, bits)));
  fs.writeFileSync(removed, Buffer.from(wav.encodeWav(res.removed, audio.sampleRate, bits)));
  var text = 'Source: ' + path.basename(input) + (tmp ? ' (decoded with ffmpeg)' : '') + '\n' + res.report.text +
    '\nProcessing time: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s\n';
  fs.writeFileSync(path.join(outDir, title + ' - report.txt'), text);
  console.log(text);
  console.log('Wrote:\n  ' + clean + '\n  ' + removed);
}

try { main(process.argv.slice(2)); } catch (e) { console.error('Error: ' + e.message); process.exit(1); }
