/* Local bounded ZIP reader for Suno stem archives. No network or dependencies.
 * Single-disk ZIP32 and ZIP64; stored and raw-DEFLATE entries. Never materializes the ZIP.
 * Rejects traversal, symlinks, encryption, unsupported methods, bombs and corrupt CRCs.
 */
(function(root) {
  'use strict';
  var MAX_ARCHIVE = 1024 * 1024 * 1024;
  var MAX_ENTRY = 160 * 1024 * 1024;
  var MAX_TOTAL = 1024 * 1024 * 1024;
  var MAX_ENTRIES = 256;
  var MAX_DIRECTORY = 4 * 1024 * 1024;
  var MAX_RATIO = 250;
  var END_BYTES = 22, ZIP64_LOCATOR_BYTES = 20, ZIP64_END_BYTES = 56;
  var MAX_U16 = 0xffff, MAX_U32 = 0xffffffff;
  var SPLIT_ARCHIVE = 'split archives (multiple disks) are unsupported. Please provide one complete .zip file.';
  var cp437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´≡±‗¾¶§÷¸°¨·¹³²■ ';
  var crcTable = new Uint32Array(256);
  for (var i = 0; i < 256; i++) {
    var c = i;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    crcTable[i] = c >>> 0;
  }
  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function nameOf(bytes, utf) {
    if (utf) return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
    catch (_) {
      var s = '';
      for (var j = 0; j < bytes.length; j++)
        s += bytes[j] < 128 ? String.fromCharCode(bytes[j]) : cp437[bytes[j] - 128];
      return s;
    }
  }
  function ensure(cond, message) { if (!cond) throw new Error('ZIP: ' + message); }
  function validatePath(path) {
    ensure(path && !path.includes('\0') && !path.includes('\\'), 'unsafe entry filename');
    ensure(!path.startsWith('/') && !/^[a-zA-Z]:/.test(path), 'absolute entry path');
    var parts = path.split('/');
    ensure(parts.every(function(p) { return p !== '..' && p !== '.'; }), 'unsafe parent-directory path');
    ensure(parts.every(function(p) { return p.length <= 255; }), 'entry filename too long');
  }
  function boundedUint64(view, offset) {
    // Every supported count, size and offset fits in 32 bits under our caps.
    ensure(view.getUint32(offset + 4, true) === 0, 'ZIP64 value exceeds the supported limits');
    return view.getUint32(offset, true);
  }
  function checkSingleDisk(disk, dirDisk, onDisk, count) {
    ensure(disk === 0 && dirDisk === 0 && onDisk === count, SPLIT_ARCHIVE);
  }
  async function readZip64End(file, tail, tailStart, locator) {
    ensure(locator >= 0 && tail.getUint32(locator, true) === 0x07064b50,
      'missing ZIP64 end-of-directory locator');
    ensure(tail.getUint32(locator + 4, true) === 0 && tail.getUint32(locator + 16, true) === 1,
      SPLIT_ARCHIVE);
    var locatorOffset = tailStart + locator;
    var recordOffset = boundedUint64(tail, locator + 8);
    ensure(recordOffset <= locatorOffset - ZIP64_END_BYTES, 'invalid ZIP64 end-of-directory offset');
    var record = recordOffset >= tailStart
      ? new DataView(tail.buffer, recordOffset - tailStart, ZIP64_END_BYTES)
      : new DataView(await file.slice(recordOffset, recordOffset + ZIP64_END_BYTES).arrayBuffer());
    ensure(record.byteLength === ZIP64_END_BYTES && record.getUint32(0, true) === 0x06064b50,
      'invalid ZIP64 end-of-directory signature');
    ensure(boundedUint64(record, 4) + 12 === locatorOffset - recordOffset,
      'inconsistent ZIP64 end-of-directory length');
    var onDisk = boundedUint64(record, 24), count = boundedUint64(record, 32);
    checkSingleDisk(record.getUint32(16, true), record.getUint32(20, true), onDisk, count);
    return {count: count, size: boundedUint64(record, 40), start: boundedUint64(record, 48), end: recordOffset};
  }
  async function findDirectory(file) {
    var tailStart = Math.max(0, file.size - (MAX_U16 + END_BYTES + ZIP64_LOCATOR_BYTES + ZIP64_END_BYTES));
    var tail = new DataView(await file.slice(tailStart).arrayBuffer()), error;
    // A ZIP comment can contain a record-shaped signature ending at EOF.
    // Continue scanning when a candidate fails the disk or directory checks.
    for (var p = tail.byteLength - END_BYTES; p >= 0; p--) {
      if (tail.getUint32(p, true) !== 0x06054b50 ||
          p + END_BYTES + tail.getUint16(p + 20, true) !== tail.byteLength) continue;
      var disk = tail.getUint16(p + 4, true), dirDisk = tail.getUint16(p + 6, true);
      var onDisk = tail.getUint16(p + 8, true), count = tail.getUint16(p + 10, true);
      var size = tail.getUint32(p + 12, true), start = tail.getUint32(p + 16, true);
      var end = tailStart + p, locator = p - ZIP64_LOCATOR_BYTES;
      var needsZip64 = disk === MAX_U16 || dirDisk === MAX_U16 || onDisk === MAX_U16 ||
        count === MAX_U16 || size === MAX_U32 || start === MAX_U32;
      var hasLocator = locator >= 0 && start + size <= tailStart + locator &&
        tail.getUint32(locator, true) === 0x07064b50;
      try {
        if (needsZip64 || hasLocator) {
          ensure((disk === 0 || disk === MAX_U16) && (dirDisk === 0 || dirDisk === MAX_U16), SPLIT_ARCHIVE);
          var wide = await readZip64End(file, tail, tailStart, locator);
          ensure((onDisk === MAX_U16 || onDisk === wide.count) && (count === MAX_U16 || count === wide.count) &&
            (size === MAX_U32 || size === wide.size) && (start === MAX_U32 || start === wide.start),
            'ZIP64 and legacy end-of-directory records disagree');
          count = wide.count; size = wide.size; start = wide.start; end = wide.end;
        } else {
          checkSingleDisk(disk, dirDisk, onDisk, count);
        }
        ensure(count > 0 && count <= MAX_ENTRIES, 'empty directory or too many entries');
        ensure(size >= count * 46 && size <= MAX_DIRECTORY && start + size <= end,
          'invalid central-directory bounds');
        return {count: count, size: size, start: start};
      } catch (err) { error = err; }
    }
    if (error) throw error;
    throw new Error('ZIP: no valid end-of-directory record');
  }
  function zip64Extra(view, offset, length, expected) {
    var end = offset + length, field = -1;
    while (offset < end) {
      ensure(offset + 4 <= end, 'truncated ZIP extra field header');
      var id = view.getUint16(offset, true), size = view.getUint16(offset + 2, true);
      offset += 4;
      ensure(offset + size <= end, 'truncated ZIP extra field');
      if (id === 1) {
        ensure(field < 0 && size === expected, 'invalid ZIP64 entry extra field');
        field = offset;
      }
      offset += size;
    }
    ensure(field >= 0, 'missing ZIP64 entry extra field');
    return field;
  }
  async function open(file) {
    ensure(file && Number.isSafeInteger(file.size) && file.size >= END_BYTES && file.size <= MAX_ARCHIVE,
      'archive is empty or exceeds the 1 GiB cap');
    var info = await findDirectory(file);
    var count = info.count, size = info.size, start = info.start;
    var directory = await file.slice(start, start + size).arrayBuffer();
    var view = new DataView(directory), data = new Uint8Array(directory), offset = 0;
    var entries = [], names = new Set(), total = 0;
    for (var index = 0; index < count; index++) {
      ensure(offset + 46 <= size && view.getUint32(offset, true) === 0x02014b50,
        'invalid central-directory header');
      var flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true);
      var crc = view.getUint32(offset + 16, true);
      var compressed = view.getUint32(offset + 20, true), plain = view.getUint32(offset + 24, true);
      var nameLen = view.getUint16(offset + 28, true), extraLen = view.getUint16(offset + 30, true),
        commentLen = view.getUint16(offset + 32, true);
      var disk = view.getUint16(offset + 34, true), location = view.getUint32(offset + 42, true);
      var os = view.getUint8(offset + 5), attributes = view.getUint32(offset + 38, true);
      ensure(offset + 46 + nameLen + extraLen + commentLen <= size, 'truncated directory entry');
      ensure(!(flags & 1) && !(flags & 64), 'encrypted entries are unsupported');
      ensure(method === 0 || method === 8, 'unsupported compression method');
      var wideSize = (plain === MAX_U32 ? 8 : 0) + (compressed === MAX_U32 ? 8 : 0) +
        (location === MAX_U32 ? 8 : 0) + (disk === MAX_U16 ? 4 : 0);
      if (wideSize) {
        // Central-directory ZIP64 replacements appear in this order and omit
        // fields that already fit in their legacy slots (PKWARE APPNOTE 4.5.3).
        var field = zip64Extra(view, offset + 46 + nameLen, extraLen, wideSize);
        if (plain === MAX_U32) { plain = boundedUint64(view, field); field += 8; }
        if (compressed === MAX_U32) { compressed = boundedUint64(view, field); field += 8; }
        if (location === MAX_U32) { location = boundedUint64(view, field); field += 8; }
        if (disk === MAX_U16) disk = view.getUint32(field, true);
      }
      ensure(disk === 0, SPLIT_ARCHIVE);
      ensure(plain <= MAX_ENTRY, 'entry exceeds the 160 MiB limit');
      ensure(method !== 0 || plain === compressed, 'stored entry size mismatch');
      ensure(plain === 0 || (compressed > 0 && plain / compressed <= MAX_RATIO),
        'unsafe compression ratio');
      total += plain;
      ensure(total <= MAX_TOTAL, 'uncompressed entries exceed the 1 GiB limit');
      var raw = data.subarray(offset + 46, offset + 46 + nameLen);
      var name = nameOf(raw, !!(flags & 2048));
      validatePath(name);
      ensure(!names.has(name), 'duplicate entry path');
      names.add(name);
      var mode = attributes >>> 16;
      ensure(!(os === 3 && (mode & 0xf000) === 0xa000), 'symbolic links are unsafe');
      ensure(location + 30 <= start, 'local entry overlaps the directory');
      if (!name.endsWith('/')) entries.push({
        name: name, method: method, compressed: compressed, size: plain,
        crc: crc, offset: location, flags: flags, rawName: new Uint8Array(raw)
      });
      offset += 46 + nameLen + extraLen + commentLen;
    }
    ensure(offset === size, 'unexpected central-directory bytes');
    var groups = new Map();
    entries.forEach(function(entry) {
      var m = entry.name.match(/\.(wav|mp3)$/i);
      if (!m) return;
      var key = entry.name.slice(0, -m[0].length);
      var normalized = key.toLocaleLowerCase();
      var stem = groups.get(normalized);
      if (!stem) {
        var base = key.split('/').pop();
        var parsed = base.match(/\(([^()]*)\)\s*$/);
        stem = { key: key, name: parsed ? parsed[1] : base, wav: null, mp3: null,
          enabled: true, mute: false, solo: false, volume: 0, clean: false, polish: false,
          clarity: 20, presence: 20, dynamics: 0, target: 'off' };
        groups.set(normalized, stem);
      }
      var fmt = m[1].toLowerCase();
      ensure(!stem[fmt], 'duplicate stem format: ' + entry.name);
      stem[fmt] = entry;
    });
    var stems = Array.from(groups.values());
    ensure(stems.length > 0, 'no WAV or MP3 stems found');
    stems.forEach(function(s) {
      s.entry = s.wav || s.mp3; s.format = s.wav ? 'WAV' : 'MP3';
    });
    var spans = [];
    async function extract(entry, signal) {
      ensure(entries.indexOf(entry) >= 0, 'unknown entry');
      function active() { ensure(!signal || !signal.aborted, 'extraction cancelled'); }
      active();
      var header = await file.slice(entry.offset, entry.offset + 30).arrayBuffer();
      active();
      ensure(header.byteLength === 30, 'truncated local header');
      var h = new DataView(header);
      ensure(h.getUint32(0, true) === 0x04034b50, 'bad local header');
      ensure(!(h.getUint16(6, true) & (1 | 64)) && h.getUint16(8, true) === entry.method, 'local header differs');
      var nameLength = h.getUint16(26, true), extraLength = h.getUint16(28, true);
      ensure(nameLength === entry.rawName.length, 'local name length differs');
      var pathBytes = new Uint8Array(await file.slice(entry.offset + 30, entry.offset + 30 + nameLength).arrayBuffer());
      active();
      ensure(pathBytes.every(function(b,i) { return b === entry.rawName[i]; }), 'local name differs');
      var from = entry.offset + 30 + nameLength + extraLength, end = from + entry.compressed;
      ensure(end <= start, 'compressed entry overlaps directory');
      if (entry.method === 8) {
        ensure(typeof DecompressionStream !== 'undefined', 'browser lacks raw DEFLATE support');
      }
      var stream = file.slice(from, end).stream();
      if (entry.method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
      var reader = stream.getReader(), result = new Uint8Array(entry.size), written = 0;
      var onAbort = function() { reader.cancel('Extraction cancelled').catch(function(){}); };
      if (signal) signal.addEventListener('abort', onAbort, {once:true});
      try {
        active();
        while (true) {
          active();
          var next = await reader.read();
          active();
          if (next.done) break;
          ensure(written + next.value.length <= entry.size, 'entry expands beyond declared size');
          result.set(next.value, written); written += next.value.length;
        }
      } finally {
        if (signal) signal.removeEventListener('abort', onAbort);
        reader.releaseLock();
      }
      active();
      ensure(written === entry.size, 'uncompressed length mismatch');
      ensure(crc32(result) === entry.crc, 'CRC mismatch: ' + entry.name);
      return result.buffer;
    }
    // Audit all payload ranges before any extraction.
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i], header = new DataView(await file.slice(e.offset, e.offset + 30).arrayBuffer());
      ensure(header.byteLength === 30 && header.getUint32(0, true) === 0x04034b50,
        'invalid local file header');
      var from = e.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
      spans.push({start: e.offset, end: from + e.compressed});
      ensure(from + e.compressed <= start, 'overlapping central directory');
    }
    spans.sort(function(a,b) { return a.start - b.start; });
    for (var j = 1; j < spans.length; j++)
      ensure(spans[j].start >= spans[j-1].end, 'overlapping ZIP entries');
    return { stems: stems, entries: entries, extract: extract, file: file,
      totalBytes: total, compressedBytes: file.size };
  }
  var api = { open: open, crc32: crc32, MAX_ENTRY: MAX_ENTRY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SunoStemZip = api;
})(typeof self !== 'undefined' ? self : this);
