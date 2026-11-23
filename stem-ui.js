/* Suno stem workspace. All ZIP reads, decoding, processing and exporting are local.
 * One compressed entry/decoded stem is processed at a time. No audio leaves the tab.
 */
(function(root) {
  'use strict';
  var Zip = root.SunoStemZip, Wav = root.WavCodec, Engine = root.ShimmerEngine,
    Resample = root.SunoStemResample;
  var MAX_MIX_BYTES = 96 * 1024 * 1024;
  var current = null, generation = 0, worker = null;
  var context = null, buffer = null, source = null, startedAt = 0, position = 0, playing = false;
  var audioLabel = '', busy = false, timer = 0, objectUrl = null, pendingProcessAbort = null, pendingSourceAbort = null;
  var box, els = {};
  var defaultOptions = ['natural','clear','warm','forward'];
  function $(id) { return els[id]; }
  function make() {
    if (box) return;
    box = document.createElement('section');
    box.id = 'stemWorkspace';
    box.className = 'stem-workspace';
    box.hidden = true; box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-labelledby', 'stemHeading');
    box.innerHTML = [
      '<div class="stem-panel">',
      '<header class="stem-head"><div><h2 id="stemHeading">Suno stems</h2><p>ZIP import, local processing and reconstruction</p></div>',
      '<div class="stem-head-buttons"><button id="stemNew" type="button">Choose another ZIP</button>',
      '<input id="stemNewFile" type="file" accept=".zip,application/zip" hidden>',
      '<button id="stemClose" type="button" aria-label="Close stem workspace">Close</button></div></header>',
      '<p id="stemStatus" role="status" aria-live="polite">Choose a Suno stem ZIP.</p>',
      '<p class="stem-note" id="stemArchive" hidden></p>',
      '<p class="stem-note" id="stemWarnings" hidden></p>',
      '<p class="stem-note" id="stemMemory" role="status">Memory: no preview measured yet.</p>',
      '<div class="stem-toolbar"><button type="button" id="stemAll">Enable all</button>',
      '<button type="button" id="stemNone">Disable all</button>',
      '<button type="button" id="stemStop">Cancel processing</button></div>',
      '<div id="stemList" class="stem-list" aria-label="Stems in archive"></div>',
      '<p class="stem-note">Stereo stems remain start-aligned from decoded sample zero. MP3 encoder delay cannot be inferred reliably; verify sync by listening. WAV variants are preferred when provided.</p>',
      '<label class="stem-allow"><input type="checkbox" id="stemAllowMismatch"> Allow zero-padding or trimming of mismatched stem lengths/rates (never time-shift stems)</label>',
      '<div class="stem-build"><label for="stemClipStart">Preview start (seconds)</label>',
      '<input id="stemClipStart" type="number" min="0" step="0.1" value="0" class="stem-seconds">',
      '<label for="stemClipEnd">Preview end (seconds; 0 means full length)</label>',
      '<input id="stemClipEnd" type="number" min="0" step="0.1" value="0" class="stem-seconds">',
      '<button type="button" id="stemBuild">Build selected mix or passage</button>',
      '<span id="stemMixInfo" class="stem-note">No mix built.</span></div>',
      '<div class="stem-playback"><button type="button" id="stemPlay">Play preview</button>',
      '<label for="stemSeek">Playback position</label><input id="stemSeek" type="range" min="0" max="1000" step="1" value="0">',
      '<span id="stemTime">0:00 / 0:00</span></div>',
      '<div class="stem-build"><label for="stemBits">Download as (milestone A: 32-bit float WAV passage)</label>',
      '<select id="stemBits"><option value="32">32-bit float WAV</option><option value="24">24-bit WAV</option>',
      '<option value="16">16-bit WAV</option><option value="mp3-320">MP3 320 kilobits/s</option>',
      '<option value="mp3-256">MP3 256 kilobits/s</option><option value="mp3-192">MP3 192 kilobits/s</option></select>',
      '<button type="button" id="stemExport">Export previewed mix or stem</button></div>',
      '<p class="stem-note">Individual preview and export use the selected stem controls. A compiled mix sums enabled unmuted stems; Solo overrides Enable but not Mute.',
      ' Processing is sequential and can take time. A compiled mix is limited to 96 MiB. For long tracks, set a short preview passage first.',
      ' MP3 preview requires a finite excerpt and supported WebCodecs. Only the selected passage is decoded, using indexed seeking with bit-reservoir pre-roll; seek parity is checked offline against FFmpeg, not yet verified in each browser.',
      ' MP3 timing follows the decoder output timeline: encoder delay is not removed, identically for every MP3 stem.',
      ' The entire compressed ZIP entry may be materialized before decoding. Native decoder memory is not measured. Mixed WAV/MP3 stems are blocked until alignment is verified.</p>',
      '</div>'
    ].join('');
    document.body.appendChild(box);
    ['stemHeading','stemNew','stemNewFile','stemClose','stemStatus','stemArchive','stemWarnings','stemMemory',
      'stemAll','stemNone','stemStop','stemList','stemAllowMismatch','stemClipStart','stemClipEnd','stemBuild','stemMixInfo',
      'stemPlay','stemSeek','stemTime','stemBits','stemExport'].forEach(function(k) {
      els[k] = document.getElementById(k);
    });
    $('stemClose').addEventListener('click', close);
    $('stemNew').addEventListener('click', function(){ $('stemNewFile').click(); });
    $('stemNewFile').addEventListener('change', function() {
      var file = this.files && this.files[0]; this.value = '';
      if (file) open(file);
    });
    $('stemStop').addEventListener('click', function() { cancel(); status('Processing cancelled.'); });
    $('stemBuild').addEventListener('click', function() { build('mix'); });
    $('stemPlay').addEventListener('click', function() { playing ? pause() : play(); });
    $('stemSeek').addEventListener('input', function() {
      if (!buffer) return;
      var offset = buffer.duration * Number(this.value) / 1000;
      pause(); position = offset; updateTime();
    });
    $('stemBits').addEventListener('change', renderActions);
    $('stemExport').addEventListener('click', exportAudio);
    $('stemAll').addEventListener('click', function() {
      if (!current) return; current.stems.forEach(function(s) { s.enabled = true; s.mute = false; s.solo = false; });
      invalidate(); render();
    });
    $('stemNone').addEventListener('click', function() {
      if (!current) return; current.stems.forEach(function(s) { s.enabled = false; s.solo = false; });
      invalidate(); render();
    });
    $('stemAllowMismatch').addEventListener('change', invalidate);
    $('stemClipStart').addEventListener('change', invalidate);
    $('stemClipEnd').addEventListener('change', invalidate);
  }
  function memoryReport(decodedBytes, previewBytes, label) {
    // These are explicit buffer sizes, NOT a measurement of process memory.
    // Chromium-only performance.memory is optional and may be approximate.
    var heap = root.performance && root.performance.memory;
    var heapText = heap && Number.isFinite(heap.usedJSHeapSize) ?
      ' · reported JavaScript heap ' + (heap.usedJSHeapSize / 1048576).toFixed(1) + ' MiB' :
      ' · browser heap unavailable';
    if ($('stemMemory')) $('stemMemory').textContent = 'Memory (' + label + '): decoded source ' +
      (decodedBytes / 1048576).toFixed(1) + ' MiB, preview buffers ' +
      (previewBytes / 1048576).toFixed(1) + ' MiB' + heapText +
      '. Audio decoder/native memory is not measured.';
  }
  function status(msg, error) {
    if (!$('stemStatus')) return;
    $('stemStatus').textContent = msg;
    $('stemStatus').classList.toggle('stem-error', !!error);
  }
  function stopAudio() {
    if (source) { try { source.stop(); } catch (_) {} try { source.disconnect(); } catch (_) {} source = null; }
    playing = false;
    if ($('stemPlay')) $('stemPlay').textContent = 'Play preview';
    if (timer) { clearInterval(timer); timer = 0; }
  }
  function pause() {
    if (playing && context) position = Math.min(buffer.duration, Math.max(0, context.currentTime - startedAt));
    stopAudio(); updateTime();
  }
  function clearPreview() {
    stopAudio(); buffer = null; audioLabel = ''; position = 0; updateTime(); renderActions();
  }
  function cancel() {
    generation++;
    // Terminating a Worker alone does not settle the Promise awaiting it.
    // Reject the active processing job before releasing the Worker so the
    // suspended build can unwind and drop its decoded/mix references.
    if (pendingSourceAbort) {
      var abortSource = pendingSourceAbort;
      pendingSourceAbort = null;
      abortSource();
    }
    if (pendingProcessAbort) {
      var abort = pendingProcessAbort;
      pendingProcessAbort = null;
      abort();
    }
    if (worker) { worker.terminate(); worker = null; }
    busy = false;
    renderActions();
  }
  function invalidate() {
    cancel(); clearPreview();
    if ($('stemMixInfo')) $('stemMixInfo').textContent = 'Selection/settings changed: build a new mix.';
  }
  function close() {
    cancel(); clearPreview();
    current = null; box.hidden = true;
    document.body.classList.remove('has-stem-workspace');
    if (context) { context.close().catch(function(){}); context = null; }
  }
  function nameSafe(name) { return String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 130); }
  function fmtTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
  }
  function updateTime() {
    if (!$('stemTime')) return;
    var length = buffer ? buffer.duration : 0;
    var now = playing && context ? Math.max(0, Math.min(length, context.currentTime - startedAt)) : position;
    $('stemTime').textContent = fmtTime(now) + ' / ' + fmtTime(length);
    $('stemSeek').value = length ? Math.round(1000 * now / length) : 0;
    if (playing && now >= length) { stopAudio(); position = 0; }
  }
  function audioContext(preferredRate) {
    if (!context) {
      var C = root.AudioContext || root.webkitAudioContext;
      if (!C) throw new Error('This browser does not support local audio playback.');
      try { context = new C({sampleRate: preferredRate || 48000}); }
      catch (e) { context = new C(); }
    }
    return context;
  }
  function play() {
    if (!buffer || busy) return;
    var c = audioContext();
    c.resume();
    stopAudio();
    var s = c.createBufferSource();
    s.buffer = buffer; s.connect(c.destination);
    if (position >= buffer.duration) position = 0;
    startedAt = c.currentTime - position;
    source = s;
    s.onended = function() { if (source === s) { position = 0; stopAudio(); updateTime(); } };
    s.start(0, position);
    playing = true; $('stemPlay').textContent = 'Pause';
    timer = setInterval(updateTime, 200);
  }
  async function open(file) {
    make(); cancel(); clearPreview();
    // A new archive must not inherit a decoder context and sample rate from
    // the previous archive. Audio buffer previews have already been stopped.
    if (context) { context.close().catch(function(){}); context = null; }
    box.hidden = false; document.body.classList.add('has-stem-workspace');
    $('stemList').replaceChildren(); $('stemArchive').hidden = true; $('stemWarnings').hidden = true;
    $('stemMixInfo').textContent = 'No mix built.';
    $('stemAllowMismatch').checked = false;
    $('stemClipStart').value = '0'; $('stemClipEnd').value = '0';
    var gen = generation;
    current = null; status('Inspecting ' + file.name + ' locally...');
    renderActions();
    try {
      if (!/\.zip$/i.test(file.name)) throw new Error('Select a .zip archive containing WAV or MP3 stems.');
      var archive = await Zip.open(file);
      if (gen !== generation) return;
      archive.stems.forEach(function(s) { s.id = archive.stems.indexOf(s); });
      current = archive;
      $('stemArchive').textContent = file.name + ' · ' + archive.stems.length + ' distinct stems · ' +
        (archive.compressedBytes / 1048576).toFixed(1) + ' MiB compressed · ' +
        (archive.totalBytes / 1048576).toFixed(1) + ' MiB unpacked';
      $('stemArchive').hidden = false;
      var mp3Only = archive.stems.filter(function(s) { return !s.wav; }).length;
      var msg = mp3Only + ' stem(s) use lossy MP3. Decoding may introduce encoder padding; check alignment before final export.';
      $('stemWarnings').textContent = msg;
      $('stemWarnings').hidden = mp3Only === 0;
      status('Archive inspected. No audio has been extracted or decoded yet.');
      render();
    } catch (err) {
      if (gen !== generation) return;
      status(err.message || String(err), true);
    }
    renderActions();
  }
  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function checkbox(label, checked, handler) {
    var l = node('label', 'stem-check'), input = document.createElement('input');
    input.type = 'checkbox'; input.checked = checked;
    input.addEventListener('change', function() { handler(input.checked); });
    l.append(input, document.createTextNode(' ' + label));
    return l;
  }
  function slider(label, amount, min, max, step, handler) {
    var l = node('label', 'stem-field'), span = node('span', '', label + ' ' + amount + '%');
    var input = document.createElement('input');
    input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = amount;
    input.addEventListener('input', function() {
      span.textContent = label + ' ' + input.value + '%';
      handler(Number(input.value));
    });
    l.append(span, input); return l;
  }
  function numberField(label, value, max, handler) {
    var l = node('label', 'stem-field'), caption = node('span', '', label);
    var input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.max = String(max);
    input.step = '0.1'; input.value = String(value || 0);
    input.addEventListener('change', function() {
      handler(Number(input.value)); invalidate();
    });
    l.append(caption, input); return l;
  }
  function render() {
    if (!current) return;
    var list = $('stemList'); list.replaceChildren();
    current.stems.forEach(function(s) {
      var card = node('article', 'stem-card');
      var top = node('div', 'stem-top'), title = node('strong', '', s.name);
      var meta = node('small', '', s.format + (s.wav && s.mp3 ? ' (WAV preferred; MP3 also available)' : '') +
        ' · ' + (s.entry.size / 1048576).toFixed(1) + ' MiB');
      var nameBox = node('div', 'stem-title'); nameBox.append(title, meta);
      var preview = node('button', '', 'Preview stem');
      preview.type = 'button';
      preview.addEventListener('click', function() { build('stem', s); });
      top.append(nameBox, preview); card.append(top);
      var controls = node('div', 'stem-controls');
      controls.append(
        checkbox('Enable', s.enabled, function(v){ s.enabled = v; invalidate(); }),
        checkbox('Mute', s.mute, function(v){ s.mute = v; invalidate(); }),
        checkbox('Solo', s.solo, function(v){ s.solo = v; invalidate(); }),
        checkbox('Clean', s.clean, function(v){ s.clean = v; invalidate(); }),
        checkbox('Polish', s.polish, function(v){ s.polish = v; invalidate(); })
      );
      var volume = node('label', 'stem-volume');
      var volLabel = node('span', '', 'Mix level ' + s.volume + ' dB');
      var vol = document.createElement('input'); vol.type = 'range'; vol.min = -24; vol.max = 12; vol.step = 0.5; vol.value = s.volume;
      vol.addEventListener('input', function() { s.volume = Number(vol.value); volLabel.textContent = 'Mix level ' + s.volume + ' dB'; invalidate(); });
      volume.append(volLabel, vol); controls.append(volume); card.append(controls);
      var details = document.createElement('details'), summary = node('summary', '', 'Stem-specific Sound Polish settings');
      details.append(summary);
      var params = node('div', 'stem-params');
      params.append(
        slider('Clarity', s.clarity, 0, 100, 5, function(v){ s.clarity=v; invalidate(); }),
        slider('Presence', s.presence, 0, 100, 5, function(v){ s.presence=v; invalidate(); }),
        slider('Dynamics', s.dynamics, 0, 100, 5, function(v){ s.dynamics=v; invalidate(); })
      );
      var targetLabel = node('label', 'stem-field', 'Loudness target ');
      var target = document.createElement('select');
      [['off','Off'],['-18','-18 LUFS'],['-16','-16 LUFS'],['-14','-14 LUFS']].forEach(function(item) {
        var opt = node('option', '', item[1]); opt.value = item[0];
        target.appendChild(opt);
      });
      target.value=s.target;
      target.addEventListener('change', function() { s.target=target.value; invalidate(); });
      targetLabel.appendChild(target); params.append(targetLabel);
      var hint = node('p', 'stem-note', 'Enable Polish above to apply these parameters to this stem. Cleaning runs first when enabled.');
      details.append(params, hint); card.append(details);
      var passage = document.createElement('details');
      passage.append(node('summary', '', 'Passage attenuation (reversible)'));
      var passageFields = node('div', 'stem-params');
      passageFields.append(
        numberField('From second', s.passageStart, 99999, function(v){s.passageStart=v;}),
        numberField('To second (0 = off)', s.passageEnd, 99999, function(v){s.passageEnd=v;}),
        numberField('Reduction % (100 = mute)', s.passageReduction, 100, function(v){s.passageReduction=v;})
      );
      passage.append(passageFields,
        node('p', 'stem-note', 'Attenuates this stem only, with 20 ms edge fades. A muted passage may also remove wanted music.'));
      card.append(passage); list.append(card);
    });
    renderActions();
  }
  function renderActions() {
    if (!$('stemBuild')) return;
    $('stemBuild').disabled = !current || busy;
    $('stemExport').disabled = !buffer || busy;
    $('stemPlay').disabled = !buffer || busy;
    $('stemStop').disabled = !busy;
    $('stemAll').disabled = !current || busy;
    $('stemNone').disabled = !current || busy;
  }
  function selectedStems() {
    if (!current) return [];
    var solo = current.stems.some(function(s) { return s.solo && !s.mute; });
    return current.stems.filter(function(s) {
      return !s.mute && (solo ? s.solo : s.enabled);
    });
  }
  function ensureFresh(gen) { if (gen !== generation) throw new Error('Cancelled.'); }
  function readWav(bytes, clipStart, clipEnd) {
    var w = Wav.decodeWavPassage(bytes, clipStart, clipEnd, 96 * 1048576);
    return {channels: w.channels, sr: w.sampleRate, originalRate: w.sampleRate, kind:'WAV',
      passageStartFrame:w.passageStartFrame, sourceFrames:w.sourceFrames};
  }
  function sniffMp3Rate(bytes) {
    var a = new Uint8Array(bytes), start = 0;
    if (a.length >= 10 && String.fromCharCode(a[0],a[1],a[2]) === 'ID3')
      start = 10 + ((a[6] & 127) << 21) + ((a[7] & 127) << 14) + ((a[8] & 127) << 7) + (a[9] & 127);
    for (var i = start; i < Math.min(a.length-3,start+131072); i++) {
      if (a[i] !== 255 || (a[i+1] & 0xe0) !== 0xe0) continue;
      var version = (a[i+1] >> 3) & 3, layer = (a[i+1] >> 1) & 3,
        rateIndex = (a[i+2] >> 2) & 3, bitrate = a[i+2] >> 4;
      if (version === 1 || layer !== 1 || rateIndex === 3 || bitrate === 0 || bitrate === 15) continue;
      var base = [44100,48000,32000][rateIndex];
      return version === 3 ? base : version === 2 ? base / 2 : base / 4;
    }
    return 0;
  }
  // Settle the workspace's await promptly when the user cancels a pending
  // archive read or browser decode. The underlying browser operation is not
  // guaranteed abortable, so late results are ignored, never published.
  function awaitSource(operation, gen, controller) {
    return new Promise(function(resolve, reject) {
      var settled = false;
      function finish(err, value) {
        if (settled) return;
        settled = true;
        if (pendingSourceAbort === abort) pendingSourceAbort = null;
        if (err) reject(err); else resolve(value);
      }
      function abort() {
        if (controller) controller.abort();
        finish(new Error('Cancelled.'));
      }
      pendingSourceAbort = abort;
      Promise.resolve(operation).then(function(value) {
        if (gen !== generation) abort(); else finish(null, value);
      }, finish);
      if (gen !== generation) abort();
    });
  }
  async function decodeStem(stem, gen, targetRate, clipStart, clipEnd) {
    // The ZIP reader otherwise materializes the entire uncompressed entry before
    // the MP3 decoder can apply its 64 MiB input cap. Reject from authenticated
    // central-directory metadata first; ZIP extraction still verifies CRC.
    if (!stem.wav) {
      if (!stem.entry || !Number.isSafeInteger(stem.entry.size) || stem.entry.size < 0 ||
          stem.entry.size > 64 * 1048576)
        throw new Error(stem.name + ': MP3 compressed source exceeds the 64 MiB scan budget.');
      if (!(clipEnd > clipStart && root.SunoStemMp3 && root.AudioDecoder &&
            root.EncodedAudioChunk))
        throw new Error(stem.name + ': MP3 requires a finite selected passage and supported WebCodecs. Full-source or fallback decode is disabled to protect browser memory.');
    }
    status('Unpacking and decoding: ' + stem.name + ' (' + stem.format + ')...');
    var extractAbort = new AbortController();
    var bytes = await awaitSource(current.extract(stem.entry, extractAbort.signal), gen, extractAbort);
    ensureFresh(gen);
    var data;
    if (stem.wav) {
      data = readWav(bytes,clipStart,clipEnd);
    } else if (clipEnd > clipStart && root.SunoStemMp3 && root.AudioDecoder && root.EncodedAudioChunk &&
        (!targetRate || targetRate === sniffMp3Rate(bytes) || $('stemAllowMismatch').checked)) {
      var decodeAbort = new AbortController();
      data = await awaitSource(root.SunoStemMp3.decodePassage(bytes,clipStart,clipEnd,decodeAbort.signal),
        gen,decodeAbort);
    } else {
      // Native full-source decode allocates before its size can be checked.
      // Milestone A supports finite excerpts only, through bounded WebCodecs.
      throw new Error(stem.name + ': MP3 requires a finite selected passage and supported WebCodecs. Full-source or fallback decode is disabled to protect browser memory.');
    }
    ensureFresh(gen);
    if (data.channels.length < 1 || data.channels.length > 2)
      throw new Error(stem.name + ' has more than two channels. Stereo/mono stems are supported.');
    if (data.channels[0].length === 0)
      throw new Error(stem.name + ' is empty.');
    if (targetRate && data.sr !== targetRate) {
      if (!$('stemAllowMismatch').checked)
        throw new Error(stem.name + ' uses ' + data.sr + ' Hz, mix is ' + targetRate +
          ' Hz. Enable explicit sample-rate conversion to proceed.');
      if (!Resample) throw new Error('Band-limited stem converter unavailable.');
      // An excerpt's origin and full-source duration are measured in the
      // same frame domain as its channels after sample-rate conversion.
      // Otherwise build() re-clips an already-excerpted buffer at an absolute
      // source offset, silently removing a mixed-rate stem.
      var originalSampleRate = data.sr;
      data.channels = Resample.resample(data.channels, originalSampleRate, targetRate);
      if (data.passageStartFrame !== undefined)
        data.passageStartFrame = Math.round(data.passageStartFrame * targetRate / originalSampleRate);
      if (data.sourceFrames !== undefined)
        data.sourceFrames = Math.round(data.sourceFrames * targetRate / originalSampleRate);
      data.sr = targetRate;
    }
    return data;
  }
  async function processed(stem, data, gen) {
    if (!stem.clean && !stem.polish) return data;
    status('Processing ' + stem.name + (stem.clean ? ' (clean' : '') +
      (stem.polish ? (stem.clean ? ', polish)' : ' (polish)') : (stem.clean ? ')' : '')) + '...');
    var channels=data.channels;
    var args = {type:'stem-process', channels:channels, sampleRate:data.sr,
      clean:stem.clean, polish:stem.polish,
      cleanParams: Engine.DEFAULTS,
      polishParams: {clarity:stem.clarity,presence:stem.presence,dynamics:stem.dynamics,
        targetLufs:stem.target==='off'?null:Number(stem.target)} };
    var outcome = await new Promise(function(resolve,reject) {
      var w;
      try { w = new Worker('stem-audio-worker.js'); } catch (e) {
        reject(new Error('This browser cannot start the local stem-processing worker.')); return;
      }
      var settled = false;
      function settle(err, value) {
        if (settled) return;
        settled = true;
        if (pendingProcessAbort === abort) pendingProcessAbort = null;
        if (worker === w) worker = null;
        try { w.terminate(); } catch (_) {}
        if (err) reject(err); else resolve(value);
      }
      function abort() { settle(new Error('Cancelled.')); }
      worker = w;
      pendingProcessAbort = abort;
      w.onmessage = function(e) {
        if (gen !== generation || worker !== w) return;
        if (e.data.type === 'done') settle(null, e.data);
        else if (e.data.type === 'error')
          settle(new Error(e.data.message || 'Stem processing failed.'));
      };
      w.onerror = function(e) {
        if (e.preventDefault) e.preventDefault();
        if (gen !== generation || worker !== w) return;
        settle(new Error(e.message || 'Stem-processing worker failed.'));
      };
      try {
        w.postMessage(args, channels.map(function(ch){return ch.buffer;}));
      } catch (err) {
        settle(new Error('Could not send audio to stem worker: ' + (err.message || String(err))));
      }
    });
    ensureFresh(gen);
    if (outcome.note) status(stem.name + ': ' + outcome.note);
    return {channels: outcome.channels, sr: data.sr};
  }
  function validatePassage(stem) {
    var from = Number(stem.passageStart == null ? 0 : stem.passageStart),
      to = Number(stem.passageEnd == null ? 0 : stem.passageEnd),
      reduction = Number(stem.passageReduction == null ? 0 : stem.passageReduction);
    if (!Number.isFinite(from) || !Number.isFinite(to) || !Number.isFinite(reduction) ||
        from < 0 || to < 0 || reduction < 0 || reduction > 100)
      throw new Error(stem.name + ': passage values must be finite and nonnegative; reduction 0-100%.');
    if (reduction > 0 && to <= from)
      throw new Error(stem.name + ': passage end must be after start when reduction is enabled.');
    return {from: from, to: to, reduction: reduction / 100};
  }
  function sumInto(mix, data, stem, clipStartFrame) {
    var gain = Math.pow(10, stem.volume / 20),
      n = Math.min(mix[0].length, data.channels[0].length),
      left = data.channels[0], right = data.channels[1] || left,
      edit = validatePassage(stem);
    if (!edit.reduction) {
      for (var i = 0; i < n; i++) {
        mix[0][i] += left[i] * gain;
        mix[1][i] += right[i] * gain;
      }
      return;
    }
    var from = Math.round(edit.from * data.sr) - clipStartFrame,
      to = Math.round(edit.to * data.sr) - clipStartFrame,
      // Compress both fades symmetrically so a short mute can reach full depth.
      fadeFrames = Math.max(1, Math.min(Math.round(0.020 * data.sr),
        Math.floor((to - from) / 2)));
    // A one-frame interval has no interior sample for continuous edge fades.
    if (to - from < 2)
      throw new Error(stem.name + ': passage attenuation requires at least two audio sample frames for continuous fades.');
    for (var j = 0; j < n; j++) {
      // A 20 ms fade on both boundaries, anchored in the original timeline.
      var depth = (j > from && j < to) ?
        Math.min(1, (j - from) / fadeFrames, (to - j) / fadeFrames) : 0;
      var g = gain * (1 - edit.reduction * depth);
      mix[0][j] += left[j] * g;
      mix[1][j] += right[j] * g;
    }
  }
  function clipDecoded(data, fromFrame, frames) {
    // Copy only the requested interval before worker processing; pad only when
    // a deliberate length-mismatch override allows a shorter source.
    var clipped = data.channels.map(function(ch) {
      var out = new Float32Array(frames);
      if (fromFrame < ch.length)
        out.set(ch.subarray(fromFrame, Math.min(ch.length, fromFrame + frames)));
      return out;
    });
    return {channels:clipped, sr:data.sr};
  }
  function alignDecodedPassage(data, fromFrame, frames) {
    // WebCodecs has already decoded a passage. Its origin is expressed in
    // target-rate frames, and independent source/target rounding can differ
    // by one frame. Never treat this buffer as full-source audio.
    var origin = data.passageStartFrame;
    if (!Number.isSafeInteger(origin) || origin < 0)
      throw new Error('Decoded passage has an invalid frame origin.');
    var offset = fromFrame - origin;
    if (offset === 0 && data.channels.every(function(ch) { return ch.length === frames; }))
      return data;
    var channels = data.channels.map(function(ch) {
      var out = new Float32Array(frames);
      var srcFrom = Math.max(0, offset), dstFrom = Math.max(0, -offset);
      var count = Math.min(ch.length - srcFrom, frames - dstFrom);
      if (count > 0) out.set(ch.subarray(srcFrom, srcFrom + count), dstFrom);
      return out;
    });
    return {channels:channels, sr:data.sr, sourceFrames:data.sourceFrames};
  }
  function toBuffer(channels, sampleRate) {
    var c=audioContext(), out=c.createBuffer(channels.length,channels[0].length,sampleRate);
    channels.forEach(function(ch,index){out.copyToChannel(ch,index);});
    return out;
  }
  async function build(kind, stem) {
    if (busy || !current) return;
    cancel(); clearPreview();
    // Always choose the decode rate from the stem(s) requested for this build,
    // not a stale AudioContext used by an earlier preview.
    if (context) { context.close().catch(function(){}); context = null; }
    busy = true; renderActions();
    var gen=generation, selected=kind==='stem'?[stem]:selectedStems(), mix=null;
    var largestDecodedBytes=0;
    if (!selected.length) {
      busy=false;renderActions();status('Enable at least one unmuted stem, or select Solo.',true);return;
    }
    var mismatchMessages = [], passageWarnings = [];
    // MP3 decoder priming is not normalized against WAV sample zero.
    // Explicit length/rate mismatch consent is NOT consent to a time shift.
    if (selected.some(function(s){return !s.wav;}) &&
        selected.some(function(s){return !!s.wav;})) {
      busy=false;renderActions();
      status('Cannot mix MP3 and WAV stems until decoder priming and sample alignment are verified. Use one source format.',true);
      return;
    }
    try {
      var rate=0, frames=0, sourceFrames=0, clipStartFrame=0,
        allocated=0, firstNativeRate=0;
      var clipStart=Number($('stemClipStart').value), clipEnd=Number($('stemClipEnd').value);
      if (!Number.isFinite(clipStart) || !Number.isFinite(clipEnd) ||
          clipStart < 0 || clipEnd < 0 || (clipEnd !== 0 && clipEnd <= clipStart))
        throw new Error('Preview range must have nonnegative, finite seconds and an end after the start. Use end 0 for full length.');
      selected.forEach(validatePassage);
      for (var i=0;i<selected.length;i++) {
        ensureFresh(gen);
        var s=selected[i];
        status('Stem ' + (i+1) + ' of ' + selected.length + ': ' + s.name);
        var data;
        try { data=await decodeStem(s,gen,rate || null,clipStart,clipEnd); }
        catch (err) {
          // Bounded WAV/MP3 readers reject a passage beyond the source before
          // any decode; report it as a range problem, not a memory problem.
          if (err && err.code === 'PASSAGE_TOO_SHORT')
            throw new Error('Preview range is shorter than one audio sample at this rate. Choose a longer interval.');
          if (!err || err.code !== 'PASSAGE_OUT_OF_RANGE') throw err;
          var secs=Number.isFinite(err.sourceSeconds) ? ' (' + err.sourceSeconds.toFixed(2) + ' seconds)' : '';
          throw new Error(rate ? 'Preview passage is outside the duration of ' + s.name + secs + '.'
            : 'Preview passage is outside the first stem duration' + secs + '.');
        }
        ensureFresh(gen);
        var decodedBytes=data.channels.reduce(function(total,ch){return total+ch.byteLength;},0);
        largestDecodedBytes=Math.max(largestDecodedBytes,decodedBytes);
        memoryReport(largestDecodedBytes,allocated,'building');
        if (!firstNativeRate) firstNativeRate = data.originalRate || data.sr;
        else if (data.originalRate && firstNativeRate !== data.originalRate) {
          mismatchMessages.push(s.name + ' native sample rate is ' + data.originalRate +
            ' Hz; first stem is ' + firstNativeRate + ' Hz.');
          if (!$('stemAllowMismatch').checked)
            throw new Error('Source sample rates differ. Enable explicit mismatch handling or export individual stems.');
        }
        if (!rate) {
          rate=data.sr; sourceFrames=data.sourceFrames || data.channels[0].length;
          clipStartFrame=Math.round(clipStart*rate);
          var clipEndFrame=clipEnd===0 ? sourceFrames : Math.round(clipEnd*rate);
          if (clipStartFrame >= sourceFrames || clipEndFrame > sourceFrames)
            throw new Error('Preview passage is outside the first stem duration (' +
              (sourceFrames/rate).toFixed(2) + ' seconds).');
          frames=clipEndFrame-clipStartFrame;
          if (!Number.isSafeInteger(frames) || frames < 1)
            throw new Error('Preview range is shorter than one audio sample at this rate. Choose a longer interval.');
          allocated=frames*2*4;
          if (allocated>MAX_MIX_BYTES)
            throw new Error('Mix passage would need ' + (allocated/1048576).toFixed(1) +
              ' MiB. The 96 MiB preview limit was exceeded. Set a shorter preview end.');
          mix=[new Float32Array(frames),new Float32Array(frames)];
        } else {
          var delta=(data.sourceFrames || data.channels[0].length)-sourceFrames;
          if (delta) {
            var diff=delta/rate;
            mismatchMessages.push(s.name + ' differs by ' + diff.toFixed(4) + ' seconds.');
            if (!$('stemAllowMismatch').checked)
              throw new Error('Stem lengths differ: ' + mismatchMessages.join(' ') +
                ' Select the mismatch checkbox to permit start-aligned trimming/padding.');
          }
        }
        var edit = validatePassage(s);
        if (edit.reduction) {
          var duration=(data.sourceFrames || data.channels[0].length)/data.sr,
            previewFrom=clipStartFrame/rate, previewTo=(clipStartFrame+frames)/rate;
          if (edit.from >= duration) {
            passageWarnings.push(s.name + ': attenuation starts beyond the source duration and has no effect.');
          } else if (edit.to <= previewFrom || edit.from >= previewTo) {
            passageWarnings.push(s.name + ': attenuation does not overlap the selected preview and has no effect here.');
          } else if (edit.to > duration) {
            passageWarnings.push(s.name + ': attenuation extends beyond the available source and is truncated.');
          }
        }
        data=data.passageStartFrame !== undefined ?
          alignDecodedPassage(data,clipStartFrame,frames) : clipDecoded(data,clipStartFrame,frames);
        data=await processed(s,data,gen);
        ensureFresh(gen);
        sumInto(mix,data,s,clipStartFrame);
        // Do not retain decoded input/processed channels after summing them.
      }
      ensureFresh(gen);
      var peak=0;
      for (var c=0;c<2;c++) for (var j=0;j<frames;j++) peak=Math.max(peak,Math.abs(mix[c][j]));
      buffer=toBuffer(mix,rate); mix=null; position=0;
      memoryReport(largestDecodedBytes,allocated + buffer.length*buffer.numberOfChannels*4,'preview ready');
      audioLabel=(kind==='stem'?stem.name:'Selected stems') +
        ' [' + clipStart.toFixed(1) + 's-' +
        (clipEnd===0 ? (sourceFrames/rate).toFixed(1) : clipEnd.toFixed(1)) + 's]';
      $('stemMixInfo').textContent = audioLabel + ' · ' + fmtTime(buffer.duration) +
        ' · ' + rate + ' Hz · peak ' + peak.toFixed(3) +
        (peak>1?' (above full scale: integer WAV/MP3 may clip)':'') +
        (mismatchMessages.length?' · LENGTH/RATE WARNING: '+mismatchMessages.join(' '):'') +
        (passageWarnings.length?' · PASSAGE WARNING: '+passageWarnings.join(' '):'');
      status('Ready to play/export: ' + audioLabel + (mismatchMessages.length?
        '. Check that these decoded stems stay aligned by listening.':'') +
        (passageWarnings.length?' Passage warning: '+passageWarnings.join(' '):''));
      updateTime();
    } catch(err) {
      if (gen===generation) {
        clearPreview();
        memoryReport(largestDecodedBytes,allocated,'build failed');
        status('Could not build audio: '+(err.message||String(err)),true);
      }
    } finally {
      if (gen===generation) { busy=false; renderActions(); }
    }
  }
  function download(bytes,filename,type) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl=URL.createObjectURL(new Blob([bytes],{type:type}));
    var a=document.createElement('a'); a.href=objectUrl; a.download=filename;
    document.body.appendChild(a); a.click(); a.remove();
    var url=objectUrl;
    setTimeout(function(){URL.revokeObjectURL(url);if(objectUrl===url)objectUrl=null;},60000);
  }
  async function exportAudio() {
    if (!buffer || busy) return;
    var format=$('stemBits').value, isMp3=format.indexOf('mp3-')===0;
    var name=(current?current.file.name.replace(/\.zip$/i,''):'Stems')+' - '+audioLabel;
    name=nameSafe(name);
    var channels=Array.from({length:buffer.numberOfChannels},function(_,i){return buffer.getChannelData(i);});
    var max=0;
    for(var c=0;c<channels.length;c++)for(var i=0;i<channels[c].length;i++)max=Math.max(max,Math.abs(channels[c][i]));
    if (max>1 && (isMp3 || format!=='32') &&
      !root.confirm('This mix peaks above full scale. Integer WAV and MP3 will clip. Continue anyway?')) return;
    try {
      if (!isMp3) {
        var bytes=Wav.encodeWav(channels,buffer.sampleRate,Number(format));
        download(bytes,name+'.wav','audio/wav');
        status('WAV exported locally.');return;
      }
      busy=true;renderActions();
      status('Encoding MP3 in a local worker...');
      var job=++generation;
      var copy=channels.map(function(ch){return ch.slice();}), w=new Worker('export-worker.js');
      worker=w;
      w.onmessage=function(e) {
        if (job!==generation || worker!==w) return;
        if (e.data.type==='progress') {
          status('Encoding MP3: '+Math.round(e.data.fraction*100)+'%');return;
        }
        w.terminate();worker=null;busy=false;renderActions();
        if (e.data.type==='done') {
          download(e.data.bytes,name+'.mp3','audio/mpeg');
          status('MP3 exported locally.');
        } else status('MP3 export failed: '+(e.data.message||'Unknown error'),true);
      };
      w.onerror=function(e) {
        if(e.preventDefault)e.preventDefault();
        if(job!==generation||worker!==w)return;
        worker=null;w.terminate();busy=false;renderActions();
        status('MP3 encoder worker failed.',true);
      };
      w.postMessage({type:'mp3',channels:copy,sampleRate:buffer.sampleRate,
        bitrate:Number(format.slice(4))},copy.map(function(ch){return ch.buffer;}));
    } catch(err) {
      busy=false;renderActions();
      status('Export failed: '+(err.message||String(err)),true);
    }
  }
  root.SunoStemUI={open:open,close:close};
})(window);
