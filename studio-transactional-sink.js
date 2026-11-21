// Local-first export transaction: only a complete stream may become visible.
// Adapter must provide begin(), write(), commit(), discard(). commit() must publish
// atomically, and discard() must remove any temporary or failed publication.
export async function exportTransaction(adapter, produce, { signal } = {}) {
  if (!adapter || ['begin', 'write', 'commit', 'discard'].some(k => typeof adapter[k] !== 'function')) throw new TypeError('Invalid transactional sink adapter');
  if (typeof produce !== 'function') throw new TypeError('Invalid producer');
  if (signal?.aborted) throw new Error('Export cancelled');
  let started = false;
  let finished = false;
  let bytes = 0;
  try {
    started = true;
    await adapter.begin();
    const sink = async chunk => {
      if (finished || signal?.aborted) throw new Error('Export cancelled or closed');
      if (!(chunk instanceof Uint8Array) || !chunk.byteLength) throw new TypeError('Invalid export chunk');
      if (!Number.isSafeInteger(bytes + chunk.byteLength)) throw new RangeError('Export size overflow');
      // Copy before awaiting: producer cannot mutate bytes while the sink persists them.
      await adapter.write(new Uint8Array(chunk));
      bytes += chunk.byteLength;
    };
    await produce(sink);
    if (signal?.aborted) throw new Error('Export cancelled');
    if (bytes === 0) throw new Error('Empty export');
    finished = true;
    const result = await adapter.commit();
    return { result, bytes };
  } catch (error) {
    finished = true;
    if (started) {
      try { await adapter.discard(); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Export failed and temporary data could not be discarded'); }
    }
    throw error;
  }
}
