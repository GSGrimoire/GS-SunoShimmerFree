/* Browser-UI state integration for the actual stem workspace, without external packages.
 * Uses synthetic WAV data and a simulated document/AudioContext/worker.
 * No private Suno material or browser behavior is asserted here.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const wav=require('../wav.js'),Polish=require('../polish.js'),Engine=require('../engine.js');
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
function harness(stems) {
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
    decodeAudioData(){throw Error('Unexpected MP3 decode in WAV-only test');}
  }
  class Worker {
    constructor(url){this.url=url;this.terminated=false;workers.push(this);}
    postMessage(m){
      if(this.url==='stem-audio-worker.js') {
        let channels=m.channels;
        if(m.clean)channels=Engine.process(channels,m.sampleRate,Engine.DEFAULTS).clean;
        if(m.polish)channels=Polish.process(channels,m.sampleRate,m.polishParams).channels;
        queueMicrotask(()=>this.onmessage&&this.onmessage({data:{type:'done',channels}}));
      } else if(this.url==='export-worker.js')
        queueMicrotask(()=>this.onmessage&&this.onmessage({data:{type:'done',bytes:Uint8Array.of(1,2),peak:.3}}));
      else throw Error('Unknown worker '+this.url);
    }
    terminate(){this.terminated=true;}
  }
  const archive={stems,file:{name:'Synthetic Stems.zip'},compressedBytes:2000,totalBytes:stems.reduce((sum,x)=>sum+x._file.byteLength,0),
    async extract(entry){const s=stems.find(x=>x.entry===entry);if(!s)throw Error('Missing synthetic entry');return s._file;}};
  const root={SunoStemZip:{open:async()=>archive},WavCodec:wav,ShimmerEngine:Engine,AudioContext:AC,
    confirm:()=>true};
  const URLs={createObjectURL:()=> 'blob:synthetic',revokeObjectURL(){}};
  const ctx={window:root,document,Worker,Blob,URL:URLs,console,Float32Array,Uint8Array,
    ArrayBuffer,TextDecoder,setInterval:()=>1,clearInterval(){},setTimeout:()=>0};
  vm.runInNewContext(source,ctx,{timeout:5000,filename:'stem-ui.js'});
  const el=id=>{const e=nodes.get(id);assert(e,'Missing '+id);return e;};
  return {ui:root.SunoStemUI,el,nodes,stems,downloaded,audios,workers};
}
async function flush(){
  for(let i=0;i<7;i++)await new Promise(resolve=>setImmediate(resolve));
}
(async()=>{
  const h=harness([fakeStem('Lead Vocals',.2),fakeStem('Drums',.3)]);
  await h.ui.open({name:'Synthetic Stems.zip',size:1234});
  assert.equal(h.el('stemList').children.length,2,'two stem cards');
  assert.match(h.el('stemArchive').textContent,/2 distinct stems/);
  assert.match(h.el('stemStatus').textContent,/Archive inspected/);
  assert.equal(h.audios.length,0,'no audio decoded or compiled merely by opening a ZIP');

  h.el('stemBuild').fire('click');await flush();
  assert.equal(h.audios.length,1,'mixed audio compiled');
  assert(Math.abs(h.audios[0].getChannelData(0)[2]-.5)<1e-6,'mix sums two enabled stems without normalizing');
  assert.equal(h.el('stemExport').disabled,false);
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
