/* Local-only, bounded source-byte SHA-256 verification. No network or decoding. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SunoStudioSourceBytes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DEFAULT_LIMIT = 32 * 1024 * 1024;
  function cancelled(signal) { if (signal?.aborted) throw new Error('Source verification cancelled'); }
  function nativeSize(blob) {
    // Native internal-slot access prevents a Blob subclass from forging bytes or size.
    if (typeof Blob === 'undefined') throw new TypeError('Native Blob unavailable');
    let size;
    try { size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get.call(blob); }
    catch { throw new TypeError('Expected a native local Blob'); }
    if (!Number.isSafeInteger(size)) throw new TypeError('Expected a native local Blob');
    return size;
  }
  async function verifySourceBytes(blob, expectedDigest, { signal, maxBytes = DEFAULT_LIMIT, cryptoProvider = globalThis.crypto } = {}) {
    const size = nativeSize(blob);
    if (typeof expectedDigest !== 'string' || !/^[0-9a-f]{64}$/i.test(expectedDigest)) throw new TypeError('Expected SHA-256 digest');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_LIMIT) throw new RangeError('Invalid source byte limit');
    if (size < 1 || size > maxBytes) throw new RangeError('Source exceeds bounded verification limit');
    if (!cryptoProvider?.subtle || typeof cryptoProvider.subtle.digest !== 'function') throw new Error('Local SHA-256 unavailable');
    cancelled(signal);
    // Read immutable native Blob storage, not an overridable instance method.
    // Never return the caller's object: its methods may be overridden.
    const buffer = await Blob.prototype.arrayBuffer.call(blob);
    try {
      cancelled(signal);
      if (buffer.byteLength !== size || buffer.byteLength > maxBytes) throw new Error('Source changed during read');
      const hash = await cryptoProvider.subtle.digest('SHA-256', buffer);
      cancelled(signal);
      const digest = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
      if (digest !== expectedDigest.toLowerCase()) throw new Error('Source SHA-256 mismatch');
      // Publish a fresh native Blob, never the caller's potentially overridden
      // subclass. Future consumers must read this verified snapshot only.
      const snapshot = new Blob([buffer], { type: '' });
      return Object.freeze({ blob: snapshot, digest, byteLength: buffer.byteLength });
    } finally {
      // The backing buffer becomes unreachable when this function returns.
      // Browser memory collection timing is outside this module's control.
    }
  }
  // Byte-only re-link boundary for portable manifest source records. No
  // decoder, render authorization, persistence, or metadata verification.
  // Validate and capture the entire selection before any asynchronous read.
  const MAX_MANIFEST_SOURCES = 128;
  function ownData(record, key) {
    const d = Object.getOwnPropertyDescriptor(record, key);
    if (!d || !Object.hasOwn(d, 'value')) throw new TypeError('Invalid manifest source record');
    return d.value;
  }
  async function verifyManifestSources(sources, selected, { signal, maxTotalBytes = DEFAULT_LIMIT } = {}) {
    cancelled(signal);
    if (!Array.isArray(sources) || sources.length < 1 || sources.length > MAX_MANIFEST_SOURCES)
      throw new RangeError('Invalid manifest source count');
    if (!Number.isSafeInteger(maxTotalBytes) || maxTotalBytes < 1 || maxTotalBytes > DEFAULT_LIMIT)
      throw new RangeError('Invalid manifest byte limit');
    let count;
    try { count = Object.getOwnPropertyDescriptor(Map.prototype, 'size').get.call(selected); }
    catch { throw new TypeError('Expected native source selection Map'); }
    if (count !== sources.length) throw new Error('Source selection count mismatch');
    const ids = new Set(), pending = [];
    let total = 0;
    for (let i = 0; i < sources.length; i++) {
      const record = ownData(sources, String(i));
      if (!record || typeof record !== 'object' || Array.isArray(record))
        throw new TypeError('Invalid manifest source record');
      const id = ownData(record, 'id'), digest = ownData(record, 'digest');
      if (typeof id !== 'string' || !id.length || id.length > 128 || /[\u0000-\u001f]/.test(id) || ids.has(id))
        throw new TypeError('Invalid or duplicate manifest source ID');
      if (typeof digest !== 'string' || !/^[0-9a-f]{64}$/i.test(digest))
        throw new TypeError('Expected manifest SHA-256 digest');
      ids.add(id);
      if (!Map.prototype.has.call(selected, id)) throw new Error('Missing selected source');
      const blob = Map.prototype.get.call(selected, id);
      const size = nativeSize(blob);
      if (size < 1 || size > maxTotalBytes - total)
        throw new RangeError('Manifest sources exceed aggregate byte limit');
      total += size;
      pending.push({ id, digest, blob, size });
    }
    const verified = [];
    for (const entry of pending) {
      cancelled(signal);
      const result = await verifySourceBytes(entry.blob, entry.digest, { signal, maxBytes: entry.size });
      verified.push(Object.freeze({ id: entry.id, ...result }));
    }
    cancelled(signal);
    // Publish only a complete set, in manifest order; callers must consume
    // the returned verified snapshots, not re-read the original selection.
    return Object.freeze(verified);
  }
  return Object.freeze({ verifySourceBytes, verifyManifestSources, DEFAULT_LIMIT, MAX_MANIFEST_SOURCES });
});
