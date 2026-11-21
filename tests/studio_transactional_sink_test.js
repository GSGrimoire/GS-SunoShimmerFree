import test from 'node:test';
import assert from 'node:assert/strict';
import { exportTransaction } from '../studio-transactional-sink.js';
function adapter() {
  const s = { temporary: [], visible: null, discarded: false, committed: false };
  return { s,
    async begin() {},
    async write(chunk) { s.temporary.push(chunk); },
    async commit() { s.visible = s.temporary.map(x => [...x]); s.committed = true; return 'saved'; },
    async discard() { s.discarded = true; s.temporary = []; }
  };
}
test('only completed bytes are published and copied', async () => {
  const a = adapter(), data = Uint8Array.from([1,2]);
  const outcome = await exportTransaction(a, async write => { await write(data); data[0] = 99; await write(Uint8Array.of(3)); });
  assert.deepEqual(outcome, { result: 'saved', bytes: 3 });
  assert.deepEqual(a.s.visible, [[1,2],[3]]);
});
test('producer failure discards partial bytes', async () => {
  const a = adapter();
  await assert.rejects(exportTransaction(a, async write => { await write(Uint8Array.of(1)); throw Error('late failure'); }), /late failure/);
  assert.equal(a.s.visible, null); assert.equal(a.s.discarded, true);
});
test('cancellation before begin does not touch adapter', async () => {
  const a = adapter(), controller = new AbortController(); controller.abort();
  await assert.rejects(exportTransaction(a, async () => {}, {signal: controller.signal}), /cancelled/);
  assert.equal(a.s.discarded, false);
});
test('cancellation after a chunk discards data', async () => {
  const a = adapter(), controller = new AbortController();
  await assert.rejects(exportTransaction(a, async write => { await write(Uint8Array.of(1)); controller.abort(); }, {signal: controller.signal}), /cancelled/);
  assert.equal(a.s.visible, null); assert.equal(a.s.discarded, true);
});
test('invalid and empty chunks fail closed', async () => {
  for (const bad of [new Uint8Array(0), [1], 'a']) {
    const a = adapter(); await assert.rejects(exportTransaction(a, async write => write(bad))); assert.equal(a.s.discarded, true);
  }
});
test('empty output never commits', async () => {
  const a = adapter(); await assert.rejects(exportTransaction(a, async () => {}), /Empty/); assert.equal(a.s.committed, false);
});
test('commit failure triggers discard', async () => {
  const a = adapter(); a.commit = async () => { throw Error('commit failed'); };
  await assert.rejects(exportTransaction(a, async write => write(Uint8Array.of(1))), /commit failed/);
  assert.equal(a.s.discarded, true);
});
test('cleanup failure is surfaced with original error', async () => {
  const a = adapter(); a.discard = async () => { throw Error('cleanup failed'); };
  await assert.rejects(exportTransaction(a, async write => { await write(Uint8Array.of(1)); throw Error('write failed'); }), AggregateError);
});
test('write failure discards and prevents publication', async () => {
  const a = adapter(); a.write = async () => { throw Error('disk full'); };
  await assert.rejects(exportTransaction(a, async write => write(Uint8Array.of(1))), /disk full/);
  assert.equal(a.s.visible, null); assert.equal(a.s.discarded, true);
});
