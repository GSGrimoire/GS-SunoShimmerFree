// Local-only decoded-audio memory admission. Does not allocate or decode audio.
export function createMemoryAdmission({ limitBytes, maxReservations = 10 }) {
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0 || !Number.isSafeInteger(maxReservations) || maxReservations < 1 || maxReservations > 100)
    throw new RangeError('Invalid memory admission limits');
  const reservations = new Map();
  let usedBytes = 0;
  let generation = 0;
  function reserve(id, bytes, token = generation) {
    if (typeof id !== 'string' || !id || id.length > 128 || !Number.isSafeInteger(bytes) || bytes <= 0)
      throw new TypeError('Invalid reservation');
    if (token !== generation) throw new Error('Stale admission generation');
    if (reservations.has(id)) throw new Error('Duplicate reservation');
    if (reservations.size >= maxReservations || bytes > limitBytes - usedBytes)
      throw new RangeError('Memory budget exceeded');
    reservations.set(id, bytes);
    usedBytes += bytes;
    let released = false;
    return Object.freeze({
      id,
      generation: token,
      release() {
        if (released) return false;
        released = true;
        if (token !== generation || reservations.get(id) !== bytes) return false;
        reservations.delete(id);
        usedBytes -= bytes;
        return true;
      }
    });
  }
  return Object.freeze({
    reserve,
    snapshot: () => Object.freeze({ usedBytes, availableBytes: limitBytes - usedBytes, count: reservations.size, generation }),
    reset() { reservations.clear(); usedBytes = 0; generation++; return generation; }
  });
}

export function decodedPcmBytes({ frames, channels, bytesPerSample = 4, copies = 1 }) {
  for (const n of [frames, channels, bytesPerSample, copies])
    if (!Number.isSafeInteger(n) || n <= 0) throw new RangeError('Invalid decoded audio dimensions');
  let total = 1;
  for (const n of [frames, channels, bytesPerSample, copies]) {
    if (total > Number.MAX_SAFE_INTEGER / n) throw new RangeError('Decoded audio size overflow');
    total *= n;
  }
  return total;
}
