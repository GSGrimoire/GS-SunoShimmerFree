// Offline seek-parity evidence for stem-mp3.js indexed late seeking.
//
// Chrome's WebCodecs AudioDecoder decodes MP3 with FFmpeg's mpegaudio
// decoder. This test drives the real decodePassage() through an
// AudioDecoder adapter backed by the local FFmpeg CLI, then compares every
// passage sample with an FFmpeg decode of the complete source from frame 0.
// Bit-identical output proves that the pre-roll planner feeds enough frames
// for that decoder. It does NOT prove behaviour of other browsers' decoders,
// native memory or listening quality; those remain browser-operator gates.
//
// Skips (exit 0) when ffmpeg or the public Viking fixtures are unavailable.
// Fixtures are read locally only; nothing is uploaded.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const vm=require('node:vm');

// SSF_VIKING_DIR may point at the fixtures copied from main when this
// branch's ancestry predates them.
const dir=process.env.SSF_VIKING_DIR||path.join(__dirname,'../example-files/viking-shimmer');
const probe=cp.spawnSync('ffmpeg',['-version']);
if (probe.error || probe.status!==0) { console.log('SKIP: ffmpeg not available.'); process.exit(0); }
const files=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>f.endsWith('.mp3')).sort():[];
if (!files.length) { console.log('SKIP: Viking MP3 fixtures not present.'); process.exit(0); }

function ffmpegDecode(buf) {
  const r=cp.spawnSync('ffmpeg',['-v','error','-f','mp3','-i','pipe:0',
    '-f','f32le','-acodec','pcm_f32le','pipe:1'],{input:buf,maxBuffer:1<<30});
  if (r.status!==0) throw new Error('ffmpeg failed: '+r.stderr);
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset,r.stdout.byteOffset+r.stdout.length));
}

// Minimal WebCodecs AudioDecoder: one 1152-frame output per input chunk,
// timestamp copied from the chunk, f32-planar copyTo, as Chrome emits.
class FfmpegAudioDecoder {
  static fed=[];
  static async isConfigSupported(config){return {supported:config.codec==='mp3',config};}
  constructor(cb){this.cb=cb;this.chunks=[];this.decodeQueueSize=0;}
  configure(c){this.config=c;}
  decode(chunk){this.chunks.push(chunk);}
  async flush(){
    const ch=this.config.numberOfChannels,total=this.chunks.reduce((n,c)=>n+c.data.length,0);
    const joined=new Uint8Array(total);let o=0;
    for (const c of this.chunks){joined.set(c.data,o);o+=c.data.length;}
    const pcm=ffmpegDecode(joined);
    assert.equal(pcm.length,this.chunks.length*1152*ch,'one 1152-frame output per fed MP3 frame');
    FfmpegAudioDecoder.fed.push(this.chunks.length);
    this.chunks.forEach((c,i)=>{
      this.cb.output({sampleRate:this.config.sampleRate,numberOfChannels:ch,numberOfFrames:1152,
        timestamp:c.timestamp,
        copyTo(out,{planeIndex}){for(let j=0;j<1152;j++) out[j]=pcm[(i*1152+j)*ch+planeIndex];},
        close(){}});
    });
    this.chunks=[];
  }
  close(){}
}
class Chunk{constructor(o){Object.assign(this,o);}}
const root={AudioDecoder:FfmpegAudioDecoder,EncodedAudioChunk:Chunk};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../stem-mp3.js'),'utf8'),
  {self:root,Uint8Array,Float32Array,Array,Number,Math,Promise,setTimeout,String,Error});
const Mp3=root.SunoStemMp3;

(async()=>{
  // Owner acceptance passage first, then early, frame-boundary, odd and
  // end-of-file positions (seconds at 48 kHz).
  const windows=[[462,474],[0,1],[0.5,1.5],[24,24.024],[100.01,101.3],
    [239.976,241],[333.333,334],[479,480]];
  let worst=0,maxPreRoll=0,passages=0;
  for (const f of files) {
    const bytes=new Uint8Array(fs.readFileSync(path.join(dir,f)));
    const index=await Mp3.indexFrames(bytes);
    const ch=index.channels;
    const last=index.frames.at(-1);
    const full=ffmpegDecode(bytes.subarray(index.frames[0].offset,last.offset+last.size));
    assert.equal(full.length/ch,index.sourceFrames,f+': full decode length');
    for (const [a,b] of windows) {
      const out=await Mp3.decodePassage(bytes,a,b);
      const s=Math.round(a*index.rate),e=Math.round(b*index.rate);
      assert.equal(out.passageStartFrame,s);
      assert.equal(out.sourceFrames,index.sourceFrames);
      assert.equal(out.timeline,'mp3-decoder-output');
      assert.equal(out.channels[0].length,e-s);
      for (let c=0;c<ch;c++) for (let t=s;t<e;t++) {
        const d=Math.abs(out.channels[c][t-s]-full[t*ch+c]);
        if (!(d<=worst)) worst=d;
      }
      // Only the passage plus bounded pre-roll and guard frames are fed.
      const fed=FfmpegAudioDecoder.fed.at(-1);
      assert(fed<=Math.ceil((e-s)/1152)+out.preRollFrames+4,f+': fed frames bounded');
      maxPreRoll=Math.max(maxPreRoll,out.preRollFrames);
      passages++;
    }
  }
  assert.equal(worst,0,'indexed seek must be bit-identical to full decode for this decoder');
  console.log('FFmpeg-decoder seek parity: '+passages+' passages over '+files.length+
    ' Viking stems bit-identical to full decode (max abs error 0, max pre-roll '+maxPreRoll+
    ' frames). Other browsers and real WebCodecs remain unverified.');
})().catch(e=>{console.error(e);process.exitCode=1;});
