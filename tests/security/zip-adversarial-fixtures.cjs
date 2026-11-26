'use strict';
// Synthetic test data only. No production ZIP parsing or user content.
const { deflateRawSync } = require('node:zlib');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function makeZip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const { name, content = 'synthetic', declaredSize } of entries) {
    const filename = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const compressed = deflateRawSync(raw);
    const size = declaredSize ?? raw.length;
    if (filename.length > 65535 || size > 0xffffffff) throw new RangeError('Fixture exceeds ZIP32');
    const checksum = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(checksum, 14); lh.writeUInt32LE(compressed.length, 18);
    lh.writeUInt32LE(size, 22); lh.writeUInt16LE(filename.length, 26);
    local.push(lh, filename, compressed);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8);
    ch.writeUInt16LE(8, 10); ch.writeUInt32LE(checksum, 16);
    ch.writeUInt32LE(compressed.length, 20); ch.writeUInt32LE(size, 24);
    ch.writeUInt16LE(filename.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, filename);
    offset += lh.length + filename.length + compressed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
function cases() {
  return {
    valid: makeZip([{ name: 'stems/drums.wav', content: 'fake audio header only' }]),
    traversal: makeZip([{ name: '../outside.wav' }]),
    backslashTraversal: makeZip([{ name: '..\\outside.wav' }]),
    absolutePath: makeZip([{ name: '/outside.wav' }]),
    duplicate: makeZip([{ name: 'stems/a.wav' }, { name: 'stems/a.wav', content: 'other' }]),
    forgedSize: makeZip([{ name: 'stems/a.wav', declaredSize: 0xffffffff }]),
    compressionBomb: makeZip([{ name: 'stems/a.wav', content: Buffer.alloc(1024 * 1024, 0) }])
  };
}
module.exports = { makeZip, cases };
