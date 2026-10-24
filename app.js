/* GS SunoShimmerFree page logic v1
 *
 * Decodes the dropped file (WAV directly, other formats through the
 * browser's decoder at the file's own sample rate), runs the engine in a
 * worker, plays Original, Cleaned and Removed in lockstep so switching
 * keeps your place, draws the before and after spectrograms with a
 * draggable divider, and writes the WAV downloads.
 *
 * Version history
 *   v1  First release.
 */
(function () {
  'use strict';
  var Engine = window.ShimmerEngine, Wav = window.WavCodec;
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

  var st = {
    title: '', sr: 0, buffers: { original: null, clean: null, removed: null },
    specs: {}, top: 0, applied: null, worker: null, busy: false, mode: 'original', split: 50
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
  function refreshOutputs() {
    PARAMS.forEach(function (k) {
      var el = $(k), out = el.parentNode.querySelector('output');
      out.textContent = SHOW[k](Number(el.value));
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
    $('apply').disabled = !loaded || !dirty;
    $('applyNote').textContent = st.busy ? 'Cleaning with these settings.' :
      (dirty && st.applied ? 'Settings changed. Apply them to hear the difference.' : '');
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
    st.buffers = { original: null, clean: null, removed: null }; st.specs = {}; st.applied = null;
    setModeAvailability(false); setMode('original');
    $('export').hidden = true;
    st.title = file.name.replace(/\.[^.]+$/, '') || 'Track';
    showViewer(); showBusy('Opening ' + file.name, 0);

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
        return { chans: channelsOf(buf, false), sr: sr, kind: (guessed ? 'decoded at an assumed 48 kHz' : 'decoded by the browser') };
      }, function () {
        throw new Error('This browser could not decode ' + file.name + '. Convert it to WAV or MP3 and try again.');
      });
    }).then(function (d) {
      st.sr = d.sr;
      st.buffers.original = makeBuffer(d.chans, d.sr);
      var b = st.buffers.original;
      $('fileLine').textContent = file.name + ': ' + fmtTime(b.duration) + ', ' + (d.sr / 1000) + ' kHz, ' +
        (b.numberOfChannels === 1 ? 'mono' : b.numberOfChannels === 2 ? 'stereo' : b.numberOfChannels + ' channels') + ', ' + d.kind + '.';
      $('fileLine').hidden = false;
      $('tEnd').textContent = fmtTime(b.duration);
      $('transport').hidden = false;
      refreshDirty();
      runProcess();
    }).catch(function (e) {
      hideBusy();
      if (!st.buffers.original) { $('spectro').hidden = true; $('drop').hidden = false; }
      showError(e.message || String(e));
    });
  }

  // ---------------- processing ----------------
  function runProcess() {
    if (!st.buffers.original) return;
    if (st.worker) { st.worker.terminate(); st.worker = null; }
    var params = readParams(), sr = st.sr, chans = channelsOf(st.buffers.original, true);
    st.busy = true; refreshDirty(); showBusy('Reading the track', 0);
    $('apply').disabled = true;

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
        st.applied = params; st.busy = false;
        $('reportText').textContent = res.report.text;
        $('export').hidden = false;
        setModeAvailability(true);
        if (st.mode === 'original' && !st.everCleaned) setMode('clean');
        st.everCleaned = true;
        hideBusy(); refreshDirty(); drawSpectra();
        if (st.playing) { var t = position(); stopPlayback(); st.offset = t; startPlayback(); }
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

  // ---------------- playback ----------------
  var ctx = null;
  st.offset = 0; st.playing = false;
  function audioCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }
  function duration() { return st.buffers.original ? st.buffers.original.duration : 0; }
  function position() {
    return st.playing ? Math.min(duration(), audioCtx().currentTime - st.startAt) : st.offset;
  }
  function startPlayback() {
    if (!st.buffers.original) return;
    var c = audioCtx();
    if (c.state === 'suspended') c.resume();
    if (st.offset >= duration() - 0.05) st.offset = 0;
    st.sources = []; st.gains = {};
    MODES.forEach(function (m) {
      var b = st.buffers[m];
      if (!b) return;
      var s = c.createBufferSource(), g = c.createGain();
      s.buffer = b; g.gain.value = m === st.mode ? 1 : 0;
      s.connect(g); g.connect(c.destination);
      st.sources.push(s); st.gains[m] = g;
    });
    var when = c.currentTime + 0.03;
    st.sources.forEach(function (s) { s.start(when, st.offset); });
    st.startAt = when - st.offset;
    var lead = st.sources[0];
    lead.onended = function () {
      if (st.playing && st.sources && st.sources[0] === lead) { stopPlayback(); st.offset = 0; tick(); }
    };
    st.playing = true; setPlayButton();
    requestAnimationFrame(loop);
  }
  function stopPlayback() {
    if (st.playing) st.offset = position();
    (st.sources || []).forEach(function (s) { try { s.onended = null; s.stop(); } catch (e) {} });
    st.sources = null; st.gains = null; st.playing = false; setPlayButton();
  }
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
      if (st.gains && st.gains[k]) st.gains[k].gain.setTargetAtTime(k === m ? 1 : 0, audioCtx().currentTime, 0.006);
    });
    var tag = $('tagRight');
    tag.textContent = m === 'removed' ? 'Removed' : 'Cleaned';
    tag.classList.toggle('is-removed', m === 'removed');
    drawSpectra();
  }
  function setModeAvailability(on) {
    ['clean', 'removed'].forEach(function (k) {
      document.querySelector('input[name="mode"][value="' + k + '"]').disabled = !on;
    });
  }
  function setPlayButton() {
    var b = $('play');
    b.classList.toggle('playing', st.playing);
    b.setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
  }
  function loop() { tick(); if (st.playing) requestAnimationFrame(loop); }
  function tick() {
    var d = duration(), t = position();
    $('tNow').textContent = fmtTime(t);
    if (!st.seeking) $('seek').value = d ? Math.round(1000 * t / d) : 0;
    $('playhead').style.left = (d ? 100 * t / d : 0) + '%';
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
  var LUT_MAIN = lut([[0, '#151722'], [0.3, '#2c2b57'], [0.55, '#74406f'], [0.8, '#c9a24a'], [1, '#f6edd4']]);
  var LUT_REMOVED = lut([[0, '#151722'], [0.35, '#173a3a'], [0.7, '#5db3a6'], [1, '#e4f5f1']]);
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
    if (!spec) { g.fillStyle = '#1f2331'; g.fillRect(0, 0, W, Hh); return; }
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
    if ($('spectro').hidden) return;
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
  function showViewer() { $('drop').hidden = true; $('spectro').hidden = false; drawSpectra(); }
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
  function download(kind) {
    var b = st.buffers[kind];
    if (!b) return;
    var bits = Number($('bits').value);
    var blob = new Blob([Wav.encodeWav(channelsOf(b, false), b.sampleRate, bits)], { type: 'audio/wav' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = st.title + (kind === 'clean' ? ' - Clean' : ' - Removed') + '.wav';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 60000);
  }

  // ---------------- wiring ----------------
  function init() {
    $('ver').textContent = Engine.VERSION;
    writeParams(Engine.DEFAULTS);
    setSplit(50);

    $('file').addEventListener('change', function () { if (this.files[0]) loadFile(this.files[0]); this.value = ''; });
    var viewer = $('viewer');
    ['dragenter', 'dragover'].forEach(function (ev) {
      viewer.addEventListener(ev, function (e) { e.preventDefault(); viewer.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      viewer.addEventListener(ev, function (e) { e.preventDefault(); viewer.classList.remove('dragover'); });
    });
    viewer.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });
    window.addEventListener('dragover', function (e) { e.preventDefault(); });
    window.addEventListener('drop', function (e) { e.preventDefault(); });

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
    seek.addEventListener('input', function () { seekTo(duration() * seek.value / 1000); });

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
      var r = spectro.getBoundingClientRect();
      seekTo(duration() * (e.clientX - r.left) / r.width);
    });

    $('dlClean').addEventListener('click', function () { download('clean'); });
    $('dlRemoved').addEventListener('click', function () { download('removed'); });

    document.addEventListener('keydown', function (e) {
      var tg = e.target, tag = tg && tg.tagName;
      if (!st.buffers.original || e.metaKey || e.ctrlKey || e.altKey) return;
      if (tag === 'INPUT' && tg.type !== 'radio' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tg === split) return;
      if (e.key === ' ') { e.preventDefault(); if (st.playing) stopPlayback(); else startPlayback(); }
      var i = ['1', '2', '3'].indexOf(e.key);
      if (i >= 0) {
        var r = document.querySelector('input[name="mode"][value="' + MODES[i] + '"]');
        if (!r.disabled) setMode(MODES[i]);
      }
    });

    if (window.ResizeObserver) new ResizeObserver(function () { drawSpectra(); }).observe(spectro);
    else window.addEventListener('resize', drawSpectra);
  }
  init();
})();
