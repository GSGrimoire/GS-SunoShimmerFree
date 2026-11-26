'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { inflateRawSync } = require('node:zlib');
const { cases } = require('./zip-adversarial-fixtures.cjs');
function entries(zip) {
  const eocd = zip.length - 22;
  assert.equal(zip.readUInt32LE(eocd), 0x06054b50);
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  const found = [];
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50);
    const compressed = zip.readUInt32LE(at + 20);
    const declared = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localOffset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    assert.equal(zip.readUInt32LE(localOffset), 0x04034b50);
    const dataAt = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const raw = inflateRawSync(zip.subarray(dataAt, dataAt + compressed));
    found.push({ name, declared, compressed, actual: raw.length });
    at += 46 + nameLength + extraLength + commentLength;
  }
  assert.equal(at, eocd);
  return found;
}
test('valid ZIP32 control is structurally readable', () => {
  const list = entries(cases().valid);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'stems/drums.wav');
  assert.equal(list[0].actual, list[0].declared);
});
test('fixtures preserve traversal and absolute path attack names', () => {
  const c = cases();
  assert.equal(entries(c.traversal)[0].name, '../outside.wav');
  assert.equal(entries(c.backslashTraversal)[0].name, '..\\outside.wav');
  assert.equal(entries(c.absolutePath)[0].name, '/outside.wav');
});
test('duplicate central directory filenames are present', () => {
  const list = entries(cases().duplicate);
  assert.equal(list.length, 2);
  assert.equal(list[0].name, list[1].name);
});
test('forged uncompressed size differs from actual content', () => {
  const item = entries(cases().forgedSize)[0];
  assert.equal(item.declared, 0xffffffff);
  assert.notEqual(item.actual, item.declared);
});
test('high compression ratio fixture is real compressed data', () => {
  const item = entries(cases().compressionBomb)[0];
  assert.equal(item.actual, 1024 * 1024);
  assert.ok(item.actual / item.compressed > 100);
});
