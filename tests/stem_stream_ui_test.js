/* Browser-UI state integration for the actual stem workspace, without external packages.
 * Uses synthetic WAV data and a simulated document/AudioContext/worker.
 * No private Suno material or browser behavior is asserted here.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const wav=require('../wav.js'),Polish=require('../polish.js'),Engine=require('../engine.js'),
  Resample=require('../stem-resample.js');
const stream=require('../stem-wav-stream.js');
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
  const root={SunoStemZip:{open:async()=>archive},WavCodec:wav,SunoStemWavStream:stream,
    showSaveFilePicker:options.picker || (async()=>options.fileHandle),ShimmerEngine:Engine,
    SunoStemResample:Resample,AudioContext:AC,
    confirm:()=>true};
  const URLs={createObjectURL:()=> 'blob:synthetic',revokeObjectURL(){}};
  const ctx={window:root,document,Worker,Blob,URL:URLs,console,Float32Array,Uint8Array,
    ArrayBuffer,TextDecoder,AbortController,setInterval:()=>1,clearInterval(){},setTimeout:()=>0};
  vm.runInNewContext(source,ctx,{timeout:5000,filename:'stem-ui.js'});
  const el=id=>{const e=nodes.get(id);assert(e,'Missing '+id);return e;};
  return {ui:root.SunoStemUI,el,nodes,stems,downloaded,audios,workers,
    releaseHeldExtract(){assert(releaseHeldExtract,'held extraction missing');releaseHeldExtract();},
    heldExtractionAborted(){return heldSignal && heldSignal.aborted;}};
}
async function flush(){
  for(let i=0;i<7;i++)await new Promise(resolve=>setImmediate(resolve));
}

async function until(fn) {
  for(let i=0;i<1200;i++) {
    if(fn())return;
    await new Promise(resolve=>setImmediate(resolve));
  }
  throw Error('Timed out waiting for stream export');
}
function fileSink() {
  const writes=[];const state={closed:false,aborted:false};
  const handle={async createWritable(){return {
    async write(data){writes.push(new Uint8Array(data));},
    async close(){state.closed=true;},
    async abort(){state.aborted=true;}
  };}};
  return {handle,writes,state};
}
function joined(writes) {
  const bytes=Buffer.concat(writes.map(x=>Buffer.from(x)));
  return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
}
(async()=>{
  // Long enough to cross two ten-second boundaries, with a changing waveform.
  for(const rate of [48000,44100]) {
    const length=rate*21, left=new Float32Array(length), right=new Float32Array(length);
    for(let i=0;i<length;i++) {
      left[i]=.17*Math.sin(i*.003)+.04*Math.cos(i*.017);
      right[i]=.13*Math.sin(i*.005)-.03*Math.cos(i*.013);
    }
    const stem=fakeStem('Boundary',.1,rate,21);
    stem._file=wav.encodeWav([left,right],rate,32);
    const file=fileSink(), h=harness([stem],{fileHandle:file.handle});
    await h.ui.open({name:'Boundary.zip',size:1234});
    h.el('stemBits').value='32';
    h.el('stemClipStart').value='0';
    h.el('stemClipEnd').value='21';
    h.el('stemBuild').fire('click');
    await until(()=>h.audios.length>0 && !h.el('stemBuild').disabled);
    const reference=h.audios.at(-1);
    h.el('stemStreamExport').fire('click');
    await until(()=>file.state.closed || file.state.aborted);
    assert(file.state.closed && !file.state.aborted,'stream must close cleanly');
    const decoded=wav.decodeWav(joined(file.writes));
    assert.equal(decoded.sampleRate,rate);
    assert.equal(decoded.channels[0].length,length);
    for(let c=0;c<2;c++) {
      const actual=decoded.channels[c], expected=reference.getChannelData(c);
      for(let i=0;i<length;i++) {
        if(Math.abs(actual[i]-expected[i])>1e-6)
          assert.fail('mix parity mismatch rate '+rate+' channel '+c+' frame '+i+
            ' actual '+actual[i]+' expected '+expected[i]);
      }
    }
    h.ui.close();
  }
  // A delayed picker must not permit two exports or commit changed settings.
  let acceptPicker;
  const picker=new Promise(resolve=>{acceptPicker=resolve;});
  const file=fileSink(), h=harness([fakeStem('Race',.2)],{picker:()=>picker});
  await h.ui.open({name:'Race.zip',size:1234});
  h.el('stemBits').value='32';
  h.el('stemClipStart').value='0';h.el('stemClipEnd').value='1';
  h.el('stemStreamExport').fire('click');
  assert(h.el('stemStreamExport').disabled,'export lock acquired before picker resolves');
  h.el('stemClipStart').value='.2';
  acceptPicker(file.handle);
  await until(()=>/project changed/.test(h.el('stemStatus').textContent));
  assert.equal(file.writes.length,0,'stale picker must not write');
  assert.equal(h.el('stemStreamExport').disabled,false,'picker cancellation releases lock');
  h.ui.close();
  console.log('Stem stream integration passed: full-reference sample parity across 10-second boundaries at 44.1/48 kHz and stale picker rejection.');
})().catch(e=>{console.error(e);process.exitCode=1;});
