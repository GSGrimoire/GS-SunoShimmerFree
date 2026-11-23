/* Independent resampler regression for SSF stem ZIP workspace.
 * Run: node tests/stem_resample_test.js
 */
'use strict';
const assert = require('node:assert/strict');
const SRC = require('../stem-resample.js');
function tone(rate, hz, length, amp) {
  const n = Math.round(rate * length);
  return Float32Array.from({length:n},(_,i) => (amp||0.5)*Math.sin(2*Math.PI*hz*i/rate));
}
function amplitudeAt(audio, rate, hz) {
  const begin = Math.min(2000,Math.floor(audio.length/8));
  let sin=0,cos=0;
  for(let i=begin;i<audio.length-begin;i++){
    const theta=2*Math.PI*hz*i/rate;
    sin+=audio[i]*Math.sin(theta);cos+=audio[i]*Math.cos(theta);
  }
  return 2*Math.hypot(sin,cos)/(audio.length-2*begin);
}
function linear(input, oldRate, newRate) {
  const length=Math.round(input.length*newRate/oldRate),output=new Float32Array(length);
  for(let i=0;i<length;i++){
    const x=i*oldRate/newRate, a=Math.min(Math.floor(x),input.length-1);
    output[i]=input[a]*(1-(x-a))+input[Math.min(a+1,input.length-1)]*(x-a);
  }
  return output;
}
const oldRate=48000,targetRate=44100,high=23000,alias=targetRate-high;
const highInput=tone(oldRate,high,.36,.6);
const filtered=SRC.resample([highInput],oldRate,targetRate)[0];
const naive=linear(highInput,oldRate,targetRate);
const filteredAlias=amplitudeAt(filtered,targetRate,alias);
const naiveAlias=amplitudeAt(naive,targetRate,alias);
assert(naiveAlias>0.2, 'original linear interpolator must reproduce a strong alias');
assert(filteredAlias<0.04, '23 kHz source must not alias into 21.1 kHz near the destination Nyquist');
assert(filteredAlias<naiveAlias*0.15, 'band-limited output must attenuate alias relative to old converter');
const passIn=tone(oldRate,1200,.36,.4), pass=SRC.resample([passIn],oldRate,targetRate)[0];
assert(Math.abs(amplitudeAt(pass,targetRate,1200)-.4)<.01, 'passband amplitude retained');
const constant=Float32Array.from({length:4800},()=>.25);
const dc=SRC.resample([constant,constant],oldRate,targetRate);
assert(dc.every(a=>a.every(x=>Math.abs(x-.25)<1e-5)), 'normalization preserves DC at ends and middle');
assert.notEqual(dc[0],constant,'output is separately allocated');
const identity=SRC.resample([passIn],oldRate,oldRate);
assert.deepEqual(identity[0],passIn,'equal sample rates are transparent');
assert.notEqual(identity[0],passIn,'equal-rate copy does not alias source');
const up=SRC.resample([passIn],oldRate,96000);
assert.equal(up[0].length,passIn.length*2);
assert(up[0].every(Number.isFinite));
assert.throws(()=>SRC.resample([Float32Array.of(0),new Float32Array(2)],48000,44100),/lengths differ/);
assert.throws(()=>SRC.resample([Float32Array.of(NaN,0)],48000,44100),/Non-finite/);
assert.throws(()=>SRC.resample([constant],0,44100),/Invalid audio/);
console.log('Band-limited stem resampling passed: suppressed 23→21.1 kHz alias, passband, DC, stereo, upsample and validation.');
