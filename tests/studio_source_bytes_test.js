'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { webcrypto } = require('node:crypto');
const { verifySourceBytes, DEFAULT_LIMIT } = require('../studio-source-bytes.js');
const shaEmpty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const shaAbc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const opts = { cryptoProvider: webcrypto };
test('hashes exact immutable source Blob and returns native snapshot', async () => {
  const blob = new Blob(['abc']);
  const value = await verifySourceBytes(blob, shaAbc.toUpperCase(), opts);
  assert.notEqual(value.blob, blob); assert.equal(Object.getPrototypeOf(value.blob), Blob.prototype);
  assert.equal(Buffer.from(await value.blob.arrayBuffer()).toString(), 'abc');
  assert.equal(value.digest, shaAbc); assert.equal(value.byteLength, 3);
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
  assert.equal(Object.getPrototypeOf(value.blob), Blob.prototype);
  assert.equal(Buffer.from(await value.blob.arrayBuffer()).toString(), 'abc');
});
test('rejects Blob prototype forgery without native internal slots', async () => {
  const forged = Object.create(Blob.prototype);
  forged.arrayBuffer = async () => new TextEncoder().encode('abc').buffer;
  await assert.rejects(verifySourceBytes(forged, shaAbc, opts), /native local Blob/);
});

test('verified snapshot is immune to hostile subclass and later method mutation', async () => {
  class HostileBlob extends Blob {
    async arrayBuffer() { return new TextEncoder().encode('BAD').buffer; }
  }
  const source = new HostileBlob(['abc']);
  const verified = await verifySourceBytes(source, shaAbc, opts);
  source.arrayBuffer = async () => new TextEncoder().encode('EVIL').buffer;
  assert.notEqual(verified.blob, source);
  assert.equal(Object.getPrototypeOf(verified.blob), Blob.prototype);
  assert.equal(Buffer.from(await verified.blob.arrayBuffer()).toString(), 'abc');
  assert.equal(verified.digest, shaAbc);
});

const { verifyManifestSources, MAX_MANIFEST_SOURCES } = require('../studio-source-bytes.js');
const sha = text => require('node:crypto').createHash('sha256').update(text).digest('hex');
const records = () => [{ id:'a', digest:shaAbc }, { id:'b', digest:sha('def') }];
const selection = () => new Map([['b',new Blob(['def'])],['a',new Blob(['abc'])]]);

test('manifest re-link verifies exact sources in manifest order with immutable result records', async () => {
  const chosen = selection();
  const result = await verifyManifestSources(records(), chosen, {maxTotalBytes:6});
  assert.deepEqual(result.map(r=>r.id), ['a','b']);
  assert.deepEqual(result.map(r=>r.digest), [shaAbc,sha('def')]);
  assert.ok(Object.isFrozen(result) && result.every(Object.isFrozen));
  for (const [i, value] of result.entries()) {
    assert.notEqual(value.blob, chosen.get(value.id));
    assert.equal(await value.blob.text(), ['abc','def'][i]);
    assert.equal(value.byteLength, 3);
  }
});
test('manifest re-link rejects same-size substituted bytes and swapped IDs', async () => {
  const chosen = selection(); chosen.set('b',new Blob(['deg']));
  await assert.rejects(verifyManifestSources(records(),chosen), /mismatch/);
  await assert.rejects(verifyManifestSources(records(),new Map([['a',new Blob(['def'])],['b',new Blob(['abc'])]])), /mismatch/);
});
test('manifest re-link rejects missing, extra and duplicate sources', async () => {
  await assert.rejects(verifyManifestSources(records(),new Map()), /count/);
  const extra=selection(); extra.set('c',new Blob(['abc']));
  await assert.rejects(verifyManifestSources(records(),extra), /count/);
  const wrong=selection(); wrong.delete('b'); wrong.set('c',new Blob(['def']));
  await assert.rejects(verifyManifestSources(records(),wrong), /Missing/);
  await assert.rejects(verifyManifestSources([records()[0],records()[0]],selection()), /duplicate/);
});
test('manifest re-link rejects malformed IDs, digests, holes and accessors', async () => {
  for (const record of [{id:'',digest:shaAbc},{id:'a',digest:'bad'},{id:'a'},Object.create({id:'a',digest:shaAbc}),
    {get id(){throw Error('must not invoke getter')},digest:shaAbc}])
    await assert.rejects(verifyManifestSources([record],new Map([['a',new Blob(['abc'])]])), /manifest/i);
  await assert.rejects(verifyManifestSources(new Array(1),new Map([['a',new Blob(['abc'])]])), /manifest/i);
});
test('manifest re-link admits aggregate bytes before hashing and enforces count and budget', async () => {
  await assert.rejects(verifyManifestSources(records(),selection(),{maxTotalBytes:5}), /aggregate/);
  await assert.rejects(verifyManifestSources(records(),selection(),{maxTotalBytes:DEFAULT_LIMIT+1}), /limit/);
  await assert.rejects(verifyManifestSources(new Array(MAX_MANIFEST_SOURCES+1),new Map()), /count/);
  await assert.rejects(verifyManifestSources([],new Map()), /count/);
  const empty=selection();empty.set('b',new Blob([]));
  await assert.rejects(verifyManifestSources(records(),empty), /aggregate/);
});
test('manifest re-link snapshots selection and digest before asynchronous verification', async () => {
  const manifest=records(), chosen=selection();
  const promise=verifyManifestSources(manifest,chosen);
  manifest[1].digest=sha('BAD');manifest[1].id='evil';
  chosen.set('b',new Blob(['BAD']));chosen.clear();
  const result=await promise;
  assert.equal(result[1].id,'b');
  assert.equal(await result[1].blob.text(),'def');
});
test('manifest re-link cancels before work and during asynchronous verification', async () => {
  const before=new AbortController();before.abort();
  await assert.rejects(verifyManifestSources(records(),selection(),{signal:before.signal}), /cancelled/);
  const during=new AbortController();
  const pending=verifyManifestSources(records(),selection(),{signal:during.signal});
  during.abort();
  await assert.rejects(pending,/cancelled/);
});
test('manifest re-link rejects fake Maps and Blob lookalikes, ignores overridden Map methods', async () => {
  await assert.rejects(verifyManifestSources(records(),{size:2,get(){throw Error('must not call')}}), /native/);
  const chosen=selection();chosen.set('b',{size:3,arrayBuffer(){throw Error('must not call')}});
  await assert.rejects(verifyManifestSources(records(),chosen), /native/);
  const real=selection();real.get=()=>new Blob(['BAD']);real.has=()=>false;
  assert.equal(await (await verifyManifestSources(records(),real))[1].blob.text(),'def');
});

test('manifest re-link rejects reentrant array truncation instead of partial success', async () => {
  const target = records();
  const sources = new Proxy(target, {
    getOwnPropertyDescriptor(array, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(array, key);
      if (key === '0') array.length = 1;
      return descriptor;
    }
  });
  await assert.rejects(verifyManifestSources(sources, selection()), /manifest/i);
  assert.equal(target.length, 1, 'the adversarial trap actually ran');
});
test('manifest re-link rejects synchronous source-list expansion during admission', async () => {
  const target = records();
  const sources = new Proxy(target, {
    getOwnPropertyDescriptor(array, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(array, key);
      if (key === '1') array.push({id:'c', digest:shaAbc});
      return descriptor;
    }
  });
  await assert.rejects(verifyManifestSources(sources, selection()), /count changed/);
  assert.equal(target.length, 3);
});
test('manifest re-link rejects reentrant same-count native selection substitution', async () => {
  const chosen = selection(), original = chosen.get('a');
  const manifest = records();
  manifest[1] = new Proxy(manifest[1], {
    getOwnPropertyDescriptor(record, key) {
      if (key === 'digest') chosen.set('a', new Blob(['abc']));
      return Reflect.getOwnPropertyDescriptor(record, key);
    }
  });
  await assert.rejects(verifyManifestSources(manifest, chosen), /selection changed/);
  assert.equal(chosen.size, 2);
  assert.notEqual(chosen.get('a'), original);
});
test('manifest re-link rejects reentrant selection count or membership changes', async () => {
  for (const mutate of [map => map.delete('a'), map => {map.delete('a');map.set('c',new Blob(['abc']));}]) {
    const chosen = selection();
    const manifest = new Proxy(records(), {
      getOwnPropertyDescriptor(array, key) {
        if (key === '0') mutate(chosen);
        return Reflect.getOwnPropertyDescriptor(array, key);
      }
    });
    await assert.rejects(verifyManifestSources(manifest, chosen), /selection changed/);
    assert.equal(chosen.has('a'), false);
  }
});
