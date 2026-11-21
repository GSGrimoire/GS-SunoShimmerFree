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
  async function verifySourceBytes(blob, expectedDigest, { signal, maxBytes = DEFAULT_LIMIT, cryptoProvider = globalThis.crypto } = {}) {
    // Native internal-slot access prevents a Blob subclass from forging bytes or size.
    if (typeof Blob === 'undefined') throw new TypeError('Native Blob unavailable');
    let size;
    try { size = Object.getOwnPropertyDescriptor(Blob.prototype, 'size').get.call(blob); }
    catch { throw new TypeError('Expected a native local Blob'); }
    if (!Number.isSafeInteger(size)) throw new TypeError('Expected a native local Blob');
    if (typeof expectedDigest !== 'string' || !/^[0-9a-f]{64}$/i.test(expectedDigest)) throw new TypeError('Expected SHA-256 digest');
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_LIMIT) throw new RangeError('Invalid source byte limit');
    if (size < 1 || size > maxBytes) throw new RangeError('Source exceeds bounded verification limit');
    if (!cryptoProvider?.subtle || typeof cryptoProvider.subtle.digest !== 'function') throw new Error('Local SHA-256 unavailable');
    cancelled(signal);
    // Read immutable native Blob storage, not an overridable instance method.
    // The caller must decode this exact Blob through trusted native methods.
    const buffer = await Blob.prototype.arrayBuffer.call(blob);
    try {
      cancelled(signal);
      if (buffer.byteLength !== size || buffer.byteLength > maxBytes) throw new Error('Source changed during read');
      const hash = await cryptoProvider.subtle.digest('SHA-256', buffer);
      cancelled(signal);
      const digest = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
      if (digest !== expectedDigest.toLowerCase()) throw new Error('Source SHA-256 mismatch');
      return Object.freeze({ blob, digest, byteLength: buffer.byteLength });
    } finally {
      // The backing buffer becomes unreachable when this function returns.
      // Browser memory collection timing is outside this module's control.
    }
  }
  return Object.freeze({ verifySourceBytes, DEFAULT_LIMIT });
});
