'use strict';
// Pure bounded PCM mixing kernel; caller must verify source identity and frame alignment.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SSFStudioChunkMix=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
function mixChunk(stems,frames,channels,options={}){
 if(!Number.isSafeInteger(frames)||frames<1||frames>16384)throw new RangeError('Invalid chunk frames');
 if(channels!==1&&channels!==2)throw new RangeError('Invalid channel count');
 if(!Array.isArray(stems)||stems.length<1||stems.length>10)throw new RangeError('Invalid stem count');
 const count=frames*channels,masterGain=options.masterGain===undefined?1:options.masterGain;
 if(!Number.isFinite(masterGain)||masterGain<0||masterGain>4)throw new RangeError('Invalid master gain');
 const ids=new Set();
 for(const stem of stems){
  if(!stem||typeof stem.id!=='string'||!stem.id||ids.has(stem.id))throw new TypeError('Invalid or duplicate stem ID');
  ids.add(stem.id);
  if(!(stem.samples instanceof Float32Array)||stem.samples.length!==count)throw new RangeError('Stem chunk length mismatch');
  const gain=stem.gain===undefined?1:stem.gain;
  if(!Number.isFinite(gain)||gain<0||gain>4)throw new RangeError('Invalid stem gain');
  if(stem.mute!==undefined&&typeof stem.mute!=='boolean')throw new TypeError('Invalid mute');
  if(stem.solo!==undefined&&typeof stem.solo!=='boolean')throw new TypeError('Invalid solo');
  for(let i=0;i<count;i++)if(!Number.isFinite(stem.samples[i]))throw new RangeError('Non-finite audio sample');
 }
 const solo=stems.some(s=>s.solo),output=new Float32Array(count);
 let peak=0,clippedSamples=0;
 for(let i=0;i<count;i++){
  let value=0;
  for(const stem of stems)if(!stem.mute&&(!solo||stem.solo))value+=stem.samples[i]*(stem.gain===undefined?1:stem.gain);
  value*=masterGain;
  if(!Number.isFinite(value))throw new RangeError('Non-finite mix');
  peak=Math.max(peak,Math.abs(value));
  if(Math.abs(value)>1)clippedSamples++;
  output[i]=Math.max(-1,Math.min(1,value));
 }
 return {samples:output,peak,clippedSamples,limited:clippedSamples>0};
}
return Object.freeze({mixChunk});
});
