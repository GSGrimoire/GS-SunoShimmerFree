/* Browser-state integration regression tests for actual app.js (no npm dependencies).
 * Run: node tests/polish_integration_test.js
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Ed = require('../edit.js');
const Polish = require('../polish.js');
const appCode = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const modes = ['original', 'clean', 'polish', 'removed'];

function harness() {
  const workers = [], downloads = [], wavCaptures = [], nodes = new Map();
  const noOp = () => {};
  const gradient = { addColorStop: noOp };
  const canvasContext = {
    setTransform: noOp, clearRect: noOp, fillRect: noOp, beginPath: noOp,
    moveTo: noOp, lineTo: noOp, quadraticCurveTo: noOp, closePath: noOp,
    arc: noOp, fill: noOp, stroke: noOp, fillText: noOp, drawImage: noOp,
    putImageData: noOp, createLinearGradient: () => gradient
  };
  function classes() { return { add: noOp, remove: noOp, toggle: noOp, contains: () => false }; }
  class Element {
    constructor(id) {
      this.id = id || '';
      this.value = '0';
      this.min = '0'; this.max = '100';
      this.style = { setProperty: noOp };
      this.classList = classes();
      this.hidden = false; this.disabled = false; this.checked = false;
      this.textContent = ''; this.innerHTML = ''; this.className = '';
      this.width = 640; this.height = 160; this.clientWidth = 640;
      this.scrollLeft = 0; this.scrollWidth = 640;
      this.listeners = {};
      this.parentNode = { querySelector: () => new Element('output') };
    }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    fire(name, extra) {
      const event = Object.assign({ target: this, preventDefault: noOp }, extra || {});
      for (const fn of this.listeners[name] || []) fn.call(this, event);
    }
    setAttribute(name, value) { this[name] = value; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 160, right: 640, bottom: 160 }; }
    getContext() { return canvasContext; }
    closest() { return { classList: classes() }; }
    append() {}
    appendChild() {}
    contains() { return false; }
    remove() {}
    click() { if (this.id === 'download-link') downloads.push(this.download); else this.fire('click'); }
    setPointerCapture() {}
  }
  for (const id of ids) nodes.set(id, new Element(id));
  function el(id) { if (!nodes.has(id)) throw new Error('Missing HTML ID: ' + id); return nodes.get(id); }
  const radio = Object.fromEntries(modes.map(m => [m, new Element('radio-' + m)]));
  for (const m of modes) radio[m].value = m;
  const tile = Object.fromEntries(modes.map(m => [m, { className: 'tile tile-' + m, innerHTML: '' }]));
  const document = {
    body: { classList: classes(), appendChild: noOp },
    getElementById: el,
    querySelectorAll: sel => sel === 'input[name="mode"]' ? modes.map(m => radio[m]) : [],
    querySelector: sel => {
      let match = sel.match(/^input\[name="mode"\]\[value="([^"]+)"\]$/);
      if (match) return radio[match[1]];
      match = sel.match(/^\.track\[data-mode="([^"]+)"\] \.tile$/);
      return match ? tile[match[1]] : null;
    },
    createElement: tag => new Element(tag === 'a' ? 'download-link' : tag),
    addEventListener: noOp
  };
  class AudioBuffer {
    constructor(opts) {
      this.length = opts.length;
      this.numberOfChannels = opts.numberOfChannels;
      this.sampleRate = opts.sampleRate;
      this.duration = this.length / this.sampleRate;
      this.data = Array.from({ length: this.numberOfChannels }, () => new Float32Array(this.length));
    }
    copyToChannel(samples, ch) { this.data[ch].set(samples); }
    getChannelData(ch) { return this.data[ch]; }
  }
  class AudioContext {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = {}; }
    createGain() {
      return { gain: { value: 1, setTargetAtTime: noOp, setValueCurveAtTime: noOp },
        connect: noOp, disconnect: noOp };
    }
    createBufferSource() {
      return { buffer: null, connect: noOp, start: noOp, stop: noOp };
    }
    createBuffer(c, n, sr) { return new AudioBuffer({ numberOfChannels: c, length: n, sampleRate: sr }); }
    resume() { this.state = 'running'; }
  }
  class Worker {
    constructor(url) { this.url = url; this.terminated = false; this.messages = []; workers.push(this); }
    postMessage(message) { this.messages.push(message); }
    emit(data) { if (this.onmessage) this.onmessage({ data }); }
    terminate() { this.terminated = true; }
  }
  const source = new Float32Array(48000);
  for (let i = 0; i < source.length; i++) source[i] = 0.15 * Math.sin(i * 0.04);
  const wav = {
    decodeWav: ab => {
      const bytes = new Uint8Array(ab), marker = bytes[4];
      const input = marker === 70 || marker === 10 ?
        Float32Array.from({ length: source.length }, () => marker / 100) : source.slice();
      return { channels: [input.slice(), input.slice()], sampleRate: 48000, bits: 16, float: false };
    },
    encodeWav: channels => {
      wavCaptures.push(channels.map(c => c[0]));
      return new Uint8Array([82, 73, 70, 70]).buffer;
    }
  };
  const Engine = {
    VERSION: '1', DEFAULTS: { denoise: true, denoiseStrength: 1,
      maxAttenDb: 7, bassHz: 350, quietPct: 12, shimmer: 0.6,
      shimmerMaxDb: 6, shimmerFromHz: 4000 }
  };
  const window = { ShimmerEngine: Engine, ShimmerEdit: Ed, WavCodec: wav,
    SunoPolish: Polish, AudioContext, addEventListener: noOp, devicePixelRatio: 1 };
  el('bits').value = '24';
  el('loaded').hidden = true;
  el('transport').hidden = true;
  el('denoise').checked = true;
  const context = { window, document, Worker, AudioBuffer, Float32Array, Uint8Array,
    Uint8ClampedArray, ArrayBuffer, Blob, URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: noOp },
    requestAnimationFrame: noOp, setTimeout: noOp, clearTimeout: noOp, console };
  vm.runInNewContext(appCode, context, { filename: 'app.js', timeout: 5000 });
  const last = url => [...workers].reverse().find(w => w.url === url);
  function cleanDone() {
    const w = last('worker.js');
    assert(w && w.messages.length, 'cleaning worker started');
    const input = w.messages.at(-1).channels;
    w.emit({ type: 'done', clean: input.map(c => c.slice()),
      removed: input.map(c => new Float32Array(c.length)),
      report: { text: 'Synthetic clean' } });
  }
  function polishDone() {
    const w = last('polish-worker.js');
    assert(w && w.messages.length, 'polish worker started');
    const job = w.messages.at(-1);
    const p = Polish.process(job.channels, job.sampleRate, job.params);
    w.emit({ type: 'done', channels: p.channels, safetyGainDb: p.safetyGainDb });
  }
  function choose(mode) { radio[mode].checked = true; radio[mode].fire('change'); }
  function preset(name) { el('polishPreset').value = name; el('polishPreset').fire('change'); }
  async function open() {
    const riff = new Uint8Array(32);
    riff.set([82, 73, 70, 70], 0);
    const fakeFile = { name: 'Synthetic.wav', arrayBuffer: async () => riff.buffer };
    el('file').files = [fakeFile];
    el('file').fire('change');
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert(last('worker.js'), 'loading a WAV starts a cleaning worker');
    cleanDone();
    assert.equal(el('polishApply').disabled, false, 'Polish ready after clean');
  }
  return { el, workers, downloads, wavCaptures, last, open, preset, choose, cleanDone, polishDone,
    radio, window, source };
}
async function testExportRace() {
  const h = harness(); await h.open();
  h.el('polishApply').fire('click'); h.polishDone();
  assert.equal(h.el('dlPolish').disabled, false, 'first polished output downloadable');
  h.el('bits').value = 'mp3-320';
  h.el('dlPolish').fire('click');
  const stale = h.last('export-worker.js');
  assert(stale && stale.messages.length, 'existing polished MP3 export started');
  h.preset('forward');
  assert.equal(h.el('dlPolish').disabled, true, 'changed preset marks prior output stale');
  h.el('polishApply').fire('click');
  assert.equal(stale.terminated, true, 'starting re-polish cancels prior export');
  assert.equal(h.el('dlPolish').disabled, true, 'polished download blocked during processing');
  const count = h.workers.length;
  h.el('dlPolish').fire('click'); // Forced event tests guard even if disabled is bypassed.
  assert.equal(h.workers.length, count, 'forced click cannot spawn stale export');
  stale.emit({ type: 'done', bytes: new Uint8Array([1]), peak: 0.4 });
  assert.equal(h.downloads.length, 0, 'late obsolete export completion cannot download');
  h.polishDone();
  assert.equal(h.el('dlPolish').disabled, false, 'new polished version is downloadable');
  h.el('dlPolish').fire('click');
  const current = h.last('export-worker.js');
  assert.notEqual(current, stale);
  current.emit({ type: 'done', bytes: new Uint8Array([2]), peak: 0.3 });
  assert.deepEqual(h.downloads, ['Synthetic - Polished.mp3'],
    'only current preset can finish a polished export');
}
async function testModeChoice(playing) {
  const h = harness(); await h.open();
  if (playing) h.el('play').fire('click');
  h.el('polishApply').fire('click');
  h.choose('original');
  h.polishDone();
  assert.equal(h.el('nowMode').textContent, 'Original',
    'explicit mode choice must survive completion ' + (playing ? 'while playing' : 'while paused'));
  assert.equal(h.radio.original.checked, true);
  if (playing) assert.equal(h.el('play').classList !== null, true);
  h.preset('forward');
  h.el('polishApply').fire('click');
  h.polishDone();
  assert.equal(h.el('nowMode').textContent, 'Polished',
    'without intervening user choice the new version should auto-preview');
}
async function testRecleanTransitions() {
  const h = harness(); await h.open();
  h.el('polishApply').fire('click'); h.polishDone();
  h.preset('forward');
  assert.equal(h.el('polishApply').disabled, false, 're-polish actionable before re-clean');
  h.el('denoiseStrength').value = '1.5';
  h.el('denoiseStrength').fire('input');
  h.el('apply').fire('click');
  assert.equal(h.el('polishApply').disabled, true, 're-clean disables Polish immediately');
  assert.equal(h.el('dlPolish').disabled, true, 're-clean invalidates prior Polished version');
  h.last('worker.js').emit({ type: 'error', message: 'Synthetic failure' });
  assert.equal(h.el('polishApply').disabled, false,
    'clean failure restores Polish availability for the retained Cleaned buffer');
  h.el('apply').fire('click');
  assert.equal(h.el('polishApply').disabled, true);
  h.cleanDone();
  assert.equal(h.el('polishApply').disabled, false, 're-clean success re-enables Polish');
}
async function testExportsAndReplacement() {
  const h = harness(); await h.open();
  h.el('polishApply').fire('click'); h.polishDone();
  h.el('dlPolish').fire('click');
  assert.deepEqual(h.downloads, ['Synthetic - Polished.wav'], 'pristine polished WAV exports');
  h.el('seek').value = '500';
  h.el('seek').fire('input');
  h.el('edSplit').fire('click');
  h.el('bits').value = 'mp3-320';
  h.el('bits').fire('change');
  h.el('dlPolish').fire('click');
  const w = h.last('export-worker.js');
  assert(w.messages.at(-1).segs, 'edited Polished MP3 export receives an edit snapshot');
  w.emit({ type: 'done', bytes: new Uint8Array([3]), peak: 0.3 });
  assert(h.downloads.includes('Synthetic - Polished (edited).mp3'),
    'edited polished MP3 exported');
  h.preset('forward');
  h.el('polishApply').fire('click');
  const old = h.last('polish-worker.js');
  const riff = new Uint8Array(32); riff.set([82, 73, 70, 70], 0);
  h.el('file').files = [{ name: 'Replacement.wav', arrayBuffer: async () => riff.buffer }];
  h.el('file').fire('change');
  old.emit({ type: 'done', channels: [h.source.slice(), h.source.slice()], safetyGainDb: 0 });
  assert.equal(h.el('dlPolish').disabled, true, 'old worker result cannot restore Polished for replaced source');
  await new Promise(resolve => setImmediate(resolve));
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function riff(marker) {
  const a = new Uint8Array(32);
  a.set([82, 73, 70, 70], 0); a[4] = marker || 0;
  return a.buffer;
}
async function flush() {
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
}
async function testOverlappingSourceReadsAndWorkers() {
  const h = harness();
  const slowA = deferred();
  h.el('file').files = [{ name: 'Source-A.wav', arrayBuffer: () => slowA.promise }];
  h.el('file').fire('change');
  h.el('file').files = [{ name: 'Source-B.wav', arrayBuffer: async () => riff(70) }];
  h.el('file').fire('change');
  await flush();
  const b = h.last('worker.js');
  assert(b && b.messages.length, 'B cleaning worker starts before A read completes');
  assert(Math.abs(b.messages[0].channels[0][0] - 0.7) < 1e-6, 'B worker receives B samples');
  const count = h.workers.length;
  slowA.resolve(riff(10));
  await flush();
  assert.equal(h.workers.length, count, 'late A read must not launch another worker');
  assert.equal(b.terminated, false, 'late A read must not cancel B worker');
  assert.equal(h.el('songTitle').textContent, 'Source-B', 'B title remains active');
  h.cleanDone();
  h.el('dlClean').fire('click');
  assert(Math.abs(h.wavCaptures.at(-1)[0] - 0.7) < 1e-6,
    'downloaded Cleaned samples correspond to Source-B, not late Source-A');

  // A terminated cleaning worker may still have a queued event in flight.
  const slowC = deferred();
  h.el('file').files = [{ name: 'Source-C.wav', arrayBuffer: () => slowC.promise }];
  h.el('file').fire('change');
  assert.equal(b.terminated, true, 'B worker is terminated on C selection');
  b.emit({ type: 'done', clean: [Float32Array.of(0.7), Float32Array.of(0.7)],
    removed: [Float32Array.of(0), Float32Array.of(0)], report: { text: 'stale' } });
  b.emit({ type: 'error', message: 'Old worker failed' });
  b.emit({ type: 'progress', fraction: 1, stage: 'Old worker progress' });
  assert.equal(h.el('songTitle').textContent, 'Source-C', 'stale worker cannot change source');
  assert.equal(h.el('error').hidden, true, 'stale worker error ignored');
  assert.equal(h.el('busyText').textContent, 'Opening Source-C.wav',
    'stale worker progress cannot obscure current load');
  slowC.resolve(riff(10));
  await flush();
  const c = h.last('worker.js');
  assert.notEqual(c, b);
  assert(Math.abs(c.messages[0].channels[0][0] - 0.1) < 1e-6,
    'C worker receives C samples');
  h.cleanDone();
  h.el('dlClean').fire('click');
  assert(Math.abs(h.wavCaptures.at(-1)[0] - 0.1) < 1e-6,
    'current export corresponds to Source-C');

  const slowD = deferred();
  h.el('file').files = [{ name: 'Source-D.wav', arrayBuffer: () => slowD.promise }];
  h.el('file').fire('change');
  h.el('file').files = [{ name: 'Source-E.wav', arrayBuffer: async () => riff(70) }];
  h.el('file').fire('change');
  await flush();
  slowD.reject(new Error('Old read error'));
  await flush();
  assert.equal(h.el('songTitle').textContent, 'Source-E');
  assert.equal(h.el('error').hidden, true, 'late A/D failure must not show error on newer source');
  assert.equal(h.el('busy').hidden, false, 'obsolete read failure must not hide current busy indicator');
}

(async () => {
  await testOverlappingSourceReadsAndWorkers();
  await testExportRace();
  await testModeChoice(false);
  await testModeChoice(true);
  await testRecleanTransitions();
  await testExportsAndReplacement();
  console.log('PASS: actual app.js overlapping source reads, old worker messages, stale exports, mode choice, cleaning transitions, edits and replacement.');
})().catch(err => { console.error(err); process.exitCode = 1; });
