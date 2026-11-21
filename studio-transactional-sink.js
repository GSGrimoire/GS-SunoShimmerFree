// Local-first export transaction. Adapter staging must remain private; commit must publish atomically.
// Commit is the point of no return: abort is honored before commit starts, not during it.
export async function exportTransaction(adapter, produce, { signal } = {}) {
  if (!adapter || ['begin', 'write', 'commit', 'discard'].some(k => typeof adapter[k] !== 'function')) throw new TypeError('Invalid transactional sink adapter');
  if (typeof produce !== 'function') throw new TypeError('Invalid producer');
  if (signal?.aborted) throw new Error('Export cancelled');
  let started = false, closed = false, bytes = 0;
  let tail = Promise.resolve();
  const pending = new Set();
  let firstWriteError = null;
  try {
    started = true;
    await adapter.begin();
    if (signal?.aborted) throw new Error('Export cancelled');
    const rejectSink = error => {
      // A rejected write attempt invalidates the entire transaction even if
      // the producer catches or ignores its returned rejection.
      if (!firstWriteError) firstWriteError = error;
      const rejected = Promise.reject(error);
      rejected.catch(() => {}); // mark observed without hiding caller rejection
      return rejected;
    };
    const sink = chunk => {
      if (closed || signal?.aborted) return rejectSink(new Error('Export cancelled or closed'));
      if (!(chunk instanceof Uint8Array) || !chunk.byteLength) return rejectSink(new TypeError('Invalid export chunk'));
      // Copy before any asynchronous boundary, and serialize accepted writes in call order.
      const copy = new Uint8Array(chunk);
      const write = tail.then(async () => {
        if (signal?.aborted) throw new Error('Export cancelled');
        if (!Number.isSafeInteger(bytes + copy.byteLength)) throw new RangeError('Export size overflow');
        await adapter.write(copy);
        bytes += copy.byteLength;
      });
      tail = write.then(() => {}, () => {});
      pending.add(write);
      // Observe failures even when a producer neglects to await its sink call.
      write.catch(error => { if (!firstWriteError) firstWriteError = error; });
      write.finally(() => pending.delete(write)).catch(() => {});
      return write;
    };
    let producerError;
    try { await produce(sink); }
    catch (error) { producerError = error; }
    closed = true;
    await Promise.allSettled([...pending]);
    if (producerError) throw producerError;
    if (firstWriteError) throw firstWriteError;
    if (signal?.aborted) throw new Error('Export cancelled');
    if (bytes === 0) throw new Error('Empty export');
    // Point of no return. A later abort cannot revoke an atomic commit.
    const result = await adapter.commit();
    return { result, bytes };
  } catch (error) {
    closed = true;
    await Promise.allSettled([...pending]);
    if (started) {
      try { await adapter.discard(); }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Export failed and temporary data could not be discarded'); }
    }
    throw error;
  }
}
