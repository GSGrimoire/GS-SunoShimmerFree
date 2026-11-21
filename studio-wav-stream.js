'use strict';
// Bounded PCM16 WAV output. Caller supplies verified, aligned, finite audio chunks.
const MAX_CHUNK_FRAMES = 16384;
function positiveInteger(n, name) {
  if (!Number.isSafeInteger(n) || n < 1) throw new RangeError(name);
  return n;
}
function header(sampleRate, channels, frames) {
  positiveInteger(sampleRate, 'sampleRate');
  if (sampleRate > 384000) throw new RangeError('sampleRate');
  if (channels !== 1 && channels !== 2) throw new RangeError('channels');
  positiveInteger(frames, 'frames');
  const bytes = frames * channels * 2;
  if (!Number.isSafeInteger(bytes) || bytes > 0xffffffff - 36) throw new RangeError('WAV RIFF size');
  const out = new Uint8Array(44), v = new DataView(out.buffer);
  function ascii(offset, s) { for (let i = 0; i < s.length; i++) out[offset+i] = s.charCodeAt(i); }
  ascii(0,'RIFF'); v.setUint32(4,36+bytes,true); ascii(8,'WAVE'); ascii(12,'fmt ');
  v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,channels,true);
  v.setUint32(24,sampleRate,true); v.setUint32(28,sampleRate*channels*2,true);
  v.setUint16(32,channels*2,true); v.setUint16(34,16,true);
  ascii(36,'data'); v.setUint32(40,bytes,true);
  return out;
}
function encodeChunk(samples, channels) {
  if (channels !== 1 && channels !== 2) throw new RangeError('channels');
  if (!(samples instanceof Float32Array) || samples.length < channels || samples.length % channels !== 0 || samples.length > MAX_CHUNK_FRAMES * channels) throw new RangeError('chunk length');
  const out = new Uint8Array(samples.length * 2), v = new DataView(out.buffer);
  // Validate all samples before encoding to avoid partially encoded invalid output.
  for (let i=0; i<samples.length; i++) if (!Number.isFinite(samples[i]) || Math.abs(samples[i]) > 1) throw new RangeError('sample outside [-1,1]');
  for (let i=0; i<samples.length; i++) {
    const x=samples[i]; v.setInt16(i*2, x < 0 ? Math.round(x*32768) : Math.round(x*32767), true);
  }
  return out;
}
async function writeWav({sampleRate, channels, frames, chunks, write, signal}) {
  // write(bytes) must resolve only when the sink has consumed or copied bytes.
  // A failed sink may already have a partial file; caller must discard it.
  if (typeof write !== 'function' || !chunks || typeof chunks[Symbol.asyncIterator] !== 'function') throw new TypeError('async chunks and write required');
  const wavHeader=header(sampleRate,channels,frames);
  if (signal?.aborted) throw new Error('WAV export cancelled');
  await write(wavHeader);
  let next=0;
  for await (const chunk of chunks) {
    if (signal?.aborted) throw new Error('WAV export cancelled');
    if (!chunk || !Number.isSafeInteger(chunk.startFrame) || chunk.startFrame !== next) throw new RangeError('non-contiguous chunk');
    const bytes=encodeChunk(chunk.samples,channels);
    const count=chunk.samples.length/channels;
    if (next+count > frames) throw new RangeError('chunk exceeds declared frames');
    await write(bytes);
    next+=count;
  }
  if (signal?.aborted) throw new Error('WAV export cancelled');
  if (next !== frames) throw new RangeError('incomplete WAV');
  return {frames, bytes:44+frames*channels*2};
}
const api={header,encodeChunk,writeWav,MAX_CHUNK_FRAMES};
if (typeof module !== 'undefined' && module.exports) module.exports=api;
if (typeof globalThis !== 'undefined') globalThis.SSFStudioWavStream=api;
