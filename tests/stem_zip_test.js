/* Regression tests for safe local stem ZIP imports.
 * Generates only synthetic archives; no private user audio is checked into GitHub.
 * Run with Node 22 or newer: node tests/stem_zip_test.js
 */
'use strict';
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const Zip = require('../stem-zip.js');
function zip64Extra(...values) {
  const extra = Buffer.alloc(4 + values.length * 8);
  extra.writeUInt16LE(1, 0);
  extra.writeUInt16LE(extra.length - 4, 2);
  values.forEach((value, index) => extra.writeBigUInt64LE(BigInt(value), 4 + index * 8));
  return extra;
}
function zip(entries, options = {}) {
  const wide = options.zip64, version = wide ? 45 : 20;
  const chunks=[], central=[], enc=new TextEncoder(), flags=wide ? 0x808 : 0x800;
  let offset=0;
  function writeUInt(view,index,v,size) {
    if(size===2)view.writeUInt16LE(v,index);
    else view.writeUInt32LE(v>>>0,index);
  }
  for (const item of entries) {
    const name=enc.encode(item.name), content=Buffer.from(item.data||''),
      deflated=item.method===0?content:zlib.deflateRawSync(content);
    const crc=item.badCrc?0:Zip.crc32(content);
    const localExtra = wide ? zip64Extra(0, 0) : Buffer.alloc(0);
    const loc=Buffer.alloc(30+name.length+localExtra.length);
    writeUInt(loc,0,0x04034b50,4);writeUInt(loc,4,version,2);
    writeUInt(loc,6,item.encrypted?flags|1:flags,2);
    writeUInt(loc,8,item.method===0?0:8,2);
    writeUInt(loc,14,wide?0:crc,4);writeUInt(loc,18,wide?0xffffffff:deflated.length,4);
    writeUInt(loc,22,wide?0xffffffff:content.length,4);writeUInt(loc,26,name.length,2);
    writeUInt(loc,28,localExtra.length,2);
    Buffer.from(name).copy(loc,30);
    localExtra.copy(loc,30+name.length);
    chunks.push(loc,deflated);
    const descriptor = Buffer.alloc(wide ? 24 : 0);
    if (wide) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeBigUInt64LE(BigInt(deflated.length), 8);
      descriptor.writeBigUInt64LE(BigInt(content.length), 16);
      chunks.push(descriptor);
    }
    let centralExtra = wide ? zip64Extra(content.length, deflated.length, offset) : Buffer.alloc(0);
    if (wide && item.zip64Padding) {
      // Extra bytes belong to the same ZIP64 field, not a second field.
      const padding = Buffer.alloc(item.zip64Padding, 0xa5);
      centralExtra.writeUInt16LE(centralExtra.readUInt16LE(2) + padding.length, 2);
      centralExtra = Buffer.concat([centralExtra, padding]);
    }
    if (wide && item.zip64ExtraVariant === 'duplicate') {
      // Both complete ZIP64 fields are structurally valid; only duplicate detection rejects.
      centralExtra = Buffer.concat([centralExtra, centralExtra]);
    }
    if (wide && item.zip64ExtraVariant === 'shortWithValidNext') {
      // Two 8-byte replacements followed by two well-formed empty extra fields.
      // Without the prefix-length guard, the location read crosses the field
      // boundary and sees eight zero bytes, a plausible first-entry offset.
      centralExtra = Buffer.concat([zip64Extra(content.length, deflated.length),
        Buffer.alloc(8)]);
    }
    const dir=Buffer.alloc(46+name.length+centralExtra.length);
    writeUInt(dir,0,0x02014b50,4);
    writeUInt(dir,4,item.symlink?0x300+version:version,2);
    writeUInt(dir,6,version,2);writeUInt(dir,8,item.encrypted?flags|1:flags,2);
    writeUInt(dir,10,item.method===0?0:8,2);
    writeUInt(dir,16,crc,4);writeUInt(dir,20,wide?0xffffffff:deflated.length,4);
    writeUInt(dir,24,wide?0xffffffff:content.length,4);writeUInt(dir,28,name.length,2);
    writeUInt(dir,30,centralExtra.length,2);
    if(item.symlink)writeUInt(dir,38,(0xa000<<16)>>>0,4);
    writeUInt(dir,42,wide?0xffffffff:offset,4);Buffer.from(name).copy(dir,46);
    centralExtra.copy(dir,46+name.length);
    central.push(dir);offset+=loc.length+deflated.length+descriptor.length;
  }
  const tail=Buffer.concat(central),end=Buffer.alloc(22);
  writeUInt(end,0,0x06054b50,4);writeUInt(end,8,entries.length,2);
  writeUInt(end,10,entries.length,2);writeUInt(end,12,tail.length,4);
  writeUInt(end,16,offset,4);
  const comment=Buffer.from(options.comment||Buffer.alloc(0));
  if(comment.length>65535)throw Error('Too long ZIP comment in fixture');
  end.writeUInt16LE(comment.length,20);
  const trailer = [end, comment];
  if (wide) {
    // Match Suno's ZIP64 footer, including placeholder disk numbers in ZIP32.
    end.fill(0xff, 4, 20);
    const record = Buffer.alloc(56), locator = Buffer.alloc(20);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(entries.length), 24);
    record.writeBigUInt64LE(BigInt(entries.length), 32);
    record.writeBigUInt64LE(BigInt(tail.length), 40);
    record.writeBigUInt64LE(BigInt(offset), 48);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + tail.length), 8);
    locator.writeUInt32LE(1, 16);
    trailer.unshift(record, locator);
  }
  const blob=new Blob([...chunks,tail,...trailer]);blob.name=options.name||'stems.zip';return blob;
}
async function throwsZip(f,regex,description) {
  await assert.rejects(async()=>Zip.open(f),regex,description);
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
  // A valid ZIP comment may contain a complete, misleading EOCD-shaped
  // record. The old parser selected it and incorrectly reported a split ZIP.
  const decoy=Buffer.alloc(22);
  decoy.writeUInt32LE(0x06054b50,0);
  decoy.writeUInt16LE(1,4);
  decoy.writeUInt16LE(1,6);
  const commented=zip([{name:'Drums.mp3',data:'local beat'}],{comment:decoy});
  const commentedZip=await Zip.open(commented);
  assert.equal(commentedZip.stems.length,1,'must ignore decoy EOCD in legitimate comment');
  assert.equal(Buffer.from(await commentedZip.extract(commentedZip.stems[0].entry)).toString(),
    'local beat','archive with misleading EOCD comment still extracts');
  const genuinelySplit=Buffer.from(await zip([{name:'Split.mp3',data:'test'}]).arrayBuffer());
  genuinelySplit.writeUInt16LE(1,genuinelySplit.length-22+4);
  genuinelySplit.writeUInt16LE(1,genuinelySplit.length-22+6);
  await throwsZip(new Blob([genuinelySplit]),/split archive|multiple disks/i);
  const wideStems = [{name:'Drums.mp3',data:'synthetic MP3 stem'},
    {name:'Bass.wav',data:'synthetic WAV stem',method:0}];
  const wide = zip(wideStems,{zip64:true});
  const maxComment = Buffer.alloc(65535);
  decoy.copy(maxComment,maxComment.length-decoy.length);
  for (const file of [wide, zip(wideStems,{zip64:true,comment:maxComment})]) {
    const archive = await Zip.open(file);
    assert.deepEqual(archive.stems.map(stem=>[stem.name,stem.format]),[['Drums','MP3'],['Bass','WAV']]);
    for (const [i,stem] of archive.stems.entries())
      assert.equal(Buffer.from(await archive.extract(stem.entry)).toString(),wideStems[i].data);
  }
  const padded = await Zip.open(zip([
    {name:'Padded.mp3',data:'synthetic padded stem',zip64Padding:8},
    {name:'Plain.wav',data:'synthetic plain stem',method:0}
  ],{zip64:true}));
  assert.equal(padded.stems.length,2,'ZIP64 fields may carry bounded extension bytes');
  assert.equal(Buffer.from(await padded.extract(padded.stems[0].entry)).toString(),
    'synthetic padded stem','extended ZIP64 field must preserve payload identity');
  assert.equal(Buffer.from(await padded.extract(padded.stems[1].entry)).toString(),
    'synthetic plain stem','later directory entries remain aligned');
  // These are guard-sensitive: removing the ZIP64 size/duplicate validation
  // would allow both archives to import, unlike a malformed trailing byte.
  await throwsZip(zip([{name:'Duplicate.mp3',data:'duplicate field',
    zip64ExtraVariant:'duplicate'}],{zip64:true}),
    /invalid ZIP64 entry extra field/, 'duplicate complete ZIP64 extra fields');
  await throwsZip(zip([{name:'Short.mp3',data:'short replacement prefix',
    zip64ExtraVariant:'shortWithValidNext'}],{zip64:true}),
    /invalid ZIP64 entry extra field/, 'short ZIP64 prefix followed by valid extra fields');
  const zip64 = Buffer.from(await wide.arrayBuffer());
  const end = zip64.length-22, locator = end-20;
  const record = Number(zip64.readBigUInt64LE(locator+8));
  const directory = Number(zip64.readBigUInt64LE(record+48));
  const extra = directory+46+zip64.readUInt16LE(directory+28);
  const legacyValues = Buffer.from(zip64);
  legacyValues.writeUInt32LE(0,end+4);
  legacyValues.writeUInt16LE(wideStems.length,end+8);
  legacyValues.writeUInt16LE(wideStems.length,end+10);
  legacyValues.writeUInt32LE(record-directory,end+12);
  legacyValues.writeUInt32LE(directory,end+16);
  assert.equal((await Zip.open(new Blob([legacyValues]))).stems.length,wideStems.length,
    'ZIP64 locator is supported when also writing ordinary footer values');
  const extension = Buffer.from([1, 0, 0, 0, 0, 0]);
  const extended = Buffer.concat([zip64.subarray(0,locator),extension,zip64.subarray(locator),maxComment]);
  extended.writeBigUInt64LE(BigInt(44+extension.length),record+4);
  extended.writeUInt16LE(maxComment.length,end+extension.length+20);
  assert.equal((await Zip.open(new Blob([extended]))).stems.length,wideStems.length,
    'ZIP64 end record can extend beyond the bounded initial tail read');
  const rejects = [
    ['missing locator', b=>b.writeUInt32LE(0,locator), /missing ZIP64/],
    ['invalid record offset', b=>b.writeBigUInt64LE(BigInt(locator),locator+8), /ZIP64.*offset/],
    ['truncated record', b=>b.writeBigUInt64LE(43n,record+4), /ZIP64.*length/],
    ['split locator', b=>b.writeUInt32LE(2,locator+16), /multiple disks/],
    ['split footer', b=>b.writeUInt32LE(1,record+16), /multiple disks/],
    ['split entry', b=>b.writeUInt16LE(1,directory+34), /multiple disks/],
    ['legacy fields conflict', b=>b.writeUInt16LE(1,end+10), /records disagree/],
    ['directory count exceeds cap', b=>{ b.writeBigUInt64LE(257n,record+24); b.writeBigUInt64LE(257n,record+32); }, /too many entries/],
    ['directory outside the archive', b=>b.writeBigUInt64LE(BigInt(zip64.length),record+48), /directory bounds/],
    ['missing entry extra field', b=>b.writeUInt16LE(2,extra), /missing ZIP64 entry extra/],
    ['truncated entry extra field', b=>b.writeUInt16LE(25,extra+2), /truncated ZIP extra/],
    ['short ZIP64 replacement prefix', b=>b.writeUInt16LE(23,extra+2), /invalid ZIP64|truncated ZIP extra/],
    ['entry size overflows 32 bits', b=>b.writeBigUInt64LE(1n<<32n,extra+4), /ZIP64 value exceeds/],
    ['entry exceeds cap', b=>b.writeBigUInt64LE(BigInt(Zip.MAX_ENTRY+1),extra+4), /160 MiB/],
    ['local header overlaps the directory', b=>b.writeBigUInt64LE(BigInt(directory),extra+20), /local entry overlaps/]
  ];
  for (const [description,change,expected] of rejects) {
    const damaged = Buffer.from(zip64);
    change(damaged);
    await throwsZip(new Blob([damaged]),expected,description);
  }
  // Cancellation is checked before any entry bytes are read. A cancelled
  // extraction must never produce a partial, CRC-unverified result.
  const cancelled=await Zip.open(zip([{name:'Cancelled.mp3',data:'never read'}]));
  const abortBefore=new AbortController();abortBefore.abort();
  await assert.rejects(cancelled.extract(cancelled.stems[0].entry,abortBefore.signal),
    /extraction cancelled/);
  const afterAbort=await cancelled.extract(cancelled.stems[0].entry);
  assert.equal(Buffer.from(afterAbort).toString(),'never read',
    'a cancelled extraction must not corrupt a subsequent read');
  const tooMany=Array.from({length:257},(_,i)=>({name:i+'.mp3',data:'a'}));
  await throwsZip(zip(tooMany),/too many entries/);
  console.log('Stem ZIP tests passed: stored/deflated, UTF-8, local extraction, MP3-only, format pairs, CRC, ZIP32/ZIP64, comment-decoy end records, genuine split disks, traversal, symlinks, encryption, duplicates, bounds.');
})().catch(err=>{console.error(err);process.exitCode=1;});
