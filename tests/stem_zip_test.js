/* Regression tests for safe local stem ZIP imports.
 * Generates only synthetic archives; no private user audio is checked into GitHub.
 * Run with Node 22 or newer: node tests/stem_zip_test.js
 */
'use strict';
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const Zip = require('../stem-zip.js');
function zip(entries, options = {}) {
  const chunks=[], central=[], enc=new TextEncoder(), flags=0x800;
  let offset=0;
  function writeUInt(view,index,v,size) {
    if(size===2)view.writeUInt16LE(v,index);
    else view.writeUInt32LE(v>>>0,index);
  }
  for (const item of entries) {
    const name=enc.encode(item.name), content=Buffer.from(item.data||''),
      deflated=item.method===0?content:zlib.deflateRawSync(content);
    const crc=item.badCrc?0:Zip.crc32(content);
    const loc=Buffer.alloc(30+name.length);
    writeUInt(loc,0,0x04034b50,4);writeUInt(loc,4,20,2);
    writeUInt(loc,6,item.encrypted?flags|1:flags,2);
    writeUInt(loc,8,item.method===0?0:8,2);
    writeUInt(loc,14,crc,4);writeUInt(loc,18,deflated.length,4);
    writeUInt(loc,22,content.length,4);writeUInt(loc,26,name.length,2);
    Buffer.from(name).copy(loc,30);
    chunks.push(loc,deflated);
    const dir=Buffer.alloc(46+name.length);
    writeUInt(dir,0,0x02014b50,4);
    writeUInt(dir,4,item.symlink?0x0314:0x0014,2);
    writeUInt(dir,6,20,2);writeUInt(dir,8,item.encrypted?flags|1:flags,2);
    writeUInt(dir,10,item.method===0?0:8,2);
    writeUInt(dir,16,crc,4);writeUInt(dir,20,deflated.length,4);
    writeUInt(dir,24,content.length,4);writeUInt(dir,28,name.length,2);
    if(item.symlink)writeUInt(dir,38,(0xa000<<16)>>>0,4);
    writeUInt(dir,42,offset,4);Buffer.from(name).copy(dir,46);
    central.push(dir);offset+=loc.length+deflated.length;
  }
  const tail=Buffer.concat(central),end=Buffer.alloc(22);
  writeUInt(end,0,0x06054b50,4);writeUInt(end,8,entries.length,2);
  writeUInt(end,10,entries.length,2);writeUInt(end,12,tail.length,4);
  writeUInt(end,16,offset,4);
  const blob=new Blob([...chunks,tail,end]);blob.name=options.name||'stems.zip';return blob;
}
async function throwsZip(f,regex) {
  await assert.rejects(async()=>Zip.open(f),regex);
}
(async()=>{
  const sample=zip([
    {name:'Song (Guitar).mp3',data:'MP3 guitar'},
    {name:'Song (Guitar).wav',data:'WAV guitar',method:0},
    {name:'Song (Backing Vocals).mp3',data:'MP3 backing vocals'},
    {name:'混音/木管.mp3',data:'Woodwind'},
    {name:'metadata/readme.txt',data:'text to be ignored'}
  ]);
  const a=await Zip.open(sample);
  assert.equal(a.stems.length,3);
  assert.equal(a.stems[0].name,'Guitar');
  assert.equal(a.stems[0].format,'WAV','WAV preferred over duplicated MP3');
  assert.equal(a.stems[1].name,'Backing Vocals');
  assert.equal(a.stems[2].name,'木管','localized stem name preserved');
  assert.equal(a.stems[2].format,'MP3','MP3-only archives accepted');
  assert.equal(Buffer.from(await a.extract(a.stems[0].entry)).toString(),'WAV guitar');
  assert.equal(Buffer.from(await a.extract(a.stems[1].entry)).toString(),'MP3 backing vocals');
  assert.equal(Buffer.from(await a.extract(a.stems[2].entry)).toString(),'Woodwind');
  assert.equal(a.entries.length,5);
  assert.equal(a.file.size,sample.size);
  const mp3only=zip(['Lead Vocals','Drums','Bass','Guitar','Keyboard','Percussion',
    'Strings','Synth','Other','Brass','Woodwinds'].map(s=>({name:s+'.mp3',data:Buffer.from('synthetic '+s)})));
  const b=await Zip.open(mp3only);
  assert.equal(b.stems.length,11,'user-like MP3-only stem manifest');
  assert.equal(b.stems.filter(s=>s.format==='MP3').length,11);
  for(const s of b.stems) assert.equal(Buffer.from(await b.extract(s.entry)).toString(),'synthetic '+s.name);
  for(const name of ['../outside.mp3','/root/bass.mp3','X:\\Windows\\music.mp3','folder/../other.wav',
    'folder/./x.mp3']) await throwsZip(zip([{name,data:'x'}]),/unsafe|absolute/i);
  await throwsZip(zip([{name:'link.mp3',data:'x',symlink:true}]),/symbolic/i);
  await throwsZip(zip([{name:'encrypted.mp3',data:'x',encrypted:true}]),/encrypted/i);
  await throwsZip(zip([{name:'Vocals.mp3',data:'x'},{name:'Vocals.mp3',data:'z'}]),/duplicate entry/i);
  await throwsZip(zip([{name:'x.mp3',data:'x'},{name:'X.MP3',data:'x'}]),/duplicate stem format/i);
  await throwsZip(zip([{name:'image.jpeg',data:'not audio'}]),/no WAV or MP3/i);
  const bad=await Zip.open(zip([{name:'bad.mp3',data:'broken payload',badCrc:true}]));
  await assert.rejects(bad.extract(bad.stems[0].entry),/CRC mismatch/);
  const short=Buffer.from(await zip([{name:'a.mp3',data:'a'}]).arrayBuffer());
  short.writeUInt32LE(0xffffffff,short.length-22+16);
  await throwsZip(new Blob([short]),/ZIP64|directory bounds/);
  const tooMany=Array.from({length:257},(_,i)=>({name:i+'.mp3',data:'a'}));
  await throwsZip(zip(tooMany),/too many entries/);
  console.log('Stem ZIP tests passed: stored/deflated, UTF-8, local extraction, MP3-only, format pairs, CRC, ZIP64, traversal, symlinks, encryption, duplicates, bounds.');
})().catch(err=>{console.error(err);process.exitCode=1;});
