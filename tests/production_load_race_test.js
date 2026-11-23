/* Production v4 regression: slow file reads and obsolete cleaning callbacks.
 * Run: node tests/production_load_race_test.js
 */
'use strict';
const assert = require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const Ed=require('../edit.js');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const script=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
const noop=()=>{};
function deferred() {let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function riff(marker) {const a=new Uint8Array(32);a.set([82,73,70,70],0);a[4]=marker;return a.buffer;}
async function flush(){await new Promise(r=>setImmediate(r));await new Promise(r=>setImmediate(r));}
function harness(){
 const workers=[],wavWrites=[],nodes=new Map(),radios={},stem={opens:[],closes:0};
 const canvas={
   setTransform:noop,clearRect:noop,fillRect:noop,beginPath:noop,moveTo:noop,lineTo:noop,
   quadraticCurveTo:noop,closePath:noop,arc:noop,fill:noop,stroke:noop,
   fillText:noop,drawImage:noop,putImageData:noop,createLinearGradient:()=>({addColorStop:noop})
 };
 function classes(){return {add:noop,remove:noop,toggle:noop,contains:()=>false};}
 class E {
   constructor(id){this.id=id;this.value='0';this.min='0';this.max='100';this.hidden=false;
     this.disabled=false;this.checked=false;this.textContent='';this.innerHTML='';this.className='';
     this.listeners={};this.style={setProperty:noop};this.classList=classes();
     this.width=640;this.height=160;this.clientWidth=640;this.scrollLeft=0;this.scrollWidth=640;
     this.parentNode={querySelector:()=>new E('output')};
   }
   addEventListener(name,fn){(this.listeners[name] ||= []).push(fn);}
   fire(name,other){for(const f of this.listeners[name]||[])f.call(this,Object.assign({target:this,preventDefault:noop},other||{}));}
   setAttribute(name,val){this[name]=val;}
   getBoundingClientRect(){return {left:0,top:0,width:640,height:160,right:640,bottom:160};}
   getContext(){return canvas;}
   closest(){return {classList:classes()};}
   append(){} appendChild(){} remove(){} contains(){return false;}
   click(){this.fire('click');} setPointerCapture(){}
 }
 for(const id of ids)nodes.set(id,new E(id));
 const el=id=>{assert(nodes.has(id),'missing html element '+id);return nodes.get(id);};
 const modes=['original','clean','polish','removed'];
 const tiles={};
 for(const name of modes){radios[name]=new E('radio-'+name);radios[name].value=name;
   tiles[name]={className:'tile tile-'+name,innerHTML:''};}
 const document={
   body:{classList:classes(),appendChild:noop},getElementById:el,
   querySelectorAll:sel=>sel==='input[name="mode"]'?modes.map(m=>radios[m]):[],
   querySelector:sel=>{let m=sel.match(/^input\[name="mode"\]\[value="([^"]+)"\]$/);
     if(m)return radios[m[1]];m=sel.match(/^\.track\[data-mode="([^"]+)"\] \.tile$/);
     return m?tiles[m[1]]:null;},
   createElement:tag=>new E(tag),addEventListener:noop
 };
 class AB {
   constructor(x){this.length=x.length;this.numberOfChannels=x.numberOfChannels;this.sampleRate=x.sampleRate;
     this.duration=this.length/this.sampleRate;this.data=Array.from({length:this.numberOfChannels},
       ()=>new Float32Array(this.length));}
   copyToChannel(a,c){this.data[c].set(a);}
   getChannelData(c){return this.data[c];}
 }
 class AC {
   constructor(){this.state='running';this.currentTime=0;this.destination={};}
   createBuffer(c,n,r){return new AB({length:n,numberOfChannels:c,sampleRate:r});}
   createGain(){return {gain:{value:1,setTargetAtTime:noop,setValueCurveAtTime:noop},connect:noop,disconnect:noop};}
   createBufferSource(){return {connect:noop,start:noop,stop:noop};}
   resume(){}
 }
 class Worker {
   constructor(url){this.url=url;this.messages=[];this.terminated=false;workers.push(this);}
   postMessage(m){this.messages.push(m);}
   emit(data){this.onmessage?.({data});}
   terminate(){this.terminated=true;}
 }
 const Wav={
   decodeWav(ab){const marker=new Uint8Array(ab)[4];const samples=Float32Array.from({length:48000},()=>marker/100);
     return {channels:[samples,samples.slice()],sampleRate:48000,bits:16,float:false};},
   encodeWav(channels){wavWrites.push(channels.map(x=>x[0]));return new Uint8Array([82,73,70,70]).buffer;}
 };
 const Engine={VERSION:'1',DEFAULTS:{
   denoise:true,denoiseStrength:1,maxAttenDb:7,quietPct:12,bassHz:350,
   shimmer:.6,shimmerMaxDb:6,shimmerFromHz:4000}};
 // index.html loads Sound Polish and loudness before app.js; so does this page.
 const window={ShimmerEngine:Engine,ShimmerEdit:Ed,WavCodec:Wav,AudioContext:AC,
   SunoPolish:require('../polish.js'),SunoLoudness:require('../loudness.js'),
   SunoStemUI:{open(f){stem.opens.push(f.name);},close(){stem.closes++;}},
   addEventListener:noop,devicePixelRatio:1};
 const context={window,document,Worker,AudioBuffer:AB,Float32Array,Uint8Array,
   Uint8ClampedArray,ArrayBuffer,Blob,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:noop},
   console,setTimeout:noop,clearTimeout:noop,requestAnimationFrame:noop};
 el('bits').value='24';el('loaded').hidden=true;el('transport').hidden=true;
 vm.runInNewContext(script,context,{filename:'production/app.js',timeout:5000});
 const last=url=>workers.filter(w=>w.url===url).at(-1);
 function finishClean(w){
   const job=w||last('worker.js'),input=job.messages.at(-1).channels;
   job.emit({type:'done',clean:input.map(x=>x.slice()),
     removed:input.map(x=>new Float32Array(x.length)),report:{text:'test'}});
 }
 return {el,workers,wavWrites,last,finishClean,stem};
}
(async()=>{
 const h=harness();
 const a=deferred();
 h.el('file').files=[{name:'Source-A.wav',arrayBuffer:()=>a.promise}];h.el('file').fire('change');
 h.el('file').files=[{name:'Source-B.wav',arrayBuffer:async()=>riff(70)}];h.el('file').fire('change');
 await flush();
 const b=h.last('worker.js');assert(b,'new track must start cleaning');
 assert(Math.abs(b.messages.at(-1).channels[0][0]-.7)<1e-6,'B worker must get B samples');
 const before=h.workers.length;
 a.resolve(riff(10));await flush();
 assert.equal(h.workers.length,before,'late A read must not start worker');
 assert.equal(b.terminated,false,'late A callback must not terminate B');
 h.finishClean(b);
 h.el('dlClean').fire('click');
 assert(Math.abs(h.wavWrites.at(-1)[0]-.7)<1e-6,'export B samples must match B title');
 const pending=deferred();
 h.el('file').files=[{name:'Source-C.wav',arrayBuffer:()=>pending.promise}];
 h.el('file').fire('change');
 b.emit({type:'error',message:'Old failure'});
 b.emit({type:'progress',fraction:1,stage:'Old worker progress'});
 b.emit({type:'done',clean:[Float32Array.of(.1),Float32Array.of(.1)],
   removed:[Float32Array.of(0),Float32Array.of(0)],report:{text:'stale'}});
 assert.equal(h.el('songTitle').textContent,'Source-C','title belongs to C');
 assert.equal(h.el('busyText').textContent,'Opening Source-C.wav','old progress must not overwrite C status');
 assert.equal(h.el('error').hidden,true,'old worker errors must not appear');
 pending.resolve(riff(10));await flush();
 const c=h.last('worker.js');assert.notEqual(c,b);
 h.finishClean(c);h.el('dlClean').fire('click');
 assert(Math.abs(h.wavWrites.at(-1)[0]-.1)<1e-6,'C export must use C samples');

 const fail=deferred();
 h.el('file').files=[{name:'Source-D.wav',arrayBuffer:()=>fail.promise}];h.el('file').fire('change');
 h.el('file').files=[{name:'Source-E.wav',arrayBuffer:async()=>riff(70)}];h.el('file').fire('change');
 await flush();fail.reject(Error('Old read failed'));await flush();
 assert.equal(h.el('songTitle').textContent,'Source-E');
 assert.equal(h.el('error').hidden,true,'old read failure must not affect new track');
 assert.equal(h.el('busy').hidden,false,'old read error must not hide current progress');
 // Source switch to a stem ZIP (ChatGPT-2 HIGH, 23 Nov): a pending single
 // track read, its decode and an active cleaning worker are invalidated
 // before the ZIP workspace opens; late results never install audio.
 {
   const z=harness();
   const slow=deferred();
   z.el('file').files=[{name:'Song-A.wav',arrayBuffer:()=>slow.promise}];z.el('file').fire('change');
   z.el('file').files=[{name:'Stems-B.zip',arrayBuffer:()=>{throw Error('ZIP must not be read by app.js');}}];
   z.el('file').fire('change');
   assert.deepEqual(z.stem.opens,['Stems-B.zip'],'ZIP routed to the stem workspace');
   slow.resolve(riff(10));await flush();
   assert.equal(z.workers.filter(w=>w.url==='worker.js').length,0,'late A read after ZIP must not start cleaning');
   assert.equal(z.el('busy').hidden,true,'no stale single-track progress over the workspace');
   // Active cleaning worker, then ZIP: worker terminated, stale done ignored.
   z.el('file').files=[{name:'Song-C.wav',arrayBuffer:async()=>riff(30)}];z.el('file').fire('change');
   await flush();
   const c=z.last('worker.js');assert(c&&!c.terminated,'C is cleaning');
   const closesBefore=z.stem.closes;
   assert(closesBefore>=1,'a single-track selection closes any pending stem workspace open');
   z.el('file').files=[{name:'Stems-D.zip'}];z.el('file').fire('change');
   assert(c.terminated,'ZIP selection terminates the running cleaning worker');
   finishSilently(c);
   assert.equal(z.el('dlClean').hidden===false && z.wavWrites.length>0,false,'stale C result must not become exportable');
   // ZIP then single track: the workspace is closed so a pending archive
   // open cannot reappear over the new track.
   const closes=z.stem.closes;
   z.el('file').files=[{name:'Song-E.wav',arrayBuffer:async()=>riff(50)}];z.el('file').fire('change');
   assert.equal(z.stem.closes,closes+1,'single-track selection closes the stem workspace');
   await flush();
   const e=z.last('worker.js');assert(e&&e!==c&&!e.terminated,'E cleans normally after ZIP');
   assert(Math.abs(e.messages.at(-1).channels[0][0]-.5)<1e-6,'E worker gets E samples');
   console.log('PASS source switch between single track and stem ZIP invalidates pending work both ways.');
 }
 function finishSilently(w){try{w.emit({type:'done',clean:[Float32Array.of(.9),Float32Array.of(.9)],
   removed:[Float32Array.of(0),Float32Array.of(0)],report:{text:'stale'}});}catch(_){}}
 console.log('PASS production import generation regression: overlapping reads, stale worker, stale failures and WAV exports.');
})().catch(e=>{console.error(e);process.exitCode=1;});
