#!/usr/bin/env node
/* GS SunoShimmerFree command line v2
 *
 * Runs the same engine as the web page on a file from disk. WAV files are
 * read directly. Any other format (MP3, FLAC, M4A, OGG) is decoded with
 * ffmpeg, which must be installed and on the PATH.
 *
 *   node cli.js "My Song.mp3" [--out folder] [--bits 24]
 *        [--format wav|mp3|both] [--mp3-bitrate 192|256|320]
 *        [--shimmer 0.6] [--shimmer-max-db 6] [--shimmer-from 4000]
 *        [--no-static] [--strength 1] [--max-cut 7] [--quiet 12] [--bass 350]
 *
 * Writes Clean and Removed tracks in the selected format(s), plus a report.
 * WAV remains the default.
 *
 * Version history
 *   v1  First release.
 *   v2  Optional MP3 output, using the same local encoder as the page.
 */
'use strict';
var fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
var engine = require('./engine.js'), wav = require('./wav.js');

var FLAGS = {
  '--shimmer': 'shimmer', '--shimmer-max-db': 'shimmerMaxDb', '--shimmer-from': 'shimmerFromHz',
  '--strength': 'denoiseStrength', '--max-cut': 'maxAttenDb', '--quiet': 'quietPct', '--bass': 'bassHz'
};

function main(argv) {
  var input = null, outDir = null, bits = 24, format = 'wav', bitrate = 320, params = {};
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--out') outDir = argv[++i];
    else if (a === '--bits') bits = Number(argv[++i]);
    else if (a === '--format') format = argv[++i];
    else if (a === '--mp3-bitrate') bitrate = Number(argv[++i]);
    else if (a === '--no-static') params.denoise = false;
    else if (FLAGS[a]) params[FLAGS[a]] = Number(argv[++i]);
    else if (a.indexOf('--') === 0) throw new Error('Unknown option ' + a);
    else input = a;
  }
  if (!input) throw new Error('Give an audio file: node cli.js "My Song.wav"');
  if (['wav', 'mp3', 'both'].indexOf(format) < 0) throw new Error('--format must be wav, mp3 or both.');
  if ([192, 256, 320].indexOf(bitrate) < 0) throw new Error('--mp3-bitrate must be 192, 256 or 320.');
  if ([16, 24, 32].indexOf(bits) < 0) throw new Error('--bits must be 16, 24 or 32.');
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
  if (format !== 'wav' && audio.channels.length > 2) throw new Error('MP3 supports mono or stereo. Use --format wav to keep all channels.');

  var t0 = Date.now(), last = -1;
  var res = engine.process(audio.channels, audio.sampleRate, params, {
    progress: function (f, stage) {
      var pct = Math.floor(f * 20) * 5;
      if (pct !== last) { last = pct; process.stderr.write('\r' + stage + ' ' + pct + '%   '); }
    }
  });
  process.stderr.write('\n');
  fs.mkdirSync(outDir, { recursive: true });
  var written = [];
  [['Clean', res.clean], ['Removed', res.removed]].forEach(function (entry) {
    var base = path.join(outDir, title + ' - ' + entry[0]);
    if (format !== 'mp3') {
      fs.writeFileSync(base + '.wav', Buffer.from(wav.encodeWav(entry[1], audio.sampleRate, bits)));
      written.push(base + '.wav');
    }
    if (format !== 'wav') {
      var encoded = require('./mp3.js').encodeMp3(entry[1], audio.sampleRate, bitrate);
      fs.writeFileSync(base + '.mp3', encoded.bytes);
      written.push(base + '.mp3');
      if (encoded.peak >= 1) process.stderr.write('Warning: ' + entry[0] + ' clipped during MP3 export. Lower its level or use 32-bit float WAV.\n');
    }
  });
  var text = 'Source: ' + path.basename(input) + (tmp ? ' (decoded with ffmpeg)' : '') + '\n' + res.report.text +
    '\nOutput: ' + format + (format !== 'wav' ? ', MP3 target ' + bitrate + ' kilobits/second' : '') +
    '\nProcessing and export time: ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s\n';
  fs.writeFileSync(path.join(outDir, title + ' - report.txt'), text);
  console.log(text);
  console.log('Wrote:\n  ' + written.join('\n  '));
}

try { main(process.argv.slice(2)); } catch (e) { console.error('Error: ' + e.message); process.exit(1); }
