/* Suno stem workspace. All ZIP reads, decoding, processing and exporting are local.
 * One compressed entry/decoded stem is processed at a time. No audio leaves the tab.
 */
(function(root) {
  'use strict';
  var Zip = root.SunoStemZip, Wav = root.WavCodec, Engine = root.ShimmerEngine;
  var MAX_MIX_BYTES = 96 * 1024 * 1024;
  var LENGTH_TOLERANCE_SECONDS = 0.025;
  var current = null, generation = 0, worker = null;
  var context = null, buffer = null, source = null, startedAt = 0, position = 0, playing = false;
  var audioLabel = '', busy = false, timer = 0, objectUrl = null;
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
      '<div class="stem-toolbar"><button type="button" id="stemAll">Enable all</button>',
      '<button type="button" id="stemNone">Disable all</button>',
      '<button type="button" id="stemStop">Cancel processing</button></div>',
      '<div id="stemList" class="stem-list" aria-label="Stems in archive"></div>',
      '<p class="stem-note">Stereo stems remain start-aligned from decoded sample zero. MP3 encoder delay cannot be inferred reliably; verify sync by listening. WAV variants are preferred when provided.</p>',
      '<label class="stem-allow"><input type="checkbox" id="stemAllowMismatch"> Allow zero-padding or trimming of mismatched stem lengths/rates (never time-shift stems)</label>',
      '<div class="stem-build"><button type="button" id="stemBuild">Build selected mix</button>',
      '<span id="stemMixInfo" class="stem-note">No mix built.</span></div>',
      '<div class="stem-playback"><button type="button" id="stemPlay">Play preview</button>',
      '<label for="stemSeek">Playback position</label><input id="stemSeek" type="range" min="0" max="1000" step="1" value="0">',
      '<span id="stemTime">0:00 / 0:00</span></div>',
      '<div class="stem-build"><label for="stemBits">Download as</label>',
      '<select id="stemBits"><option value="32">32-bit float WAV</option><option value="24">24-bit WAV</option>',
      '<option value="16">16-bit WAV</option><option value="mp3-320">MP3 320 kilobits/s</option>',
      '<option value="mp3-256">MP3 256 kilobits/s</option><option value="mp3-192">MP3 192 kilobits/s</option></select>',
      '<button type="button" id="stemExport">Export previewed mix or stem</button></div>',
      '<p class="stem-note">Individual preview and export use the selected stem controls. A compiled mix sums enabled unmuted stems; Solo overrides Enable but not Mute.',
      ' Processing is sequential and can take time. For safety the decoded mix is limited to 96 MiB; long/high-rate tracks require a smaller selection or a desktop editor.</p>',
      '</div>'
    ].join('');
    document.body.appendChild(box);
    ['stemHeading','stemNew','stemNewFile','stemClose','stemStatus','stemArchive','stemWarnings',
      'stemAll','stemNone','stemStop','stemList','stemAllowMismatch','stemBuild','stemMixInfo',
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
      details.append(params, hint); card.append(details); list.append(card);
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
  function readWav(bytes) {
    var w = Wav.decodeWav(bytes);
    return {channels: w.channels, sr: w.sampleRate, originalRate: w.sampleRate, kind:'WAV'};
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
  function resample(chans, oldRate, newRate) {
    var n = Math.round(chans[0].length * newRate / oldRate);
    return chans.map(function(src) {
      var out = new Float32Array(n);
      for (var i=0; i<n; i++) {
        var x=i*oldRate/newRate, a=Math.min(Math.floor(x),src.length-1), b=Math.min(a+1,src.length-1), t=x-a;
        out[i]=src[a]*(1-t)+src[b]*t;
      }
      return out;
    });
  }
  async function decodeStem(stem, gen, targetRate) {
    status('Unpacking and decoding: ' + stem.name + ' (' + stem.format + ')...');
    var bytes = await current.extract(stem.entry);
    ensureFresh(gen);
    var data;
    if (stem.wav) {
      data = readWav(bytes);
    } else {
      var rate = sniffMp3Rate(bytes);
      // decodeAudioData resamples to the AudioContext rate, which may differ
      // from the MP3's native header rate. Compare native rates separately.
      var ctx = audioContext(targetRate || rate || 48000);
      var decoded = await ctx.decodeAudioData(bytes);
      data = {channels: Array.from({length: decoded.numberOfChannels}, function(_, c) {
        return decoded.getChannelData(c).slice();
      }), sr: ctx.sampleRate, originalRate: rate, kind:'MP3'};
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
      data.channels = resample(data.channels,data.sr,targetRate); data.sr = targetRate;
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
      worker = w;
      w.onmessage = function(e) {
        if (gen !== generation || worker !== w) return;
        if (e.data.type === 'done') { worker = null; w.terminate(); resolve(e.data); }
        else if (e.data.type === 'error') { worker = null; w.terminate(); reject(new Error(e.data.message)); }
      };
      w.onerror = function(e) {
        if (e.preventDefault) e.preventDefault();
        if (gen !== generation || worker !== w) return;
        worker = null; w.terminate(); reject(new Error(e.message || 'Stem-processing worker failed.'));
      };
      w.postMessage(args, channels.map(function(ch){return ch.buffer;}));
    });
    ensureFresh(gen);
    if (outcome.note) status(stem.name + ': ' + outcome.note);
    return {channels: outcome.channels, sr: data.sr};
  }
  function sumInto(mix, data, stem) {
    var gain = Math.pow(10, stem.volume / 20), n=Math.min(mix[0].length, data.channels[0].length);
    var left=data.channels[0], right=data.channels[1]||left;
    for (var i=0;i<n;i++) { mix[0][i]+=left[i]*gain; mix[1][i]+=right[i]*gain; }
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
    if (!selected.length) {
      busy=false;renderActions();status('Enable at least one unmuted stem, or select Solo.',true);return;
    }
    var mismatchMessages = [];
    try {
      var rate=0, frames=0, allocated=0, firstNativeRate=0;
      for (var i=0;i<selected.length;i++) {
        ensureFresh(gen);
        var s=selected[i];
        status('Stem ' + (i+1) + ' of ' + selected.length + ': ' + s.name);
        var data=await decodeStem(s,gen,rate || null);
        ensureFresh(gen);
        if (!firstNativeRate) firstNativeRate = data.originalRate || data.sr;
        else if (data.originalRate && firstNativeRate !== data.originalRate) {
          mismatchMessages.push(s.name + ' native sample rate is ' + data.originalRate +
            ' Hz; first stem is ' + firstNativeRate + ' Hz.');
          if (!$('stemAllowMismatch').checked)
            throw new Error('Source sample rates differ. Enable explicit mismatch handling or export individual stems.');
        }
        if (!rate) {
          rate=data.sr;frames=data.channels[0].length;
          allocated=frames*2*4;
          if (allocated>MAX_MIX_BYTES)
            throw new Error('Mix would need ' + (allocated/1048576).toFixed(1) +
              ' MiB of decoded audio. The 96 MiB safety limit was exceeded. Use a shorter source.');
          mix=[new Float32Array(frames),new Float32Array(frames)];
        } else {
          var delta=data.channels[0].length-frames;
          if (delta) {
            var diff=delta/rate;
            mismatchMessages.push(s.name + ' differs by ' + diff.toFixed(4) + ' seconds.');
            if (Math.abs(diff)>LENGTH_TOLERANCE_SECONDS && !$('stemAllowMismatch').checked)
              throw new Error('Stem lengths differ: ' + mismatchMessages.join(' ') +
                ' Select the mismatch checkbox to permit start-aligned trimming/padding.');
          }
        }
        data=await processed(s,data,gen);
        ensureFresh(gen);
        sumInto(mix,data,s);
        // Do not retain decoded input/processed channels after summing them.
      }
      ensureFresh(gen);
      var peak=0;
      for (var c=0;c<2;c++) for (var j=0;j<frames;j++) peak=Math.max(peak,Math.abs(mix[c][j]));
      buffer=toBuffer(mix,rate); mix=null; position=0;
      audioLabel=kind==='stem'?stem.name:'Selected stems';
      $('stemMixInfo').textContent = audioLabel + ' · ' + fmtTime(buffer.duration) +
        ' · ' + rate + ' Hz · peak ' + peak.toFixed(3) +
        (peak>1?' (above full scale: integer WAV/MP3 may clip)':'') +
        (mismatchMessages.length?' · LENGTH/RATE WARNING: '+mismatchMessages.join(' '):'');
      status('Ready to play/export: ' + audioLabel + (mismatchMessages.length?
        '. Check that these decoded stems stay aligned by listening.':''));
      updateTime();
    } catch(err) {
      if (gen===generation) {
        clearPreview(); status('Could not build audio: '+(err.message||String(err)),true);
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
