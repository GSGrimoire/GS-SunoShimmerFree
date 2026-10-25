/* GS SunoShimmerFree page logic v3
 *
 * Decodes the dropped file (WAV directly, other formats through the
 * browser's decoder at the file's own sample rate), runs the engine in a
 * worker, plays Original, Cleaned and Removed in lockstep so switching
 * keeps your place, draws the before and after spectrograms with a
 * draggable divider, edits the timeline, and writes the WAV downloads.
 *
 * Editing is non-destructive (see edit.js). Playback schedules every
 * section straight from the source buffers with its own gain envelope, so
 * edits cost no extra memory and apply to all three versions at once.
 * Downloads render the same envelope sample by sample.
 *
 * Version history
 *   v1  First release.
 *   v2  Suno-style layout: versions shown as a song list with per-row
 *       downloads, fixed player bar, gradient slider fills, upload and
 *       replace buttons reachable by keyboard, Suno-palette spectrograms,
 *       files can be dropped anywhere on the page with a full-screen
 *       overlay, number keys switch versions whatever has focus.
 *   v3  Editor: waveform of the edited timeline with sections, drag to
 *       select, split, cut, keep only, make section, section volume and
 *       fades (sliders and draggable corner handles), mark in and out,
 *       undo and redo, zoom. Playback, seek bar and downloads follow the
 *       edits; removed stretches are shaded on the spectrogram.
 */
(function () {
  'use strict';
  var PAGE_VERSION = '3';
  var Engine = window.ShimmerEngine, Wav = window.WavCodec, Ed = window.ShimmerEdit;
  var $ = function (id) { return document.getElementById(id); };
  var PARAMS = ['denoiseStrength', 'maxAttenDb', 'bassHz', 'quietPct', 'shimmer', 'shimmerMaxDb', 'shimmerFromHz'];
  var SHOW = {
    denoiseStrength: function (v) { return v.toFixed(2); },
    maxAttenDb: function (v) { return v + ' dB'; },
    bassHz: function (v) { return v + ' Hz'; },
    quietPct: function (v) { return v + '%'; },
    shimmer: function (v) { return Math.round(v * 100) + '%'; },
    shimmerMaxDb: function (v) { return v + ' dB'; },
    shimmerFromHz: function (v) { return (v / 1000).toFixed(1) + ' kHz'; }
  };
  var MODES = ['original', 'clean', 'removed'];
  var MODE_NAME = { original: 'Original', clean: 'Cleaned', removed: 'Removed' };
  var BUCKET = 256;          // samples per waveform peak
  var CURVE_STEP_S = 0.002;  // playback envelope resolution
  var MAX_ZOOM = 64, HISTORY = 200;
  var ED_HELP = 'Drag across the waveform to select. Click a section to adjust it, or drag the dots at its top corners to fade.';

  var st = {
    title: '', sr: 0, n: 0, buffers: { original: null, clean: null, removed: null },
    specs: {}, top: 0, applied: null, worker: null, busy: false, mode: 'original', split: 50,
    offset: 0, playing: false,
    segs: null, hist: [], fut: [], sel: null, sec: null, zoom: 1, peaks: {}, peakMax: {}
  };

  // ---------------- settings ----------------
  function readParams() {
    var p = { denoise: $('denoise').checked };
    PARAMS.forEach(function (k) { p[k] = Number($(k).value); });
    return p;
  }
  function writeParams(p) {
    $('denoise').checked = p.denoise;
    PARAMS.forEach(function (k) { $(k).value = p[k]; });
    refreshOutputs();
  }
  function setFill(el) {
    var min = Number(el.min), max = Number(el.max), v = Number(el.value);
    el.style.setProperty('--fill', (max > min ? 100 * (v - min) / (max - min) : 0) + '%');
  }
  function refreshOutputs() {
    PARAMS.forEach(function (k) {
      var el = $(k);
      el.parentNode.querySelector('output').textContent = SHOW[k](Number(el.value));
      setFill(el);
    });
    var on = $('denoise').checked;
    ['denoiseStrength', 'maxAttenDb', 'bassHz', 'quietPct'].forEach(function (k) { $(k).disabled = !on; });
    $('denoise').closest('.group').classList.toggle('is-off', !on);
    refreshDirty();
  }
  function sameParams(a, b) {
    if (!a || !b) return false;
    for (var k in a) if (a[k] !== b[k]) return false;
    return true;
  }
  function refreshDirty() {
    var loaded = !!st.buffers.original, dirty = loaded && !sameParams(readParams(), st.applied);
    $('apply').disabled = !loaded || !dirty || st.busy;
    $('applyNote').textContent = !loaded ? 'Upload a track to start.' :
      st.busy ? 'Cleaning with these settings.' :
      dirty && st.applied ? 'Settings changed. Clean again to hear them.' : '';
  }
  function summary(p) {
    return (p.denoise ? 'Static ' + p.maxAttenDb + ' dB' : 'Static off') + ', ' +
      (p.shimmer > 0 ? 'Shimmer ' + Math.round(p.shimmer * 100) + '%' : 'Shimmer off');
  }

  // ---------------- decoding ----------------
  function sniffRate(u8) {
    var n = u8.length;
    if (n > 21 && u8[0] === 0x66 && u8[1] === 0x4C && u8[2] === 0x61 && u8[3] === 0x43) {
      return (u8[18] << 12) | (u8[19] << 4) | (u8[20] >> 4);
    }
    var o = 0;
    if (n > 10 && u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) {
      o = 10 + (((u8[6] & 127) << 21) | ((u8[7] & 127) << 14) | ((u8[8] & 127) << 7) | (u8[9] & 127));
      if (u8[5] & 0x10) o += 10;
    }
    for (var i = o, end = Math.min(n - 4, o + 131072); i < end; i++) {
      if (u8[i] !== 0xFF || (u8[i + 1] & 0xE0) !== 0xE0) continue;
      var ver = (u8[i + 1] >> 3) & 3, layer = (u8[i + 1] >> 1) & 3, br = u8[i + 2] >> 4, sri = (u8[i + 2] >> 2) & 3;
      if (ver === 1 || layer === 0 || br === 0 || br === 15 || sri === 3) continue;
      var base = [44100, 48000, 32000][sri];
      return ver === 3 ? base : (ver === 2 ? base / 2 : base / 4);
    }
    return 0;
  }

  function makeBuffer(chans, sr) {
    var len = chans[0].length, buf;
    try { buf = new AudioBuffer({ length: len, numberOfChannels: chans.length, sampleRate: sr }); }
    catch (e) { buf = audioCtx().createBuffer(chans.length, len, sr); }
    for (var c = 0; c < chans.length; c++) buf.copyToChannel(chans[c], c);
    return buf;
  }
  function channelsOf(buf, copy) {
    var out = [];
    for (var c = 0; c < buf.numberOfChannels; c++) out.push(copy ? buf.getChannelData(c).slice() : buf.getChannelData(c));
    return out;
  }

  function loadFile(file) {
    hideError();
    stopPlayback(); st.offset = 0;
    if (st.worker) { st.worker.terminate(); st.worker = null; }
    st.buffers = { original: null, clean: null, removed: null }; st.specs = {}; st.applied = null; st.everCleaned = false;
    st.peaks = {}; st.peakMax = {};
    setModeAvailability(false); setMode('original');
    $('export').hidden = true;
    $('metaClean').textContent = 'Not cleaned yet';
    st.title = file.name.replace(/\.[^.]+$/, '') || 'Track';
    $('songTitle').textContent = st.title;
    $('nowTitle').textContent = st.title;
    $('fileLine').textContent = 'Opening ' + file.name;
    showLoaded(); showBusy('Opening ' + file.name, 0);

    file.arrayBuffer().then(function (ab) {
      var u8 = new Uint8Array(ab), isWav = u8.length > 12 && String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) === 'RIFF';
      if (isWav) {
        try {
          var d = Wav.decodeWav(ab);
          return { chans: d.channels, sr: d.sampleRate, kind: (d.float ? d.bits + '-bit float' : d.bits + '-bit') + ' WAV' };
        } catch (e) { /* unusual WAV encodings fall through to the browser decoder */ }
      }
      var sr = sniffRate(u8), guessed = !sr;
      if (!sr) sr = 48000;
      var Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!Off) throw new Error('This browser has no audio decoder. Try a current Chrome, Edge, Firefox or Safari.');
      var oc = new Off(1, 1, sr);
      return new Promise(function (res, rej) { oc.decodeAudioData(ab, res, rej); }).then(function (buf) {
        var ext = (file.name.match(/\.([^.]+)$/) || [, 'audio'])[1].toUpperCase();
        return { chans: channelsOf(buf, false), sr: sr, kind: ext + (guessed ? ', decoded at an assumed 48 kHz' : '') };
      }, function () {
        throw new Error('This browser could not decode ' + file.name + '. Convert it to WAV or MP3 and try again.');
      });
    }).then(function (d) {
      st.sr = d.sr;
      st.buffers.original = makeBuffer(d.chans, d.sr);
      var b = st.buffers.original;
      st.n = b.length;
      resetEdits();
      computePeaks('original');
      var chText = b.numberOfChannels === 1 ? 'Mono' : b.numberOfChannels === 2 ? 'Stereo' : b.numberOfChannels + ' channels';
      $('fileLine').textContent = fmtTime(b.duration) + ', ' + (d.sr / 1000) + ' kHz, ' + chText.toLowerCase() + ', ' + d.kind;
      $('metaOriginal').textContent = d.kind + ', ' + chText.toLowerCase();
      $('transport').hidden = false;
      document.body.classList.add('has-player');
      afterEdit(false);
      refreshDirty();
      runProcess();
    }).catch(function (e) {
      hideBusy();
      if (!st.buffers.original) showUpload();
      showError(e.message || String(e));
    });
  }

  // ---------------- processing ----------------
  function runProcess() {
    if (!st.buffers.original) return;
    if (st.worker) { st.worker.terminate(); st.worker = null; }
    hideError();
    var params = readParams(), sr = st.sr, chans = channelsOf(st.buffers.original, true);
    st.busy = true; refreshDirty(); showBusy('Reading the track', 0);

    var handlers = {
      progress: function (f, stage) { showBusy(stage, f); },
      spectrogram: function (kind, spec) {
        st.specs[kind] = spec;
        if (kind === 'original') st.top = topOf(spec.data);
        drawSpectra();
      },
      done: function (res) {
        st.buffers.clean = makeBuffer(res.clean, sr);
        st.buffers.removed = makeBuffer(res.removed, sr);
        computePeaks('clean'); computePeaks('removed');
        st.applied = params; st.busy = false;
        $('reportText').textContent = res.report.text;
        $('export').hidden = false;
        $('metaClean').textContent = summary(params);
        setModeAvailability(true);
        if (st.mode === 'original' && !st.everCleaned) setMode('clean');
        st.everCleaned = true;
        hideBusy(); refreshDirty(); drawSpectra(); drawWave();
        if (st.playing) restartPlayback();
      },
      error: function (msg) {
        st.busy = false; hideBusy(); refreshDirty();
        showError('Cleaning failed: ' + msg);
      }
    };

    var started = false, w = null;
    function inline() {
      // file:// pages cannot start workers; run on the page instead (it pauses while it works)
      showBusy('Cleaning on this page; it will pause until done', 0.02);
      setTimeout(function () {
        try {
          var res = Engine.process(channelsOf(st.buffers.original, true), sr, params, { spectrogram: handlers.spectrogram });
          handlers.done(res);
        } catch (e) { handlers.error(e.message); }
      }, 50);
    }
    try { w = new Worker('worker.js'); } catch (e) { w = null; }
    if (!w) { inline(); return; }
    st.worker = w;
    w.onmessage = function (e) {
      var m = e.data; started = true;
      if (m.type === 'progress') handlers.progress(m.fraction, m.stage);
      else if (m.type === 'spectrogram') handlers.spectrogram(m.kind, m.spec);
      else if (m.type === 'done') { handlers.done(m); w.terminate(); if (st.worker === w) st.worker = null; }
      else if (m.type === 'error') { handlers.error(m.message); w.terminate(); }
    };
    w.onerror = function (e) {
      e.preventDefault();
      if (st.worker === w) st.worker = null;
      w.terminate();
      if (!started) inline(); else handlers.error(e.message || 'the worker stopped');
    };
    w.postMessage({ type: 'process', channels: chans, sampleRate: sr, params: params }, chans.map(function (c) { return c.buffer; }));
  }

  // ---------------- playback (edited timeline, seconds) ----------------
  var ctx = null;
  function audioCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }
  function edLen() { return st.segs ? Ed.total(st.segs) : 0; }
  function duration() { return st.sr ? edLen() / st.sr : 0; }
  function position() {
    return st.playing ? Math.min(duration(), audioCtx().currentTime - st.startAt) : st.offset;
  }
  function playheadSample() { return Math.max(0, Math.min(edLen(), Math.round(position() * st.sr))); }

  function scheduleMode(c, buffer, out, when, offS) {
    var segs = st.segs, n = st.n, sr = st.sr, acc = 0, step = Math.max(1, Math.round(CURVE_STEP_S * sr));
    for (var i = 0; i < segs.length; i++) {
      var x = segs[i], L = x.e - x.s, segStart = acc;
      acc += L;
      if (acc <= offS) continue;
      var k0 = Math.max(0, offS - segStart), durS = (L - k0) / sr;
      if (durS <= 0) continue;
      var t0 = when + Math.max(0, segStart - offS) / sr;
      var src = c.createBufferSource(), g = c.createGain(), env = Ed.setup(segs, i, n, sr);
      src.buffer = buffer;
      if (Ed.flatFrom(env, k0)) g.gain.value = Ed.envK(env, k0);
      else {
        var curve = Ed.curve(env, k0, step);
        g.gain.value = curve[0];
        g.gain.setValueCurveAtTime(curve, t0, durS);
      }
      src.connect(g); g.connect(out);
      src.start(t0, (x.s + k0) / sr, durS);
      st.sources.push(src);
    }
  }
  function startPlayback() {
    if (!st.buffers.original) return;
    var c = audioCtx();
    if (c.state === 'suspended') c.resume();
    if (st.offset >= duration() - 0.05) st.offset = 0;
    st.sources = []; st.gains = {};
    var when = c.currentTime + 0.04, offS = Math.round(st.offset * st.sr);
    MODES.forEach(function (m) {
      var b = st.buffers[m];
      if (!b) return;
      var mg = c.createGain();
      mg.gain.value = m === st.mode ? 1 : 0;
      mg.connect(c.destination);
      st.gains[m] = mg;
      scheduleMode(c, b, mg, when, offS);
    });
    st.startAt = when - st.offset;
    st.playing = true; setPlayButton();
    requestAnimationFrame(loop);
  }
  function stopPlayback() {
    if (st.playing) st.offset = position();
    (st.sources || []).forEach(function (s) { try { s.stop(); } catch (e) {} });
    (st.gains ? Object.keys(st.gains) : []).forEach(function (k) { try { st.gains[k].disconnect(); } catch (e) {} });
    st.sources = null; st.gains = null; st.playing = false; setPlayButton();
  }
  function restartPlayback() { var t = position(); stopPlayback(); st.offset = Math.min(t, duration()); startPlayback(); }
  function seekTo(t) {
    var was = st.playing;
    stopPlayback();
    st.offset = Math.max(0, Math.min(duration(), t));
    if (was) startPlayback(); else tick();
  }
  function setMode(m) {
    st.mode = m;
    MODES.forEach(function (k) {
      var r = document.querySelector('input[name="mode"][value="' + k + '"]');
      r.checked = k === m;
      r.closest('.track').classList.toggle('is-active', k === m);
      if (st.gains && st.gains[k]) st.gains[k].gain.setTargetAtTime(k === m ? 1 : 0, audioCtx().currentTime, 0.006);
    });
    $('tagRight').textContent = m === 'removed' ? 'Removed' : 'Cleaned';
    $('nowMode').textContent = MODE_NAME[m];
    var tile = $('nowTile'), src = document.querySelector('.track[data-mode="' + m + '"] .tile');
    tile.className = src.className; tile.innerHTML = src.innerHTML;
    drawSpectra(); drawWave();
  }
  function setModeAvailability(on) {
    ['clean', 'removed'].forEach(function (k) {
      document.querySelector('input[name="mode"][value="' + k + '"]').disabled = !on;
    });
    $('dlClean').disabled = !on; $('dlRemoved').disabled = !on;
  }
  function setPlayButton() {
    var b = $('play');
    b.classList.toggle('playing', st.playing);
    b.setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
  }
  function loop() {
    if (!st.playing) return;
    if (position() >= duration() - 0.002) { stopPlayback(); st.offset = 0; tick(); return; }
    tick(); followPlayhead();
    requestAnimationFrame(loop);
  }
  function tick() {
    var d = duration(), t = position(), seek = $('seek');
    $('tNow').textContent = fmtTime(t);
    $('tEnd').textContent = fmtTime(d);
    if (!st.seeking) { seek.value = d ? Math.round(1000 * t / d) : 0; setFill(seek); }
    if (st.segs && st.n) $('playhead').style.left = (100 * Ed.toSource(st.segs, Math.round(t * st.sr)) / st.n) + '%';
    placeWavePlayhead();
  }

  // ---------------- edits ----------------
  function resetEdits() {
    st.segs = Ed.initial(st.n); st.hist = []; st.fut = []; st.sel = null; st.sec = null; st.zoom = 1;
  }
  function commit(next, opts) {
    opts = opts || {};
    st.hist.push(st.segs); if (st.hist.length > HISTORY) st.hist.shift();
    st.fut = [];
    st.segs = next;
    if (opts.sel !== undefined) st.sel = opts.sel;
    if (opts.sec !== undefined) st.sec = opts.sec;
    if (opts.at !== undefined) st.offset = opts.at / st.sr;
    afterEdit(true, opts.at !== undefined);
  }
  function undo() {
    if (!st.hist.length) return;
    st.fut.push(st.segs); st.segs = st.hist.pop(); st.sel = null;
    afterEdit(true); edNote('Undone.');
  }
  function redo() {
    if (!st.fut.length) return;
    st.hist.push(st.segs); st.segs = st.fut.pop(); st.sel = null;
    afterEdit(true); edNote('Redone.');
  }
  // keep everything consistent after the section list changed
  function afterEdit(changed, moved) {
    var L = edLen();
    if (st.sel) { st.sel.a = Math.min(st.sel.a, L); st.sel.b = Math.min(st.sel.b, L); if (st.sel.b - st.sel.a < 1) st.sel = null; }
    if (st.sec !== null && st.sec >= st.segs.length) st.sec = st.segs.length - 1;
    if (st.offset > duration()) st.offset = duration();
    if (changed && st.playing) {
      if (moved) { var keep = st.offset; stopPlayback(); st.offset = keep; startPlayback(); }
      else restartPlayback();
    }
    var edited = !Ed.isPristine(st.segs, st.n);
    $('editsNote').hidden = !edited;
    $('edUndo').disabled = !st.hist.length; $('edRedo').disabled = !st.fut.length;
    $('edReset').disabled = !edited;
    shadeCuts(); refreshTools(); refreshInspector(); sizeWave(); drawWave(); tick();
  }
  function selected() { return st.sec !== null ? st.sec : Ed.locate(st.segs, playheadSample()).i; }
  function refreshTools() {
    var has = !!st.sel;
    $('edCut').disabled = !has; $('edCrop').disabled = !has; $('edSection').disabled = !has;
    if (has) edNote('Selected ' + fmtPrecise(st.sel.a / st.sr) + ' to ' + fmtPrecise(st.sel.b / st.sr) +
      ' (' + ((st.sel.b - st.sel.a) / st.sr).toFixed(2) + ' s). Cut it, keep only it, or make it a section.');
  }
  function edNote(text, warn) {
    var el = $('edNote');
    el.textContent = text || ED_HELP;
    el.classList.toggle('is-warning', !!warn);
  }
  function refreshInspector() {
    if (!st.segs) return;
    var i = selected(), x = st.segs[i], L = x.e - x.s, sr = st.sr, a = Ed.startOf(st.segs, i);
    $('secLabel').innerHTML = '';
    $('secLabel').append('Section ' + (i + 1) + ' of ' + st.segs.length + ' ');
    var span = document.createElement('span');
    span.textContent = fmtPrecise(a / sr) + ' to ' + fmtPrecise((a + L) / sr);
    $('secLabel').append(span);
    var maxFade = Math.max(0.05, Math.min(10, L / sr));
    var gi = $('secGain'), fi = $('secFadeIn'), fo = $('secFadeOut');
    gi.value = x.g; fi.max = maxFade; fo.max = maxFade;
    fi.value = (x.fi / sr).toFixed(2); fo.value = (x.fo / sr).toFixed(2);
    $('secGainOut').textContent = (x.g > 0 ? '+' : '') + x.g.toFixed(1) + ' dB';
    $('secFadeInOut').textContent = (x.fi / sr).toFixed(2) + ' s';
    $('secFadeOutOut').textContent = (x.fo / sr).toFixed(2) + ' s';
    [gi, fi, fo].forEach(setFill);
  }
  function shadeCuts() {
    var box = $('cutShades');
    box.textContent = '';
    if (!st.segs) return;
    Ed.removedRanges(st.segs, st.n).forEach(function (r) {
      var d = document.createElement('div');
      d.style.left = (100 * r[0] / st.n) + '%';
      d.style.width = (100 * (r[1] - r[0]) / st.n) + '%';
      box.appendChild(d);
    });
  }

  function doSplit() {
    var t = playheadSample(), next = Ed.splitAt(st.segs, t);
    if (next.length === st.segs.length) { edNote('Move the playhead inside a section to split it.'); return; }
    commit(next, { sec: Ed.locate(next, t).i });
    edNote('Split at ' + fmtPrecise(t / st.sr) + '.');
  }
  function doCut() {
    if (!st.sel) return;
    try {
      var a = st.sel.a, len = st.sel.b - st.sel.a;
      commit(Ed.cut(st.segs, st.sel.a, st.sel.b), { sel: null, sec: null, at: a });
      edNote('Cut ' + (len / st.sr).toFixed(2) + ' s.');
    } catch (e) { edNote(e.message, true); }
  }
  function doCrop() {
    if (!st.sel) return;
    try { commit(Ed.crop(st.segs, st.sel.a, st.sel.b), { sel: null, sec: null, at: 0 }); edNote('Kept only the selection.'); }
    catch (e) { edNote(e.message, true); }
  }
  function doSection() {
    if (!st.sel) return;
    try {
      var r = Ed.section(st.segs, st.sel.a, st.sel.b);
      commit(r.segs, { sel: null, sec: r.index });
      edNote('Section ' + (r.index + 1) + ' made. Set its volume and fades below.');
    } catch (e) { edNote(e.message, true); }
  }
  function markIn() {
    var t = playheadSample(), b = st.sel ? st.sel.b : edLen();
    st.sel = { a: Math.min(t, b), b: Math.max(t, b) };
    if (st.sel.b - st.sel.a < 1) st.sel = null;
    refreshTools(); drawWave();
  }
  function markOut() {
    var t = playheadSample(), a = st.sel ? st.sel.a : 0;
    st.sel = { a: Math.min(t, a), b: Math.max(t, a) };
    if (st.sel.b - st.sel.a < 1) st.sel = null;
    refreshTools(); drawWave();
  }
  function clearSel() { st.sel = null; refreshTools(); edNote(); drawWave(); }

  // inspector sliders: one undo step per gesture, playback refreshed when the gesture ends
  var sliderTx = false;
  function inspectorInput(key, el) {
    var i = selected(), p = {};
    p[key] = key === 'g' ? Number(el.value) : Number(el.value) * st.sr;
    var next = Ed.setSection(st.segs, i, p);
    if (JSON.stringify(next) === JSON.stringify(st.segs)) return;
    if (!sliderTx) { st.hist.push(st.segs); if (st.hist.length > HISTORY) st.hist.shift(); st.fut = []; sliderTx = true; }
    st.sec = i;
    st.segs = next;
    refreshInspector(); drawWave();
    $('editsNote').hidden = Ed.isPristine(st.segs, st.n);
    $('edUndo').disabled = false; $('edReset').disabled = Ed.isPristine(st.segs, st.n);
  }
  function inspectorChange() { if (sliderTx) { sliderTx = false; afterEdit(true); } }

  // ---------------- waveform ----------------
  function computePeaks(mode) {
    var b = st.buffers[mode];
    if (!b) return;
    var chans = channelsOf(b, false), n = b.length, nb = Math.ceil(n / BUCKET), pk = new Float32Array(nb), mx = 0;
    for (var j = 0; j < nb; j++) {
      var a = j * BUCKET, e = Math.min(n, a + BUCKET), m = 0;
      for (var c = 0; c < chans.length; c++) {
        var ch = chans[c];
        for (var i = a; i < e; i++) { var v = ch[i]; if (v < 0) v = -v; if (v > m) m = v; }
      }
      pk[j] = m; if (m > mx) mx = m;
    }
    st.peaks[mode] = pk; st.peakMax[mode] = mx || 1;
  }
  function waveView() {
    var scroll = $('waveScroll'), W = scroll.clientWidth;
    return { W: W, CW: W * st.zoom, left: scroll.scrollLeft, H: $('waveTrack').clientHeight };
  }
  function sizeWave() {
    $('waveTrack').style.width = (100 * st.zoom) + '%';
    $('zoomLevel').textContent = st.zoom + 'x';
    $('edZoomOut').disabled = st.zoom <= 1; $('edZoomIn').disabled = st.zoom >= MAX_ZOOM;
  }
  // snap: within 6 px of either end of the track counts as the end itself
  function xToSample(clientX, snap) {
    var v = waveView(), r = $('waveScroll').getBoundingClientRect(), px = clientX - r.left + v.left;
    if (snap && px <= 6) return 0;
    if (snap && px >= v.CW - 6) return edLen();
    return Math.max(0, Math.min(edLen(), Math.round(px / v.CW * edLen())));
  }
  function sampleToX(t, v) { return t / edLen() * v.CW - v.left; }
  function placeWavePlayhead() {
    var el = $('wavePlayhead');
    if (!st.segs || $('loaded').hidden) return;
    var v = waveView(), x = sampleToX(position() * st.sr, v);
    el.hidden = x < 0 || x > v.W;
    el.style.left = x + 'px';
  }
  function followPlayhead() {
    if (st.zoom <= 1 || waveDrag) return;
    var v = waveView(), x = sampleToX(position() * st.sr, v);
    if (x > v.W * 0.9 || x < 0) $('waveScroll').scrollLeft = Math.max(0, v.left + x - v.W * 0.1);
  }

  function drawWave() {
    var canvas = $('waveCanvas');
    if (!st.segs || $('loaded').hidden) return;
    var v = waveView(), dpr = window.devicePixelRatio || 1;
    if (!v.W) return;
    canvas.style.width = v.W + 'px';
    var Wp = Math.round(v.W * dpr), Hp = Math.round(v.H * dpr);
    if (canvas.width !== Wp || canvas.height !== Hp) { canvas.width = Wp; canvas.height = Hp; }
    var g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, v.W, v.H);
    var segs = st.segs, L = edLen(), sr = st.sr, n = st.n;
    var mode = st.peaks[st.mode] ? st.mode : 'original', pk = st.peaks[mode], scale = 0.92 / st.peakMax[mode];
    var top = 10, bot = v.H - 10, mid = v.H / 2, half = (bot - top) / 2 - 4;
    var cur = selected(), acc = 0, grad = g.createLinearGradient(0, 0, v.W, 0);
    grad.addColorStop(0, '#fd429c'); grad.addColorStop(1, '#ff9448');

    for (var i = 0; i < segs.length; i++) {
      var x = segs[i], len = x.e - x.s, a = acc;
      acc += len;
      var x0 = sampleToX(a, v), x1 = sampleToX(a + len, v);
      if (x1 < 0 || x0 > v.W) continue;
      var isCur = i === cur;
      // section block
      g.fillStyle = isCur ? 'rgba(253, 66, 156, 0.10)' : '#252529';
      roundRect(g, x0 + 1, top, Math.max(1, x1 - x0 - 2), bot - top, 6);
      g.fill();
      if (isCur) { g.strokeStyle = 'rgba(253, 66, 156, 0.75)'; g.lineWidth = 1; g.stroke(); }
      // bars
      var env = Ed.setup(segs, i, n, sr), bx = Math.max(x0 + 2, 0), ex = Math.min(x1 - 2, v.W);
      g.fillStyle = isCur ? grad : '#c2c2c1';
      for (var px = Math.floor(bx / 3) * 3; px < ex; px += 3) {
        var k0 = Math.max(0, Math.floor((px + v.left) / v.CW * L) - a), k1 = Math.min(len, Math.ceil((px + 2 + v.left) / v.CW * L) - a);
        if (k1 <= k0) k1 = Math.min(len, k0 + 1);
        var b0 = Math.floor((x.s + k0) / BUCKET), b1 = Math.max(b0 + 1, Math.ceil((x.s + k1) / BUCKET)), p = 0;
        for (var bk = b0; bk < b1 && bk < pk.length; bk++) if (pk[bk] > p) p = pk[bk];
        var h = Math.min(1, p * scale * Ed.envK(env, (k0 + k1) / 2)) * half;
        h = Math.max(1, h);
        g.fillRect(px, mid - h, 2, 2 * h);
      }
      // fades, drawn as a curve with the faded-away part darkened
      drawFade(g, env, x0, x1, len, top, bot, true);
      drawFade(g, env, x0, x1, len, top, bot, false);
      if (x.g && x1 - x0 > 56) {
        g.fillStyle = '#ffffff'; g.font = '500 11px "Inter Tight", system-ui, sans-serif';
        g.fillText((x.g > 0 ? '+' : '') + x.g.toFixed(1) + ' dB', Math.max(x0 + 8, 6), top + 15);
      }
      if (isCur) {
        handle(g, x0 + 1 + (x.fi / len) * (x1 - x0 - 2), top);
        handle(g, x1 - 1 - (x.fo / len) * (x1 - x0 - 2), top);
      }
    }
    if (st.sel) {
      var sx0 = sampleToX(st.sel.a, v), sx1 = sampleToX(st.sel.b, v);
      g.fillStyle = 'rgba(247, 244, 239, 0.16)';
      g.fillRect(sx0, 0, sx1 - sx0, v.H);
      g.fillStyle = '#f7f4ef';
      g.fillRect(sx0 - 1, 0, 2, v.H); g.fillRect(sx1 - 1, 0, 2, v.H);
    }
  }
  function drawFade(g, env, x0, x1, len, top, bot, isIn) {
    var f = isIn ? env.fi : env.fo;
    if (!f) return;
    var w = (f / len) * (x1 - x0 - 2), steps = Math.max(8, Math.ceil(w / 3)), pts = [];
    for (var j = 0; j <= steps; j++) {
      var u = j / steps, gain = Math.sin(Math.PI / 2 * (isIn ? u : 1 - u));
      pts.push([isIn ? x0 + 1 + u * w : x1 - 1 - w + u * w, bot - gain * (bot - top)]);
    }
    g.beginPath();
    g.moveTo(pts[0][0], top);
    pts.forEach(function (p) { g.lineTo(p[0], p[1]); });
    g.lineTo(pts[pts.length - 1][0], top);
    g.closePath();
    g.fillStyle = 'rgba(16, 16, 18, 0.55)'; g.fill();
    g.beginPath();
    pts.forEach(function (p, j) { if (j) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
    g.strokeStyle = '#f7f4ef'; g.lineWidth = 1.5; g.stroke();
  }
  function handle(g, x, y) {
    g.beginPath(); g.arc(x, y + 1, 6, 0, Math.PI * 2);
    g.fillStyle = '#f7f4ef'; g.fill();
    g.lineWidth = 2; g.strokeStyle = '#101012'; g.stroke();
  }
  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
  }
  function setZoom(z, anchorClientX) {
    z = Math.max(1, Math.min(MAX_ZOOM, z));
    if (z === st.zoom) return;
    var scroll = $('waveScroll'), r = scroll.getBoundingClientRect(), v = waveView();
    var ax = anchorClientX === undefined ? (sampleToX(position() * st.sr, v) >= 0 && sampleToX(position() * st.sr, v) <= v.W ?
      sampleToX(position() * st.sr, v) : v.W / 2) : anchorClientX - r.left;
    var frac = (v.left + ax) / v.CW;
    st.zoom = z; sizeWave();
    scroll.scrollLeft = Math.max(0, frac * v.W * z - ax);
    drawWave(); placeWavePlayhead();
  }

  // pointer handling on the waveform
  var waveDrag = null;
  function hitHandle(clientX, clientY) {
    var v = waveView(), r = $('waveScroll').getBoundingClientRect(), x = clientX - r.left, y = clientY - r.top;
    if (y > 26) return null;
    var i = selected(), seg = st.segs[i], a = Ed.startOf(st.segs, i), len = seg.e - seg.s;
    var x0 = sampleToX(a, v), x1 = sampleToX(a + len, v), w = x1 - x0 - 2;
    var hin = x0 + 1 + (seg.fi / len) * w, hout = x1 - 1 - (seg.fo / len) * w;
    if (Math.abs(x - hin) <= 10) return { kind: 'fi', i: i, x0: x0 + 1, w: w, len: len };
    if (Math.abs(x - hout) <= 10) return { kind: 'fo', i: i, x1: x1 - 1, w: w, len: len };
    return null;
  }
  function wavePointerDown(e) {
    if (!st.segs || e.button > 0) return;
    var h = hitHandle(e.clientX, e.clientY);
    if (h) {
      st.hist.push(st.segs); if (st.hist.length > HISTORY) st.hist.shift(); st.fut = [];
      waveDrag = { type: 'fade', h: h };
    } else {
      waveDrag = { type: 'select', anchor: xToSample(e.clientX, true), x: e.clientX, moved: false, touch: e.pointerType === 'touch' };
    }
    if (!waveDrag.touch) $('waveScroll').setPointerCapture(e.pointerId);
  }
  function wavePointerMove(e) {
    if (!waveDrag) {
      if (st.segs) $('waveCanvas').style.cursor = hitHandle(e.clientX, e.clientY) ? 'ew-resize' : 'text';
      return;
    }
    var r = $('waveScroll').getBoundingClientRect(), x = e.clientX - r.left;
    if (waveDrag.type === 'fade') {
      var h = waveDrag.h, frac = h.kind === 'fi' ? (x - h.x0) / h.w : (h.x1 - x) / h.w, p = {};
      p[h.kind] = Math.max(0, Math.min(1, frac)) * h.len;
      st.sec = h.i;
      st.segs = Ed.setSection(st.segs, h.i, p);
      refreshInspector(); drawWave();
      return;
    }
    if (waveDrag.touch) return;
    if (!waveDrag.moved && Math.abs(e.clientX - waveDrag.x) < 4) return;
    waveDrag.moved = true;
    var t = xToSample(e.clientX, true);
    st.sel = { a: Math.min(waveDrag.anchor, t), b: Math.max(waveDrag.anchor, t) };
    drawWave(); refreshTools();
  }
  function wavePointerUp(e) {
    if (!waveDrag) return;
    var d = waveDrag; waveDrag = null;
    if (d.type === 'fade') { afterEdit(true); edNote(); return; }
    if (d.moved) {
      if (st.sel && st.sel.b - st.sel.a < 1) clearSel();
      return;
    }
    if (d.touch && Math.abs(e.clientX - d.x) > 8) return; // a swipe that scrolled
    var t = xToSample(e.clientX);
    st.sel = null; st.sec = Ed.locate(st.segs, Math.min(t, edLen() - 1)).i;
    refreshTools(); edNote(); refreshInspector();
    seekTo(t / st.sr);
    drawWave();
  }

  // ---------------- spectrogram ----------------
  function lut(stops) {
    var out = new Uint8ClampedArray(256 * 3);
    var rgb = stops.map(function (s) {
      var h = s[1]; return [s[0], parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
    });
    for (var i = 0; i < 256; i++) {
      var x = i / 255, j = 1;
      while (j < rgb.length - 1 && x > rgb[j][0]) j++;
      var a = rgb[j - 1], b = rgb[j], f = (x - a[0]) / (b[0] - a[0]);
      for (var c = 0; c < 3; c++) out[i * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * f;
    }
    return out;
  }
  var LUT_MAIN = lut([[0, '#1c1c1f'], [0.3, '#35286b'], [0.55, '#8b6efe'], [0.72, '#fd429c'], [0.88, '#ff9448'], [1, '#f7f4ef']]);
  var LUT_REMOVED = lut([[0, '#1c1c1f'], [0.4, '#123a6b'], [0.75, '#1f8bff'], [1, '#d6ebff']]);
  var RANGE_DB = 72;

  function topOf(data) {
    var s = Float32Array.from(data).sort();
    return s[Math.floor(s.length * 0.999)];
  }
  function paint(canvas, spec, table) {
    var rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    var W = Math.max(1, Math.round(rect.width * dpr)), Hh = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== W || canvas.height !== Hh) { canvas.width = W; canvas.height = Hh; }
    var g = canvas.getContext('2d');
    if (!spec) { g.fillStyle = '#1c1c1f'; g.fillRect(0, 0, W, Hh); return; }
    var sw = spec.width, sh = spec.height, img = new ImageData(sw, sh), px = img.data, lo = st.top - RANGE_DB;
    for (var x = 0; x < sw; x++) for (var y = 0; y < sh; y++) {
      var v = (spec.data[x * sh + (sh - 1 - y)] - lo) / RANGE_DB;
      var i = Math.max(0, Math.min(255, Math.round(v * 255))) * 3, o = (y * sw + x) * 4;
      px[o] = table[i]; px[o + 1] = table[i + 1]; px[o + 2] = table[i + 2]; px[o + 3] = 255;
    }
    var off = document.createElement('canvas'); off.width = sw; off.height = sh;
    off.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(off, 0, 0, W, Hh);
  }
  function drawSpectra() {
    if ($('loaded').hidden) return;
    var before = st.specs.original, after = st.mode === 'removed' ? st.specs.removed : st.specs.clean;
    var table = st.mode === 'removed' && st.specs.removed ? LUT_REMOVED : LUT_MAIN;
    paint($('canvasBefore'), before, LUT_MAIN);
    paint($('canvasAfter'), after || before, after ? table : LUT_MAIN);
  }
  function setSplit(pct) {
    st.split = Math.max(0, Math.min(100, pct));
    $('spectro').style.setProperty('--split', st.split + '%');
    var s = $('split');
    s.setAttribute('aria-valuenow', Math.round(st.split));
    s.setAttribute('aria-valuetext', Math.round(st.split) + '% original');
  }

  // ---------------- view helpers ----------------
  function showLoaded() { $('drop').hidden = true; $('loaded').hidden = false; drawSpectra(); }
  function showUpload() {
    $('loaded').hidden = true; $('drop').hidden = false;
    $('transport').hidden = true; document.body.classList.remove('has-player');
  }
  function showBusy(text, f) {
    $('busy').hidden = false; $('busyText').textContent = text;
    $('busyFill').style.width = Math.round(100 * Math.max(0, Math.min(1, f))) + '%';
  }
  function hideBusy() { $('busy').hidden = true; }
  function showError(msg) { var e = $('error'); e.textContent = msg; e.hidden = false; }
  function hideError() { $('error').hidden = true; }
  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function fmtPrecise(s) {
    s = Math.max(0, s);
    var m = Math.floor(s / 60), r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(2);
  }
  function download(kind) {
    var b = st.buffers[kind];
    if (!b) return;
    var bits = Number($('bits').value), chans = channelsOf(b, false), edited = !Ed.isPristine(st.segs, st.n), peak = 0;
    if (edited) { var res = Ed.render(chans, st.segs, b.sampleRate); chans = res.channels; peak = res.peak; }
    var blob = new Blob([Wav.encodeWav(chans, b.sampleRate, bits)], { type: 'audio/wav' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = st.title + (kind === 'clean' ? ' - Clean' : ' - Removed') + (edited ? ' (edited)' : '') + '.wav';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
    if (peak >= 1 && bits !== 32) {
      edNote('The edited ' + MODE_NAME[kind].toLowerCase() + ' track peaks at +' + (20 * Math.log10(peak)).toFixed(1) +
        ' dBFS and clipped in the download. Lower the loudest section, or download as 32-bit float.', true);
    }
  }

  // ---------------- wiring ----------------
  function init() {
    $('ver').textContent = Engine.VERSION;
    $('pageVer').textContent = PAGE_VERSION;
    writeParams(Engine.DEFAULTS);
    setSplit(50);
    setFill($('seek'));

    var fileInput = $('file');
    document.querySelectorAll('[data-pick]').forEach(function (b) {
      b.addEventListener('click', function () { fileInput.click(); });
    });
    fileInput.addEventListener('change', function () { if (this.files[0]) loadFile(this.files[0]); this.value = ''; });

    // drop a file anywhere on the page; the overlay shows while a file is held over it
    var overlay = $('dropOverlay'), depth = 0;
    function hasFiles(e) {
      var t = e.dataTransfer && e.dataTransfer.types;
      return !!t && Array.prototype.indexOf.call(t, 'Files') >= 0;
    }
    function hideOverlay() { depth = 0; overlay.hidden = true; }
    window.addEventListener('dragenter', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth++;
      $('dropSub').textContent = st.buffers.original ? 'Replaces ' + st.title : 'WAV, MP3, FLAC and most other audio files';
      overlay.hidden = false;
    });
    window.addEventListener('dragover', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    });
    window.addEventListener('dragleave', function (e) {
      if (!hasFiles(e)) return;
      if (--depth <= 0 || !e.relatedTarget) hideOverlay();
    });
    window.addEventListener('drop', function (e) {
      if (!hasFiles(e)) return;
      e.preventDefault(); hideOverlay();
      var f = e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    window.addEventListener('blur', hideOverlay);

    PARAMS.concat(['denoise']).forEach(function (k) { $(k).addEventListener('input', refreshOutputs); });
    $('apply').addEventListener('click', runProcess);
    $('reset').addEventListener('click', function () { writeParams(Engine.DEFAULTS); });

    $('play').addEventListener('click', function () { if (st.playing) stopPlayback(); else startPlayback(); });
    document.querySelectorAll('input[name="mode"]').forEach(function (r) {
      r.addEventListener('change', function () { if (r.checked) setMode(r.value); });
    });
    var seek = $('seek');
    seek.addEventListener('pointerdown', function () { st.seeking = true; });
    window.addEventListener('pointerup', function () { st.seeking = false; });
    seek.addEventListener('input', function () { setFill(seek); seekTo(duration() * seek.value / 1000); });

    // divider drag, and click anywhere else on the spectrogram to seek
    var spectro = $('spectro'), split = $('split'), dragging = false;
    split.addEventListener('pointerdown', function (e) { dragging = true; split.setPointerCapture(e.pointerId); e.stopPropagation(); });
    split.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var r = spectro.getBoundingClientRect();
      setSplit(100 * (e.clientX - r.left) / r.width);
    });
    split.addEventListener('pointerup', function () { dragging = false; });
    split.addEventListener('keydown', function (e) {
      var step = e.shiftKey ? 10 : 2, k = e.key;
      if (k === 'ArrowLeft' || k === 'ArrowDown') setSplit(st.split - step);
      else if (k === 'ArrowRight' || k === 'ArrowUp') setSplit(st.split + step);
      else if (k === 'Home') setSplit(0);
      else if (k === 'End') setSplit(100);
      else return;
      e.preventDefault();
    });
    spectro.addEventListener('pointerdown', function (e) {
      if (e.target === split || split.contains(e.target) || !st.buffers.original) return;
      var r = spectro.getBoundingClientRect(), src = Math.round(st.n * (e.clientX - r.left) / r.width);
      seekTo(Ed.fromSource(st.segs, src) / st.sr);
    });

    $('dlClean').addEventListener('click', function () { download('clean'); });
    $('dlRemoved').addEventListener('click', function () { download('removed'); });

    // editor
    $('edSplit').addEventListener('click', doSplit);
    $('edCut').addEventListener('click', doCut);
    $('edCrop').addEventListener('click', doCrop);
    $('edSection').addEventListener('click', doSection);
    $('edIn').addEventListener('click', markIn);
    $('edOut').addEventListener('click', markOut);
    $('edUndo').addEventListener('click', undo);
    $('edRedo').addEventListener('click', redo);
    $('edReset').addEventListener('click', function () {
      commit(Ed.initial(st.n), { sel: null, sec: null }); edNote('All edits removed. Undo brings them back.');
    });
    $('edZoomIn').addEventListener('click', function () { setZoom(st.zoom * 2); });
    $('edZoomOut').addEventListener('click', function () { setZoom(st.zoom / 2); });
    [['secGain', 'g'], ['secFadeIn', 'fi'], ['secFadeOut', 'fo']].forEach(function (pair) {
      var el = $(pair[0]);
      el.addEventListener('input', function () { inspectorInput(pair[1], el); });
      el.addEventListener('change', inspectorChange);
    });
    var ws = $('waveScroll');
    ws.addEventListener('pointerdown', wavePointerDown);
    ws.addEventListener('pointermove', wavePointerMove);
    ws.addEventListener('pointerup', wavePointerUp);
    ws.addEventListener('pointercancel', function () { waveDrag = null; });
    ws.addEventListener('scroll', function () { drawWave(); placeWavePlayhead(); });
    ws.addEventListener('wheel', function (e) {
      if (!(e.ctrlKey || e.metaKey) || !st.segs) return;
      e.preventDefault();
      setZoom(e.deltaY < 0 ? st.zoom * 2 : st.zoom / 2, e.clientX);
    }, { passive: false });

    document.addEventListener('keydown', function (e) {
      var tg = e.target, tag = tg && tg.tagName;
      if (!st.buffers.original || e.altKey) return;
      if (tag === 'SELECT' || tag === 'TEXTAREA') return;
      var mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
      if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && key === 'y') { e.preventDefault(); redo(); return; }
      if (mod) return;
      var typing = tag === 'INPUT' && tg.type !== 'radio';
      if (e.key === ' ') {
        // leave Space to buttons, sliders and checkboxes that use it themselves
        if (tag === 'BUTTON' || typing || tg === split) return;
        e.preventDefault(); if (st.playing) stopPlayback(); else startPlayback();
        return;
      }
      if (typing && /^(arrow|home|end|page)/.test(key)) return;
      if (key === 's') { e.preventDefault(); doSplit(); }
      else if (key === 'delete' || key === 'backspace') { if (st.sel) { e.preventDefault(); doCut(); } }
      else if (key === 'i') { e.preventDefault(); markIn(); }
      else if (key === 'o') { e.preventDefault(); markOut(); }
      else if (key === 'escape') { if (st.sel) clearSel(); }
      else {
        var i = ['1', '2', '3'].indexOf(e.key);
        if (i >= 0) {
          var r = document.querySelector('input[name="mode"][value="' + MODES[i] + '"]');
          if (!r.disabled) setMode(MODES[i]);
        }
      }
    });

    // read-only view of the edit for automated tests (tests/edit_reference.py checks downloads against it)
    window.SunoShimmerFree = {
      edit: function () { return st.segs ? { sampleRate: st.sr, n: st.n, segs: JSON.parse(JSON.stringify(st.segs)) } : null; }
    };

    function redraw() { drawSpectra(); drawWave(); placeWavePlayhead(); }
    if (window.ResizeObserver) { var ro = new ResizeObserver(redraw); ro.observe(spectro); ro.observe(ws); }
    else window.addEventListener('resize', redraw);
  }
  init();
})();
