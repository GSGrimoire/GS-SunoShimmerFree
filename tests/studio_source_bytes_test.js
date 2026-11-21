'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const { verifySourceBytes, DEFAULT_LIMIT } = require('../studio-source-bytes.js');
const shaEmpty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const shaAbc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const opts = { cryptoProvider: webcrypto };
test('hashes exact immutable source Blob and returns identity', async () => {
  const blob = new Blob(['abc']);
  const value = await verifySourceBytes(blob, shaAbc.toUpperCase(), opts);
  assert.equal(value.blob, blob); assert.equal(value.digest, shaAbc); assert.equal(value.byteLength, 3);
  assert.ok(Object.isFrozen(value));
});
test('same-size swapped bytes and filename-independent digest are rejected', async () => {
  await assert.rejects(verifySourceBytes(new Blob(['abd']), shaAbc, opts), /mismatch/);
  const named = new Blob(['abc']); named.name = 'trusted.mp3';
  await assert.rejects(verifySourceBytes(named, '0'.repeat(64), opts), /mismatch/);
});
test('missing and malformed expected digest fail closed', async () => {
  for (const digest of [undefined, 'abc', 'g'.repeat(64)])
    await assert.rejects(verifySourceBytes(new Blob(['abc']), digest, opts), /digest/);
});
test('empty and over-budget inputs rejected before reading', async () => {
  await assert.rejects(verifySourceBytes(new Blob([]), shaEmpty, opts), /limit/);
  const large = {size: DEFAULT_LIMIT + 1, async arrayBuffer() { throw Error('must not read'); }};
  await assert.rejects(verifySourceBytes(large, shaAbc, opts), /native local Blob/);
  await assert.rejects(verifySourceBytes(new Blob(['abc']), shaAbc, {...opts, maxBytes: 2}), /limit/);
});
test('invalid limit and unavailable digest API rejected', async () => {
  await assert.rejects(verifySourceBytes(new Blob(['abc']), shaAbc, {...opts, maxBytes: DEFAULT_LIMIT + 1}), /limit/);
  await assert.rejects(verifySourceBytes(new Blob(['abc']), shaAbc, {cryptoProvider: {}}), /unavailable/);
});
test('cancellation before read and after delayed digest', async () => {
  const c = new AbortController(); c.abort();
  await assert.rejects(verifySourceBytes(new Blob(['abc']), shaAbc, {...opts, signal: c.signal}), /cancelled/);
  const d = new AbortController();
  const slow = {subtle:{async digest(_algorithm, bytes) { d.abort(); return webcrypto.subtle.digest('SHA-256', bytes); }}};
  await assert.rejects(verifySourceBytes(new Blob(['abc']), shaAbc, {cryptoProvider: slow, signal:d.signal}), /cancelled/);
});
test('rejects spoofed Blob-like input', async () => {
  const bad = {size: 3, async arrayBuffer() { return new Uint8Array([97,98]).buffer; }};
  await assert.rejects(verifySourceBytes(bad, shaAbc, opts), /native local Blob/);
});
test('hashes native stored bytes despite overridden Blob methods and size', async () => {
  class MisleadingBlob extends Blob {
    get size() { return 3; }
    async arrayBuffer() { return new TextEncoder().encode('abc').buffer; }
  }
  await assert.rejects(verifySourceBytes(new MisleadingBlob(['BAD']), shaAbc, opts), /mismatch/);
  const value = await verifySourceBytes(new MisleadingBlob(['abc']), shaAbc, opts);
  assert.equal(value.byteLength, 3);
});
test('rejects Blob prototype forgery without native internal slots', async () => {
  const forged = Object.create(Blob.prototype);
  forged.arrayBuffer = async () => new TextEncoder().encode('abc').buffer;
  await assert.rejects(verifySourceBytes(forged, shaAbc, opts), /native local Blob/);
});
