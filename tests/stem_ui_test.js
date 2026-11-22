/* Browser-UI state integration for the actual stem workspace, without external packages.
 * Uses synthetic WAV data and a simulated document/AudioContext/worker.
 * No private Suno material or browser behavior is asserted here.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const wav=require('../wav.js'),Polish=require('../polish.js'),Engine=require('../engine.js'),
  Resample=require('../stem-resample.js');
const source=fs.readFileSync(path.join(__dirname,'../stem-ui.js'),'utf8');
function samples(level,sr,seconds) {
  return Float32Array.from({length:Math.round(sr*seconds)},()=>level);
}
function fakeStem(name,level,sr=48000,seconds=1) {
  const data=wav.encodeWav([samples(level,sr,seconds),samples(level,sr,seconds)],sr,32);
  const item={name:name+'.wav',size:data.byteLength};
  return {name:name,key:name,wav:item,mp3:null,entry:item,format:'WAV',enabled:true,mute:false,
    solo:false,volume:0,clean:false,polish:false,clarity:20,presence:20,dynamics:0,target:'off',
    _file:data};
}
function harness(stems, options={}) {
  const nodes=new Map(),downloaded=[],audios=[],workers=[];
  class E {
    constructor(tag='div') {
      this.tag=tag;this.id='';this.hidden=false;this.disabled=false;this.checked=false;
      this.textContent='';this.value='';this.children=[];this.style={};this.listeners={};
      this.classList={toggle(){},add(){},remove(){}};
    }
    set innerHTML(html) {
      this._innerHTML=html;
      for(const match of html.matchAll(/\bid="([^"]+)"/g)) {
        const e=new E('div');e.id=match[1];nodes.set(e.id,e);
      }
    }
    get innerHTML(){return this._innerHTML||'';}
    setAttribute(name,value){this[name]=value;}
    addEventListener(type,fn){(this.listeners[type] ||= []).push(fn);}
    fire(type){for(const f of this.listeners[type]||[])f.call(this,{target:this,preventDefault(){}});}
    append(...items){this.children.push(...items);}
    appendChild(el){this.children.push(el);if(this.tag==='body' && el.id)nodes.set(el.id,el);return el;}
    replaceChildren(...items){this.children=items;}
    remove(){}
    click(){if(this.tag==='a')downloaded.push(this.download);else this.fire('click');}
    focus(){}
  }
  const document={body:new E('body'),createElement(tag){return new E(tag);},
    createTextNode(str){const e=new E('text');e.textContent=str;return e;},
    getElementById(id){return nodes.get(id)||null;}};
  class AB {
    constructor({length,numberOfChannels,sampleRate}) {
      this.length=length;this.numberOfChannels=numberOfChannels;this.sampleRate=sampleRate;
      this.duration=length/sampleRate;
      this.data=Array.from({length:numberOfChannels},()=>new Float32Array(length));
    }
    copyToChannel(c,i){this.data[i].set(c);}
    getChannelData(i){return this.data[i];}
  }
  class AC {
    constructor(options){this.sampleRate=(options&&options.sampleRate)||48000;this.currentTime=0;this.destination={};}
    createBuffer(ch,n,sr){const b=new AB({length:n,numberOfChannels:ch,sampleRate:sr});audios.push(b);return b;}
    createBufferSource(){return {connect(){},disconnect(){},start(){},stop(){}};}
    resume(){return Promise.resolve();}
    close(){return Promise.resolve();}
    decodeAudioData(){
      if(options.mp3NoFullCopy) {
        const channel=new Float32Array(48000).fill(.25);
        channel.slice=()=>{throw Error('Full MP3 channel cloning is forbidden');};
        return Promise.resolve({length:48000,numberOfChannels:2,
          getChannelData(){return channel;}});
      }
      if(options.oversizedMp3) return Promise.resolve({length:30000000,numberOfChannels:2,
        getChannelData(){throw Error('Oversized decoder must not copy channels');}});
      throw Error('Unexpected MP3 decode in WAV-only test');
    }
  }
  class Worker {
    constructor(url){this.url=url;this.terminated=false;workers.push(this);}
    postMessage(m){
      if(this.url==='stem-audio-worker.js') {
        if(options.holdStemWorker) {this.pending=m;return;}
        let channels=m.channels;
        if(m.clean)channels=Engine.process(channels,m.sampleRate,Engine.DEFAULTS).clean;
        if(m.polish)channels=Polish.process(channels,m.sampleRate,m.polishParams).channels;
        queueMicrotask(()=>this.onmessage&&this.onmessage({data:{type:'done',channels}}));
      } else if(this.url==='export-worker.js') {
        if(options.holdMp3Export) {this.pending=m;return;}
        queueMicrotask(()=>this.onmessage&&this.onmessage({data:{type:'done',bytes:Uint8Array.of(1,2),peak:.3}}));
      }
      else throw Error('Unknown worker '+this.url);
    }
    terminate(){this.terminated=true;}
  }
  let releaseHeldExtract=null, heldOnce=false, heldSignal=null;
  const archive={stems,file:{name:'Synthetic Stems.zip'},compressedBytes:2000,totalBytes:stems.reduce((sum,x)=>sum+x._file.byteLength,0),
    async extract(entry, signal){
      const s=stems.find(x=>x.entry===entry);if(!s)throw Error('Missing synthetic entry');
      if(options.holdFirstExtract && !heldOnce) {
        heldOnce=true;
        heldSignal=signal;
        return new Promise(resolve=>{releaseHeldExtract=()=>resolve(s._file);});
      }
      return s._file;
    }};
  const root={SunoStemZip:{open:async()=>archive},WavCodec:wav,ShimmerEngine:Engine,
    SunoStemResample:Resample,AudioContext:AC,
    confirm:()=>true};
  if(options.webCodecs) {
    root.AudioDecoder=class {};
    root.EncodedAudioChunk=class {};
    root.SunoStemMp3={async decodePassage(bytes,start,end) {
      const sr=44100, length=Math.round((end-start)*sr);
      return {channels:[new Float32Array(length).fill(.3),new Float32Array(length).fill(.3)],
        sr,originalRate:sr,sourceFrames:Math.round(4*sr),
        passageStartFrame:Math.round(start*sr),kind:'MP3'};
    }};
  }
  const URLs={createObjectURL:()=> 'blob:synthetic',revokeObjectURL(){}};
  const ctx={window:root,document,Worker,Blob,URL:URLs,console,Float32Array,Uint8Array,
    ArrayBuffer,TextDecoder,AbortController,setInterval:()=>1,clearInterval(){},setTimeout:()=>0};
  vm.runInNewContext(source,ctx,{timeout:5000,filename:'stem-ui.js'});
  const el=id=>{const e=nodes.get(id);assert(e,'Missing '+id);return e;};
  return {ui:root.SunoStemUI,el,nodes,stems,downloaded,audios,workers,
    releaseHeldExtract(){assert(releaseHeldExtract,'held extraction missing');releaseHeldExtract();},
    heldExtractionAborted(){return heldSignal && heldSignal.aborted;}};
}
// A 44.1 kHz excerpt must retain its absolute origin after explicit
// conversion to a 48 kHz mix. It must not be clipped a second time.
// MP3 encoder priming is not aligned to WAV sample zero. Rate/length
// mismatch consent must never bypass the mixed-format rejection.
async function mixedFormatFailClosedRegression() {
  for (const mp3First of [false,true]) {
    for (const consent of [false,true]) {
      const wavStem=fakeStem('Reference',.2,48000,4);
      const mp3Stem=fakeStem('MP3 excerpt',.3,44100,4);
      mp3Stem.wav=null;mp3Stem.mp3=mp3Stem.entry;mp3Stem.format='MP3';
      mp3Stem._file=Uint8Array.of(255,251,144,0);
      const h=harness(mp3First?[mp3Stem,wavStem]:[wavStem,mp3Stem],{webCodecs:true});
      await h.ui.open({name:'Unaligned mixed formats.zip',size:2000});
      h.el('stemClipStart').value='0.0001';
      h.el('stemClipEnd').value='0.1';
      h.el('stemAllowMismatch').checked=consent;
      h.el('stemBuild').fire('click');await flush();
      assert.match(h.el('stemStatus').textContent,/Cannot mix MP3 and WAV stems/);
      assert.equal(h.audios.length,0,'unsafe mixed formats must not publish preview');
      assert.equal(h.el('stemExport').disabled,true,'unsafe mixed formats must not export');
      h.ui.close();
    }
  }
}
async function flush(){
  for(let i=0;i<7;i++)await new Promise(resolve=>setImmediate(resolve));
}
(async()=>{
  await mixedFormatFailClosedRegression();
  const h=harness([fakeStem('Lead Vocals',.2),fakeStem('Drums',.3)]);
  await h.ui.open({name:'Synthetic Stems.zip',size:1234});
  assert.equal(h.el('stemList').children.length,2,'two stem cards');
  assert.match(h.el('stemArchive').textContent,/2 distinct stems/);
  assert.match(h.el('stemStatus').textContent,/Archive inspected/);
  assert.equal(h.audios.length,0,'no audio decoded or compiled merely by opening a ZIP');

  h.el('stemBuild').fire('click');await flush();
  assert.equal(h.audios.length,1,'mixed audio compiled');
  assert.match(h.el('stemMemory').textContent,/decoded source 0[.]4 MiB, preview buffers 0[.]7 MiB/,
    'visible memory report identifies source and preview allocations');
  assert.match(h.el('stemMemory').textContent,/Audio decoder.native memory is not measured/,
    'memory telemetry must not claim to measure native decoder memory');
  assert(Math.abs(h.audios[0].getChannelData(0)[2]-.5)<1e-6,'mix sums two enabled stems without normalizing');
  assert.equal(h.el('stemExport').disabled,false);
  // The synthetic document does not parse select option defaults.
  h.el('stemBits').value='32';
  h.el('stemExport').fire('click');
  assert(h.downloaded[0].endsWith('.wav'),'local WAV export');

  h.stems[1].mute=true;
  h.el('stemBuild').fire('click');await flush();
  assert.equal(h.audios.length,2);
  assert(Math.abs(h.audios[1].getChannelData(0)[2]-.2)<1e-6,'muted stem excluded from mix');
  h.stems[0].enabled=false;h.stems[1].mute=false;h.stems[1].solo=true;
  h.el('stemBuild').fire('click');await flush();
  assert.equal(h.audios.length,3);
  assert(Math.abs(h.audios[2].getChannelData(0)[2]-.3)<1e-6,'solo ignores Enable but not Mute');

  h.stems[0].enabled=true;h.stems[1].solo=false;h.stems[1].mute=true;
  h.stems[0].volume=6;
  h.el('stemBuild').fire('click');await flush();
  assert(Math.abs(h.audios.at(-1).getChannelData(0)[2]-(.2*Math.pow(10,6/20)))<1e-6,
    'individual stem gain controls mix level');
  h.el('stemBits').value='mp3-320';
  h.el('stemExport').fire('click');await flush();
  assert(h.downloaded.at(-1).endsWith('.mp3'),'local background MP3 export');
  assert(h.workers.some(w=>w.url==='export-worker.js'),'MP3 encoding uses existing background worker');

  h.stems[0].volume=0;h.stems[0].polish=true;h.stems[0].clarity=50;
  h.el('stemBuild').fire('click');await flush();
  assert(h.workers.some(w=>w.url==='stem-audio-worker.js'),'stem polish worker was used');
  assert.equal(h.el('stemExport').disabled,false);

  // Build only a 1-3 second passage from longer sources. Apply a time-local
  // attenuation only to Other, without removing Percussion or altering sync.
  const p=harness([fakeStem('Other',.2,48000,4),fakeStem('Percussion',.3,48000,4)]);
  await p.ui.open({name:'Passage Stems.zip',size:2000});
  p.el('stemClipStart').value='1';
  p.el('stemClipEnd').value='3';
  p.stems[0].passageStart=1.5;
  p.stems[0].passageEnd=2.5;
  p.stems[0].passageReduction=100;
  p.el('stemBuild').fire('click');await flush();
  assert.equal(p.el('stemExport').disabled,false,'passage preview succeeded');
  const segment=p.audios.at(-1).getChannelData(0);
  assert.equal(segment.length,96000,'only the requested two seconds are compiled');
  assert(Math.abs(segment[12000]-.5)<1e-6,'both stems audible before the mute');
  assert(Math.abs(segment[48000]-.3)<1e-6,'Other is muted only during its interval');
  assert(Math.abs(segment[84000]-.5)<1e-6,'Other returns after the mute');
  assert(Math.abs(segment[24480]-.4)<1e-5,'20 ms fade-in is halfway after 10 ms');
  assert(Math.abs(segment[71520]-.4)<1e-5,'20 ms fade-out restores volume before the end');
  assert(Math.abs(segment[24000]-.5)<1e-6,'no discontinuity at passage start');
  assert(Math.abs(segment[72000]-.5)<1e-6,'no discontinuity at passage end');
  assert.equal(p.audios.at(-1).duration,2,'output duration is the selected preview');
  p.stems[0].passageReduction=0;
  p.el('stemBuild').fire('click');await flush();
  assert(Math.abs(p.audios.at(-1).getChannelData(0)[48000]-.5)<1e-6,
    'bypass restores original stem without destructive changes');
  p.stems[0].passageReduction=100;
  p.stems[0].passageEnd=1.0;
  p.el('stemBuild').fire('click');await flush();
  assert.match(p.el('stemStatus').textContent,/passage end must be after start/);
  assert.equal(p.el('stemExport').disabled,true,'invalid passage cannot export');
  p.stems[0].passageEnd=2.5;
  p.el('stemClipEnd').value='5';
  p.el('stemBuild').fire('click');await flush();
  assert.match(p.el('stemStatus').textContent,/outside the first stem duration/);
  p.el('stemClipEnd').value='3';
  p.el('stemClipStart').value='3';
  p.el('stemBuild').fire('click');await flush();
  assert.match(p.el('stemStatus').textContent,/Preview range must/);
  // Inert selected-stem intervals must be visibly explained, not mistaken
  // for a failed shimmer-removal algorithm.
  p.stems[0].passageStart=3.3;
  p.stems[0].passageEnd=3.7;
  p.stems[0].passageReduction=100;
  p.el('stemClipStart').value='1';p.el('stemClipEnd').value='3';
  p.el('stemBuild').fire('click');await flush();
  assert.match(p.el('stemStatus').textContent,/does not overlap the selected preview/);
  assert.equal(p.el('stemExport').disabled,false,'off-preview edit is allowed with a warning');
  p.stems[0].passageStart=5;
  p.stems[0].passageEnd=6;
  p.el('stemBuild').fire('click');await flush();
  assert.match(p.el('stemStatus').textContent,/beyond the source duration/);
  p.stems[0].passageStart=1.5;
  p.stems[0].passageEnd=7;
  p.el('stemBuild').fire('click');await flush();
  assert.match(p.el('stemStatus').textContent,/extends beyond the available source/);
  p.stems[0].passageStart=NaN;
  p.el('stemBuild').fire('click');await flush();
  assert.match(p.el('stemStatus').textContent,/passage values must be finite/);
  assert.equal(p.el('stemExport').disabled,true);
  p.stems[0].passageStart=1.5;
  p.stems[0].passageEnd=2.5;
  p.el('stemClipEnd').value='1.000001';
  p.el('stemBuild').fire('click');await flush();
  assert.match(p.el('stemStatus').textContent,/shorter than one audio sample/);
  assert.equal(p.el('stemExport').disabled,true,'zero-frame range cannot export');
  p.ui.close();

  // Native full-source MP3 decoding must never run, even when a browser
  // advertises decodeAudioData. A finite excerpt needs bounded WebCodecs.
  const mp3=fakeStem('MP3 fallback blocked',.25);
  mp3.wav=null;mp3.mp3=mp3.entry;mp3.format='MP3';
  for (const options of [{mp3NoFullCopy:true},{oversizedMp3:true}]) {
    const blocked=harness([mp3],options);
    await blocked.ui.open({name:'No fallback.zip',size:1234});
    blocked.el('stemClipStart').value='0.25';
    blocked.el('stemClipEnd').value='0.5';
    blocked.el('stemBuild').fire('click');await flush();
    assert.match(blocked.el('stemStatus').textContent,/supported WebCodecs|fallback decode is disabled/);
    assert.equal(blocked.audios.length,0,'native fallback must not publish preview');
    assert.equal(blocked.el('stemExport').disabled,true,'native fallback must not enable export');
    blocked.ui.close();
  }
  // With a bounded WebCodecs excerpt, a single-format MP3 preview remains
  // available without invoking the unsafe full-source browser decoder.
  const supported=harness([mp3],{webCodecs:true,oversizedMp3:true});
  await supported.ui.open({name:'Bounded MP3.zip',size:1234});
  supported.el('stemClipStart').value='0.25';
  supported.el('stemClipEnd').value='0.5';
  supported.el('stemBuild').fire('click');await flush();
  assert.equal(supported.audios.length,1,'bounded single-format MP3 preview remains supported');
  assert.equal(supported.el('stemExport').disabled,false);
  supported.ui.close();

  // Cancellation must also settle a pending ZIP extraction await. The
  // browser/archive may finish the original operation later; stale data must
  // not overwrite the new preview or prevent a fresh build.
  const slow=harness([fakeStem('Slow archive',.2)],{holdFirstExtract:true});
  await slow.ui.open({name:'Held archive.zip',size:1234});
  slow.el('stemBuild').fire('click');await flush();
  assert.equal(slow.audios.length,0,'first extraction has not completed');
  slow.el('stemStop').fire('click');await flush();
  assert.equal(slow.heldExtractionAborted(),true,'cancel signals underlying ZIP extraction');
  assert.equal(slow.el('stemBuild').disabled,false,'cancel releases controls during extraction');
  slow.el('stemBuild').fire('click');await flush();
  assert.equal(slow.audios.length,1,'new build succeeds without waiting for old extraction');
  slow.releaseHeldExtract();await flush();
  assert.equal(slow.audios.length,1,'late extraction cannot publish another preview');
  assert(Math.abs(slow.audios[0].getChannelData(0)[2]-.2)<1e-6,
    'fresh mix retains correct audio after stale extraction resolves');
  slow.ui.close();

  // Cancellation while a worker is pending must terminate the old job and
  // permit a clean rebuild. Its late messages must never publish stale audio.
  const k=harness([fakeStem('Slow',.2)],{holdStemWorker:true});
  await k.ui.open({name:'Slow Stem.zip',size:1234});
  k.stems[0].clean=true;
  k.el('stemBuild').fire('click');await flush();
  const pending=k.workers.find(w=>w.url==='stem-audio-worker.js');
  assert(pending && !pending.terminated,'test processing worker remains pending');
  assert.equal(k.el('stemStop').disabled,false,'cancel is available while processing');
  k.el('stemStop').fire('click');await flush();
  assert.equal(pending.terminated,true,'cancellation terminates the active worker');
  assert.equal(k.el('stemBuild').disabled,false,'cancellation resets the workspace');
  k.stems[0].clean=false;
  k.el('stemBuild').fire('click');await flush();
  assert.equal(k.audios.length,1,'fresh unprocessed mix builds after cancelling worker');
  pending.onmessage({data:{type:'done',channels:[samples(.9,48000,1),samples(.9,48000,1)]}});
  await flush();
  assert.equal(k.audios.length,1,'late result of terminated worker cannot create preview');
  assert(Math.abs(k.audios.at(-1).getChannelData(0)[2]-.2)<1e-6,
    'late result cannot replace fresh audio');
  k.ui.close();

  // MP3 export has no pending Promise, but cancelling a held encoder must
  // likewise ignore a synthetic late result and never trigger a download.
  const q=harness([fakeStem('Export',.2)],{holdMp3Export:true});
  await q.ui.open({name:'Export.zip',size:1234});
  q.el('stemBuild').fire('click');await flush();
  q.el('stemBits').value='mp3-320';
  q.el('stemExport').fire('click');await flush();
  const encoder=q.workers.find(w=>w.url==='export-worker.js');
  assert(encoder && !encoder.terminated);
  q.el('stemStop').fire('click');await flush();
  assert(encoder.terminated,'cancelled encoder is terminated');
  encoder.onmessage({data:{type:'done',bytes:Uint8Array.of(4,5),peak:.2}});
  await flush();
  assert.equal(q.downloaded.length,0,'stale cancelled MP3 job must not download');
  q.ui.close();

  // Short 100%-mute windows must reach full attenuation at their midpoint.
  // A 20 ms fixed fade on both sides would never reach zero for these.
  for(const milliseconds of [10,20,40]) {
    const w=harness([fakeStem('Short window',.2,48000,1)]);
    await w.ui.open({name:'Short window.zip',size:2000});
    const start=.2, end=start+milliseconds/1000;
    w.stems[0].passageStart=start;
    w.stems[0].passageEnd=end;
    w.stems[0].passageReduction=100;
    w.el('stemBuild').fire('click');await flush();
    assert.equal(w.el('stemExport').disabled,false,'short mute build must succeed');
    const samples=w.audios.at(-1).getChannelData(0),
      from=Math.round(start*48000),to=Math.round(end*48000),middle=(from+to)/2;
    assert(Math.abs(samples[from]-.2)<1e-6,'start boundary continuous '+milliseconds);
    assert(Math.abs(samples[to]-.2)<1e-6,'end boundary continuous '+milliseconds);
    assert(Math.abs(samples[middle])<1e-6,'full mute at midpoint '+milliseconds);
    assert(Math.abs(samples[from-1]-.2)<1e-6,'before start unchanged '+milliseconds);
    assert(Math.abs(samples[to+1]-.2)<1e-6,'after end unchanged '+milliseconds);
    assert(samples[from+1]<.2 && samples[from+1]>=0,'fade starts smoothly '+milliseconds);
    w.ui.close();
  }

  // A one-frame 100% mute has no interior sample on which a continuous
  // fade can reach full depth. Reject it instead of silently doing nothing.
  // Two frames are the minimum permitted interval under the existing policy.
  for (const frames of [1,2]) {
    const w=harness([fakeStem('Frame policy',.2,48000,1)]);
    await w.ui.open({name:'Frame policy.zip',size:2000});
    const from=9600;
    w.stems[0].passageStart=from/48000;
    w.stems[0].passageEnd=(from+frames)/48000;
    w.stems[0].passageReduction=100;
    w.el('stemBuild').fire('click');await flush();
    if(frames===1) {
      assert.match(w.el('stemStatus').textContent,/at least two audio sample frames/);
      assert.equal(w.el('stemExport').disabled,true,'one-frame attenuation cannot export');
      assert.equal(w.audios.length,0,'one-frame attenuation cannot publish preview');
    } else {
      assert.equal(w.el('stemExport').disabled,false,'two-frame attenuation is permitted');
      const audio=w.audios.at(-1).getChannelData(0);
      assert(Math.abs(audio[from]-.2)<1e-6,'two-frame start boundary unchanged');
      assert(Math.abs(audio[from+1])<1e-6,'two-frame center reaches full mute');
      assert(Math.abs(audio[from+2]-.2)<1e-6,'two-frame end boundary unchanged');
    }
    w.ui.close();
  }

  // Any decoded frame discrepancy requires explicit opt-in, even below 25 ms.
  // Rejection must not publish a preview or enable export.
  for (const missingFrames of [1,480]) {
    const first=fakeStem('Aligned',.2,48000,1);
    const shorter=fakeStem('Shorter',.3,48000,(48000-missingFrames)/48000);
    const w=harness([first,shorter]);
    await w.ui.open({name:'Frame mismatch.zip',size:2000});
    w.el('stemBuild').fire('click');await flush();
    assert.match(w.el('stemStatus').textContent,/Stem lengths differ|mismatch checkbox/i,
      'unchecked '+missingFrames+'-frame discrepancy must be rejected');
    assert.equal(w.el('stemExport').disabled,true,'mismatch cannot export without consent');
    assert.equal(w.audios.length,0,'mismatch cannot publish preview without consent');
    w.el('stemAllowMismatch').checked=true;
    w.el('stemBuild').fire('click');await flush();
    assert.equal(w.el('stemExport').disabled,false,'explicit consent allows start-aligned padding');
    const preview=w.audios.at(-1).getChannelData(0);
    assert.equal(preview.length,48000,'the reference sets the preview duration');
    assert(Math.abs(preview[0]-.5)<1e-6,'consent must preserve first-frame alignment');
    assert(Math.abs(preview[47999-missingFrames]-.5)<1e-6,
      'the shorter stem contributes through its last frame');
    assert(Math.abs(preview[48000-missingFrames]-.2)<1e-6,
      'shorter stem must be zero padded at end, not time shifted');
    w.ui.close();
  }

  // A different WAV sample rate is rejected before silent resampling.
  const j=harness([fakeStem('First',.2,48000,1),fakeStem('Other',.3,44100,1)]);
  await j.ui.open({name:'Mismatch.zip',size:2000});
  j.el('stemBuild').fire('click');await flush();
  assert.match(j.el('stemStatus').textContent,/Source sample rates differ|uses 44100 Hz/i);
  assert.equal(j.el('stemExport').disabled,true);
  j.el('stemAllowMismatch').checked=true;
  j.el('stemBuild').fire('click');await flush();
  assert.equal(j.el('stemExport').disabled,false,'explicit opt-in allows rate conversion');
  j.ui.close();
  assert.equal(j.el('stemWorkspace').hidden,true,'workspace can be closed');

  console.log('Stem UI integration passed: local archive open, lazy decode, per-stem mix/mute/solo/gain, polish worker, WAV/MP3 exports, explicit mismatch handling, close.');
})().catch(e=>{console.error(e);process.exitCode=1;});
