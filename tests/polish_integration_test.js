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
const Auto = require('../auto-clean.js');
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
    SunoPolish: Polish, SunoAutoClean: Auto, AudioContext, addEventListener: noOp, devicePixelRatio: 1 };
  el('bits').value = '24';
  el('polishTarget').value = 'off';
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
    w.emit({ type: 'done', channels: p.channels, safetyGainDb: p.safetyGainDb,
      dynamicMaxReductionDb: p.dynamicMaxReductionDb,
      transientMaxBandBoostDb: p.transientMaxBandBoostDb,
      loudnessAfter: p.loudnessAfter, loudnessBefore: p.loudnessBefore,
      normalizationLimited: p.normalizationLimited, loudnessMessage: p.loudnessMessage });
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

function makeAutoPlan({ noisy = true, muddy = true, clipping = false } = {}) {
  const metrics = {
    peak: 0.82, rms: 0.19, flatTopEvents: clipping ? 5 : 0,
    clickLikeEvents: 0, quietTrebleWindows: noisy ? 4 : 0,
    lowMidHeavyWindows: muddy ? 5 : 0,
    sampledWindows: 8, sampledSeconds: 4
  };
  return Auto.recommend({ metrics, windows: [] });
}
async function testAutoCleanWorkflow() {
  const h = harness(); await h.open();
  assert.equal(h.el('autoClean').disabled, false, 'Auto Clean available when original is loaded and cleaning is idle');
  h.preset('punchy');
  h.el('polishTarget').value = '-14';
  h.el('autoClean').fire('click');
  const analyzer = h.last('auto-clean-worker.js');
  assert(analyzer && analyzer.messages.length === 1, 'Auto Clean must start a separate local worker');
  const samples = analyzer.messages[0].windows;
  assert(samples.length >= 1 && samples.length <= 16, 'analysis gets bounded sample windows');
  assert(samples.every(w => w.channels.length === 2 && w.channels[0].length <= 24000));
  assert.equal(h.el('autoClean').disabled, true, 'analysis button disabled during inspection');
  assert(h.el('autoStatus').textContent.includes('Analyzing'));

  const plan = makeAutoPlan({ noisy: true, muddy: true });
  const beforeCount = h.workers.filter(w => w.url === 'worker.js').length;
  analyzer.emit({ type: 'done', result: plan });
  assert.equal(analyzer.terminated, true, 'auto analyzer terminates after completing');
  assert(h.el('autoDetails').hidden === false, 'explanation becomes visible');
  assert(h.el('autoReport').textContent.includes('flat-top events'), 'diagnostic details are disclosed');
  assert.equal(h.el('denoise').checked, true, 'recommended mild static settings applied');
  assert.equal(Number(h.el('maxAttenDb').value), 4.5);
  assert.equal(Number(h.el('polishClarity').value), 25);
  assert.equal(Number(h.el('polishPresence').value), 0);
  assert.equal(Number(h.el('polishDynamics').value), 0);
  assert.equal(Number(h.el('polishTransients').value), 0, 'Auto Clean overrides risky manual transient settings');
  assert.equal(h.el('polishTarget').value, 'off', 'Auto Clean does not boost loudness automatically');
  assert.equal(h.workers.filter(w => w.url === 'worker.js').length, beforeCount + 1,
    'Auto Clean triggers re-cleaning with the new settings');
  assert.equal(h.el('autoClean').disabled, true, 'button disabled during auto cleaning');
  h.cleanDone();
  const polishJob = h.last('polish-worker.js');
  assert(polishJob && polishJob.messages.length, 'mild automatic clarity runs after cleaning finishes');
  assert.equal(polishJob.messages.at(-1).params.clarity, 25);
  h.polishDone();
  assert.equal(h.el('dlPolish').disabled, false, 'automatic Polished version is ready to export');
  assert(h.el('autoStatus').textContent.includes('finished'), 'Auto Clean marks completion');
}
async function testAutoNoOpAndClickRisk() {
  const h = harness(); await h.open();
  const engineCount = h.workers.filter(w => w.url === 'worker.js').length;
  const initialClarity = h.el('polishClarity').value;
  h.el('autoClean').fire('click');
  const analyzer = h.last('auto-clean-worker.js');
  analyzer.emit({ type: 'done', result: makeAutoPlan({ noisy: false, muddy: false, clipping: true }) });
  assert.equal(h.workers.filter(w => w.url === 'worker.js').length, engineCount,
    'clipping alone must not spawn false restorative processing');
  assert.equal(h.el('polishClarity').value, initialClarity, 'no-op preserves user settings');
  assert(h.el('autoReport').textContent.includes('cannot reconstruct damaged drum hits'),
    'flattened drums produce an honest warning');
  assert(h.el('autoStatus').textContent.includes('original remains unchanged'));
}
async function testAutoReplacementAndManualCancel() {
  const h = harness(); await h.open();
  h.el('autoClean').fire('click');
  const stale = h.last('auto-clean-worker.js');
  h.el('polishClarity').value = '40';
  h.el('polishClarity').fire('input');
  assert.equal(stale.terminated, true, 'manual control change cancels analysis');
  stale.emit({ type: 'done', result: makeAutoPlan({ noisy: true }) });
  assert.equal(Number(h.el('polishClarity').value), 40, 'obsolete auto recommendation cannot override manual choice');

  h.el('autoClean').fire('click');
  const replaced = h.last('auto-clean-worker.js');
  h.el('file').files = [{ name: 'Replacement.wav', arrayBuffer: async () => riff(70) }];
  h.el('file').fire('change');
  assert.equal(replaced.terminated, true, 'replacing source terminates in-flight Auto Clean');
  const count = h.workers.length;
  replaced.emit({ type: 'done', result: makeAutoPlan({ noisy: true }) });
  assert.equal(h.workers.length, count, 'stale analysis cannot spawn cleaning on replacement source');
  await flush();
  assert.equal(h.el('songTitle').textContent, 'Replacement');
  h.cleanDone();
  h.el('autoClean').fire('click');
  const currentAnalyzer = h.last('auto-clean-worker.js');
  currentAnalyzer.emit({ type: 'done', result: makeAutoPlan({ noisy: true, muddy: true }) });
  const beforePolish = h.workers.filter(w => w.url === 'polish-worker.js').length;
  h.el('polishClarity').value = '55'; h.el('polishClarity').fire('input');
  h.cleanDone();
  assert.equal(h.workers.filter(w => w.url === 'polish-worker.js').length, beforePolish,
    'manually edited polish parameters must cancel queued Auto Clean polishing');
}
async function testShimmerFocusAudition() {
  const h = harness(); await h.open();
  assert.equal(h.el('shimmerFocus').disabled, false,
    'Shimmer Focus is available after a source has loaded');
  h.el('shimmerFocus').fire('click');
  assert.equal(h.el('denoise').checked,false,
    'shimmer audition must bypass static noise subtraction');
  assert.equal(Number(h.el('shimmer').value),0.8);
  assert.equal(Number(h.el('shimmerMaxDb').value),6);
  assert.equal(Number(h.el('shimmerFromHz').value),6000);
  const worker = h.last('worker.js');
  assert.equal(worker.messages.at(-1).params.denoise,false);
  assert.equal(worker.messages.at(-1).params.shimmer,0.8);
  assert.equal(h.el('shimmerFocus').disabled,true,
    'audition cannot be clicked again during processing');
  h.cleanDone();
  assert.equal(h.el('dlClean').disabled,false,
    'shimmer-only processing remains exportable');
  assert(h.el('autoStatus').textContent.includes('Shimmer Focus'),
    'audition warns its purpose and comparison method');
}

async function testAutoResetCancelsQueuedDiagnosis() {
  const h = harness(); await h.open();
  h.el('denoiseStrength').value = '1.7';
  h.el('autoClean').fire('click');
  const pending = h.last('auto-clean-worker.js');
  assert(pending && pending.messages.length, 'diagnostic worker has started');
  h.el('reset').fire('click');
  assert.equal(pending.terminated, true, 'Reset terminates analysis worker');
  assert.equal(Number(h.el('denoiseStrength').value), 1,
    'Reset retains default settings instead of an obsolete recommendation');
  assert(h.el('autoStatus').textContent.includes('cancelled'),
    'status must not claim analysis is ongoing after cancellation');
  const workerCount = h.workers.length;
  pending.emit({ type: 'done', result: makeAutoPlan({ noisy: true, muddy: true }) });
  assert.equal(h.workers.length, workerCount, 'stale recommendation cannot start cleaning after Reset');
  assert.equal(Number(h.el('maxAttenDb').value), 7,
    'Reset defaults cannot be overwritten by stale Auto Clean completion');

  h.el('autoClean').fire('click');
  const aborted = h.last('auto-clean-worker.js');
  h.el('shimmer').value = '0.25';
  h.el('shimmer').fire('input');
  assert.equal(aborted.terminated, true, 'manual slider cancels new analysis');
  assert(h.el('autoStatus').textContent.includes('cancelled'),
    'manual slider cancellation clears misleading analysis-underway status');

  // Cancel the queued automatic Polish step while the current cleaning job
  // is still running; its completion must not apply the abandoned suggestion.
  h.el('autoClean').fire('click');
  h.last('auto-clean-worker.js').emit({ type: 'done',
    result: makeAutoPlan({ noisy: true, muddy: true }) });
  const polishBefore = h.workers.filter(w => w.url === 'polish-worker.js').length;
  h.el('reset').fire('click');
  assert(h.el('autoStatus').textContent.includes('cancelled'),
    'Reset cancels queued automatic Polish and reports it');
  h.cleanDone();
  assert.equal(h.workers.filter(w => w.url === 'polish-worker.js').length, polishBefore,
    'queued automatic Polish cannot execute after Reset');
}

async function testAutoAnalysisErrorRecovery() {
  const h = harness(); await h.open();
  h.el('autoClean').fire('click');
  const worker = h.last('auto-clean-worker.js');
  worker.emit({ type: 'error', message: 'Synthetic diagnostic failure' });
  assert.equal(worker.terminated, true);
  assert.equal(h.el('autoClean').disabled, false, 'failed diagnosis leaves button available');
  assert(h.el('error').textContent.includes('Auto Clean failed'));
  assert(h.el('dlClean').disabled === false, 'existing Cleaned audio stays downloadable');
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
async function testLiveLoudnessWarningOnSliderInput() {
  const h = harness(); await h.open();
  h.el('polishApply').fire('click'); h.polishDone();
  assert(!h.el('polishStatus').textContent.includes('Timeline edits can change'),
    'pristine status has no editing warning');
  h.el('secGain').value = '6';
  h.el('secGain').fire('input');
  assert(h.el('polishStatus').textContent.includes('Timeline edits can change exported loudness'),
    'warning updates during the slider gesture, before change is committed');
  h.el('secGain').fire('change');
  assert(h.el('polishStatus').textContent.includes('peak protection applies before edits'),
    'committed slider retains clipping warning');
  h.el('edUndo').fire('click');
  assert(!h.el('polishStatus').textContent.includes('Timeline edits can change'),
    'undo removes live warning when timeline becomes pristine');
}

async function testPreEditLoudnessLabel() {
  const h = harness(); await h.open();
  h.el('polishApply').fire('click'); h.polishDone();
  const baseStatus = h.el('polishStatus').textContent;
  assert(baseStatus.includes('Measured before timeline edits:'),
    'measured LUFS must be explicitly identified as pre-edit');
  assert(!baseStatus.includes('Timeline edits can change exported loudness'),
    'unedited track must not claim edits exist');

  h.el('seek').value = '500';
  h.el('seek').fire('input');
  h.el('edSplit').fire('click');
  const editedStatus = h.el('polishStatus').textContent;
  assert(editedStatus.includes('Measured before timeline edits:'),
    'post-edit status must not relabel the pre-edit meter as final loudness');
  assert(editedStatus.includes('Timeline edits can change exported loudness and may clip'),
    'after timeline edits show export-loudness and clipping warning');
  assert(editedStatus.includes('peak protection applies before edits'),
    'make peak protection boundary explicit');

  h.el('edReset').fire('click');
  assert(!h.el('polishStatus').textContent.includes('Timeline edits can change exported loudness'),
    'resetting edits must remove the edit-specific warning');
}

async function testLoudnessPresetAndExport() {
  const h = harness(); await h.open();
  h.el('polishTarget').value = '-18';
  h.el('polishTarget').fire('change');
  assert.equal(h.el('polishPreset').value, 'custom',
    'loudness change creates a Custom preset');
  h.el('polishApply').fire('click');
  const job = h.last('polish-worker.js').messages.at(-1);
  assert.equal(job.params.targetLufs, -18, 'loudness target sent to processing worker');
  h.polishDone();
  assert(h.el('metaPolish').textContent.includes('-18 LUFS target'),
    'desired target shown in Polished metadata');
  assert.equal(h.el('dlPolish').disabled, false);
  h.el('polishTarget').value = '-16';
  h.el('polishTarget').fire('change');
  assert.equal(h.el('dlPolish').disabled, true,
    'changing target invalidates outdated Polished download');
}

async function testExperimentalTransientPreviewAndExport() {
  const h = harness(); await h.open();
  assert.equal(Number(h.el('polishTransients').value), 0,
    'Natural preset keeps experimental transients off by default');
  h.preset('punchy');
  assert.equal(Number(h.el('polishTransients').value), 35,
    'Punchy preset opts into moderate attack enhancement');
  h.el('polishApply').fire('click');
  const worker = h.last('polish-worker.js');
  assert.equal(worker.messages.at(-1).params.transients, 35,
    'worker receives transient intensity');
  h.polishDone();
  assert.equal(h.el('dlPolish').disabled, false);
  assert(h.el('metaPolish').textContent.includes('transients 35%'),
    'Polished metadata explicitly identifies transient processing');
  h.el('bits').value = 'mp3-320';
  h.el('dlPolish').fire('click');
  const pending = h.last('export-worker.js');
  assert(pending.messages.length, 'new Polished MP3 export starts');
  h.el('polishTransients').value = '0';
  h.el('polishTransients').fire('input');
  assert.equal(h.el('polishPreset').value, 'custom');
  assert.equal(h.el('dlPolish').disabled, true,
    'changing transient intensity invalidates old Polished output');
  pending.emit({ type: 'done', bytes: new Uint8Array([4]), peak: 0.4 });
  assert.equal(h.downloads.length, 0,
    'stale transient preset must not finish in-flight export');
}

async function testDynamicsPresetAndExport() {
  const h = harness(); await h.open();
  h.preset('clear');
  assert.equal(Number(h.el('polishDynamics').value), 15, 'Clear preset includes gentle compression');
  h.el('polishDynamics').value = '65';
  h.el('polishDynamics').fire('input');
  assert.equal(h.el('polishPreset').value, 'custom', 'changing dynamics makes a Custom preset');
  h.el('polishApply').fire('click');
  const worker = h.last('polish-worker.js');
  assert.equal(worker.messages[0].params.dynamics, 65, 'dynamics amount sent to worker');
  h.polishDone();
  assert.equal(h.el('dlPolish').disabled, false, 'dynamic Polished version downloadable');
  assert(h.el('metaPolish').textContent.includes('dynamics 65%'),
    'applied dynamics amount disclosed beside output');
  h.el('dlPolish').fire('click');
  assert.deepEqual(h.downloads, ['Synthetic - Polished.wav']);
  h.el('polishDynamics').value = '20';
  h.el('polishDynamics').fire('input');
  assert.equal(h.el('dlPolish').disabled, true,
    'changing dynamics disables stale Polished export until re-applied');
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
  await testAutoCleanWorkflow();
  await testAutoNoOpAndClickRisk();
  await testAutoReplacementAndManualCancel();
  await testAutoAnalysisErrorRecovery();
  await testAutoResetCancelsQueuedDiagnosis();
  await testShimmerFocusAudition();
  await testOverlappingSourceReadsAndWorkers();
  await testDynamicsPresetAndExport();
  await testExperimentalTransientPreviewAndExport();
  await testLoudnessPresetAndExport();
  await testPreEditLoudnessLabel();
  await testLiveLoudnessWarningOnSliderInput();
  await testExportRace();
  await testModeChoice(false);
  await testModeChoice(true);
  await testRecleanTransitions();
  await testExportsAndReplacement();
  console.log('PASS: actual app.js overlapping source reads, old worker messages, stale exports, mode choice, automatic cleaning, dynamics, transients, loudness targets, cleaning transitions, edits and replacement.');
})().catch(err => { console.error(err); process.exitCode = 1; });
