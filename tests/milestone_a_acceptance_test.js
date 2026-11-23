// Milestone A executable acceptance test: real eight-minute, ten-stem Viking
// ZIP through the REAL workspace code (stem-zip.js, stem-mp3.js, wav.js,
// stem-ui.js), with only the browser shell simulated.
//
// The MP3 decoder is FFmpeg's mpegaudio decoder behind a WebCodecs-shaped
// AudioDecoder; Chrome's WebCodecs MP3 decoder is the same FFmpeg decoder.
// Each preview is compared with an INDEPENDENT reference: FFmpeg decodes of
// every complete stem, mixed here from the documented rules (dB gain, 20 ms
// linear fades anchored on the source timeline). Exports are decoded back
// and compared with the preview.
//
// Covers: ZIP import of ten MP3 stems, late 462-474 s passage, alignment of
// all stems, gain/mute/solo/time-local attenuation, preview vs 32-bit float
// WAV export, cancellation and clean rebuild, full-length MP3 refusal,
// out-of-range passage message, and measured Node memory.
// Does NOT cover: real browser rendering, native browser memory, other
// browsers' decoders, playback, or listening. Those stay manual gates.
//
// Needs ffmpeg and the public Viking fixtures (example-files/viking-shimmer
// or SSF_VIKING_DIR). Skips otherwise, unless SSF_REQUIRE_FIXTURES=1.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const repo=path.join(__dirname,'..');
const dir=process.env.SSF_VIKING_DIR||path.join(repo,'example-files/viking-shimmer');
function skip(why){
  if (process.env.SSF_REQUIRE_FIXTURES==='1'){console.error('FAIL: '+why);process.exit(1);}
  console.log('SKIP: '+why);process.exit(0);
}
if (cp.spawnSync('ffmpeg',['-version']).status!==0) skip('ffmpeg not available.');
const names=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>/\.mp3$/i.test(f)).sort():[];
if (names.length!==10) skip('ten Viking MP3 fixtures not present ('+names.length+' found).');

function ffmpegDecode(buf){
  const r=cp.spawnSync('ffmpeg',['-v','error','-f','mp3','-i','pipe:0','-f','f32le','-acodec','pcm_f32le','pipe:1'],
    {input:buf,maxBuffer:1<<30});
  if (r.status!==0) throw new Error('ffmpeg: '+r.stderr);
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset,r.stdout.byteOffset+r.stdout.length));
}
class FfmpegAudioDecoder {
  static async isConfigSupported(c){return {supported:c.codec==='mp3',config:c};}
  constructor(cb){this.cb=cb;this.chunks=[];this.decodeQueueSize=0;this.closed=false;}
  configure(c){this.config=c;}
  decode(chunk){if(this.closed)throw new Error('closed');this.chunks.push(chunk);}
  async flush(){
    const ch=this.config.numberOfChannels,joined=Buffer.concat(this.chunks.map(c=>Buffer.from(c.data)));
    const pcm=ffmpegDecode(joined);
    assert.equal(pcm.length,this.chunks.length*1152*ch);
    this.chunks.forEach((c,i)=>this.cb.output({sampleRate:this.config.sampleRate,numberOfChannels:ch,
      numberOfFrames:1152,timestamp:c.timestamp,close(){},
      copyTo(out,{planeIndex}){for(let j=0;j<1152;j++)out[j]=pcm[(i*1152+j)*ch+planeIndex];}}));
    this.chunks=[];
  }
  close(){this.closed=true;}
}
class Chunk{constructor(o){Object.assign(this,o);}}

// Minimal stored (method 0) ZIP writer, so the real ZIP reader is exercised.
const CRC=new Uint32Array(256).map((_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(b){let c=~0;for(let i=0;i<b.length;i++)c=CRC[(c^b[i])&255]^(c>>>8);return (~c)>>>0;}
function storedZip(files){
  const parts=[],central=[];let offset=0;
  for (const [name,data] of files){
    const n=Buffer.from(name),crc=crc32(data),h=Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt32LE(crc,14);
    h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(n.length,26);
    parts.push(h,n,data);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50,0);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);
    c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);
    c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);central.push(c,n);
    offset+=30+n.length+data.length;
  }
  const cd=Buffer.concat(central),e=Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50,0);e.writeUInt16LE(files.length,8);e.writeUInt16LE(files.length,10);
  e.writeUInt32LE(cd.length,12);e.writeUInt32LE(offset,16);
  return Buffer.concat([...parts,cd,e]);
}

// Browser shell: DOM ids, AudioContext buffers, workers, downloads.
function shell(){
  const nodes=new Map(),buffers=[],downloads=[];
  class E{
    constructor(tag='div'){Object.assign(this,{tag,id:'',hidden:false,disabled:false,checked:false,
      textContent:'',value:'',children:[],style:{},listeners:{},classList:{toggle(){},add(){},remove(){}}});}
    set innerHTML(h){this._h=h;for(const m of h.matchAll(/\bid="([^"]+)"/g)){const e=new E();e.id=m[1];nodes.set(e.id,e);}}
    get innerHTML(){return this._h||'';}
    setAttribute(k,v){this[k]=v;} addEventListener(t,f){(this.listeners[t]||=[]).push(f);}
    fire(t){for(const f of this.listeners[t]||[])f.call(this,{target:this,preventDefault(){}});}
    append(...x){this.children.push(...x);} appendChild(x){this.children.push(x);return x;}
    replaceChildren(...x){this.children=x;} remove(){} focus(){}
    click(){if(this.tag==='a')downloads.push({name:this.download,blob:blobs.get(this.href)});else this.fire('click');}
  }
  const blobs=new Map();let blobId=0;
  const URLs={createObjectURL(b){const u='blob:acceptance/'+(++blobId);blobs.set(u,b);return u;},revokeObjectURL(){}};
  const document={body:new E('body'),createElement:t=>new E(t),
    createTextNode(s){const e=new E('text');e.textContent=s;return e;},getElementById:id=>nodes.get(id)||null};
  class AB{constructor(ch,n,sr){Object.assign(this,{numberOfChannels:ch,length:n,sampleRate:sr,duration:n/sr});
    this.d=Array.from({length:ch},()=>new Float32Array(n));}
    copyToChannel(c,i){this.d[i].set(c);} getChannelData(i){return this.d[i];}}
  class AC{constructor(o){this.sampleRate=(o&&o.sampleRate)||48000;this.currentTime=0;this.destination={};}
    createBuffer(ch,n,sr){const b=new AB(ch,n,sr);buffers.push(b);return b;}
    createBufferSource(){return {connect(){},disconnect(){},start(){},stop(){}};}
    resume(){return Promise.resolve();} close(){return Promise.resolve();}
    decodeAudioData(){throw new Error('Native full-source MP3 decode must not be used in milestone A.');}}
  class Worker{constructor(u){this.u=u;}postMessage(){throw new Error('No worker expected without clean/polish: '+this.u);}terminate(){}}
  const root={AudioContext:AC,AudioDecoder:FfmpegAudioDecoder,EncodedAudioChunk:Chunk,confirm:()=>true,
    performance:{now:()=>performance.now()}};
  root.self=root;
  const ctx={window:root,self:root,document,Worker,Blob,URL:URLs,console,Float32Array,Uint8Array,Uint32Array,
    Int16Array,Int32Array,Float64Array,DataView,ArrayBuffer,TextDecoder,TextEncoder,AbortController,
    DecompressionStream,Response,setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout,queueMicrotask,
    Promise,Math,Number,Array,Map,Set,String,Error,Object,JSON,Symbol};
  vm.createContext(ctx);
  for (const f of ['wav.js','engine.js','loudness.js','polish.js','stem-zip.js','stem-mp3.js','stem-resample.js','stem-ui.js'])
    vm.runInContext(fs.readFileSync(path.join(repo,f),'utf8'),ctx,{filename:f});
  // Keep a handle on the archive the real ZIP reader returns, so the test
  // edits the same stem objects the workspace renders controls for.
  const realOpen=root.SunoStemZip.open;let archive=null;
  root.SunoStemZip.open=async f=>(archive=await realOpen(f));
  const W=root.WavCodec;
  const el=id=>{const e=nodes.get(id);assert(e,'missing #'+id);return e;};
  return {root,ui:root.SunoStemUI,el,buffers,downloads,Wav:W,archive:()=>archive};
}
async function settle(h,ms=120000){
  const t=Date.now();
  while (Date.now()-t<ms){
    await new Promise(r=>setTimeout(r,20));
    if (h.el('stemBuild').disabled===false && !/Unpacking|Processing|Stem \d+ of/.test(h.el('stemStatus').textContent)) return;
  }
  throw new Error('build did not settle: '+h.el('stemStatus').textContent);
}

(async()=>{
  const t0=Date.now(), mem0=process.memoryUsage();
  let peak=0;const sample=setInterval(()=>{const m=process.memoryUsage();peak=Math.max(peak,m.rss);},25);sample.unref();
  const files=names.map(n=>[n,fs.readFileSync(path.join(dir,n))]);
  const zip=storedZip(files);
  // Independent reference: complete FFmpeg decode of each stem.
  const full=new Map(),rate=48000,S=462*rate,N=12*rate;
  for (const [n,b] of files){
    const pcm=ffmpegDecode(b);
    full.set(n.replace(/\.mp3$/i,''),[0,1].map(c=>Float32Array.from({length:N},(_,i)=>pcm[(S+i)*2+c])));
  }
  function reference(stems){
    const mix=[new Float32Array(N),new Float32Array(N)];
    const anySolo=stems.some(s=>s.solo&&s.enabled);
    for (const s of stems){
      if (!s.enabled||s.mute||(anySolo&&!s.solo)) continue;
      const src=full.get(s.key.split('/').pop()),gain=Math.pow(10,s.volume/20);
      const red=(s.passageReduction||0)/100;
      const from=Math.round((s.passageStart||0)*rate)-S,to=Math.round((s.passageEnd||0)*rate)-S;
      const fade=Math.max(1,Math.min(Math.round(0.020*rate),Math.floor((to-from)/2)));
      for (let j=0;j<N;j++){
        const depth=red&&j>from&&j<to?Math.min(1,(j-from)/fade,(to-j)/fade):0;
        const g=red?gain*(1-red*depth):gain;
        mix[0][j]+=src[0][j]*g;mix[1][j]+=src[1][j]*g;
      }
    }
    return mix;
  }
  function compare(buf,ref,label){
    assert(buf,label+': no preview buffer');
    assert.equal(buf.sampleRate,rate,label+': rate');assert.equal(buf.length,N,label+': length');
    let worst=0,energy=0;
    for (let c=0;c<2;c++){const a=buf.getChannelData(c);
      for (let i=0;i<N;i++){const d=Math.abs(a[i]-ref[c][i]);if(!(d<=worst))worst=d;energy+=ref[c][i]*ref[c][i];}}
    assert(energy>0,label+': reference is silent');
    assert(worst<=1e-6,label+': preview differs from independent reference by '+worst);
    return worst;
  }
  const results=[];
  const h=shell();
  const file=new File([zip],'Epic Viking Ambience.zip',{type:'application/zip'});
  await h.ui.open(file);
  assert.match(h.el('stemArchive').textContent,/10 distinct stems/,'ten stems recognised');

  // 1. Late passage, all stems, no edits.
  h.el('stemClipStart').value='462';h.el('stemClipEnd').value='474';
  h.el('stemBuild').fire('click');await settle(h);
  assert.match(h.el('stemStatus').textContent,/Ready to play\/export/,h.el('stemStatus').textContent);
  results.push(['late 462-474 s, 10 stems',compare(h.buffers.at(-1),reference(currentStems(h)),'all stems')]);

  // 2. Preview vs 32-bit float WAV export.
  h.el('stemBits').value='32';h.el('stemExport').fire('click');
  const dl=h.downloads.at(-1);assert(dl&&dl.name.endsWith('.wav'),'float WAV downloaded');
  const exported=h.Wav.decodeWav(await dl.blob.arrayBuffer());
  assert.equal(exported.sampleRate,rate);
  for (let c=0;c<2;c++) assert.deepEqual(exported.channels[c],h.buffers.at(-1).getChannelData(c),'export channel '+c+' bit-identical to preview');
  results.push(['32-bit float WAV export == preview','bit-identical']);

  // 3. Manual edits: gain, mute, time-local attenuation with fades, then solo.
  const st=currentStems(h);
  const by=k=>st.find(s=>s.key.split('/').pop()===k);
  by('1 Drums').volume=-6;
  by('8 Brass').mute=true;
  Object.assign(by('7 Other'),{passageStart:465,passageEnd:470,passageReduction:100});
  Object.assign(by('6 Synth'),{passageStart:461,passageEnd:463.5,passageReduction:50});
  h.el('stemBuild').fire('click');await settle(h);
  assert.match(h.el('stemStatus').textContent,/Ready/,h.el('stemStatus').textContent);
  results.push(['gain -6 dB, mute, 100% and 50% attenuation with fades',compare(h.buffers.at(-1),reference(st),'edits')]);
  by('0 Lead Vocals').solo=true;by('2 Bass').solo=true;
  h.el('stemBuild').fire('click');await settle(h);
  results.push(['solo two stems',compare(h.buffers.at(-1),reference(st),'solo')]);
  by('0 Lead Vocals').solo=false;by('2 Bass').solo=false;

  // 4. Cancellation mid-build, then a clean rebuild.
  const realDecode=h.root.SunoStemMp3.decodePassage;let calls=0,abortedSeen=false,release;
  h.root.SunoStemMp3.decodePassage=function(bytes,a,b,signal){
    if (++calls===4) return new Promise((resolve,reject)=>{
      release=()=>realDecode(bytes,a,b,signal).then(resolve,reject);
      signal&&signal.addEventListener('abort',()=>{abortedSeen=true;reject(new Error('MP3 decoding cancelled.'));});
    });
    return realDecode(bytes,a,b,signal);
  };
  const before=h.buffers.length;
  h.el('stemBuild').fire('click');
  for (let i=0;i<500&&calls<4;i++) await new Promise(r=>setTimeout(r,10));
  assert.equal(calls,4,'held on the fourth stem');
  h.el('stemStop').fire('click');
  await new Promise(r=>setTimeout(r,50));
  assert(abortedSeen,'cancel aborts the in-flight decoder signal');
  assert.equal(h.el('stemExport').disabled,true,'no export after cancel');
  assert.equal(h.buffers.length,before,'cancelled build publishes no preview');
  h.root.SunoStemMp3.decodePassage=realDecode;
  h.el('stemBuild').fire('click');await settle(h);
  results.push(['cancel on stem 4, then rebuild',compare(h.buffers.at(-1),reference(st),'rebuild after cancel')]);

  // 5. Fail-closed boundaries.
  h.el('stemClipStart').value='0';h.el('stemClipEnd').value='0';
  h.el('stemBuild').fire('click');await settle(h);
  assert.match(h.el('stemStatus').textContent,/finite selected passage/,'full-length MP3 refused');
  h.el('stemClipStart').value='479';h.el('stemClipEnd').value='481';
  h.el('stemBuild').fire('click');await settle(h);
  assert.match(h.el('stemStatus').textContent,/outside the first stem duration \(480\.00 seconds\)/,h.el('stemStatus').textContent);
  results.push(['full-length MP3 and out-of-range passage refused','clear messages']);

  clearInterval(sample);
  const mb=x=>(x/1048576).toFixed(0)+' MiB';
  console.log('Milestone A acceptance (FFmpeg-backed WebCodecs shell, real workspace code):');
  for (const [k,v] of results) console.log('  PASS  '+k+'  ['+(typeof v==='number'?'max abs diff '+v:v)+']');
  console.log('  Measured: '+((Date.now()-t0)/1000).toFixed(1)+' s; Node RSS start '+mb(mem0.rss)+', peak '+mb(peak)+
    ' (includes the 10 full reference decodes; not browser memory).');
})().then(()=>process.exit(0),e=>{console.error(e);process.exit(1);});

function currentStems(h){
  const s=h.archive()&&h.archive().stems;
  assert(Array.isArray(s)&&s.length===10,'ten stems from the real ZIP reader');
  return s;
}
