/* Local bounded ZIP reader for Suno stem archives. No network or dependencies.
 * Single-disk ZIP32; stored and raw-DEFLATE entries. Never materializes the ZIP.
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
  async function open(file) {
    ensure(file && Number.isSafeInteger(file.size) && file.size >= 22 && file.size <= MAX_ARCHIVE,
      'archive is empty or exceeds the 1 GiB cap');
    var tailStart = Math.max(0, file.size - 65557);
    var tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
    var dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength), pos = -1;
    var sawMultiVolume = false, candidates = 0;
    // An archive comment may itself contain the EOCD signature (including a
    // complete decoy record ending at EOF). Test the disk fields and directory
    // bounds before accepting a candidate, rather than misreporting a valid
    // single-volume ZIP as a split archive.
    for (var p = tail.length - 22; p >= 0; p--) {
      if (dv.getUint32(p, true) !== 0x06054b50 ||
          p + 22 + dv.getUint16(p + 20, true) !== tail.length) continue;
      candidates++;
      var disk = dv.getUint16(p + 4, true), dirDisk = dv.getUint16(p + 6, true);
      var localCount = dv.getUint16(p + 8, true), allCount = dv.getUint16(p + 10, true);
      var dirSize = dv.getUint32(p + 12, true), dirStart = dv.getUint32(p + 16, true);
      if (disk !== 0 || dirDisk !== 0 || localCount !== allCount) {
        sawMultiVolume = true;
        continue;
      }
      if (!allCount || allCount === 0xffff || dirStart === 0xffffffff ||
          dirSize === 0xffffffff || dirStart + dirSize > tailStart + p ||
          dirSize < allCount * 46 || dirSize > MAX_DIRECTORY) continue;
      pos = p;
      break;
    }
    if (pos < 0 && sawMultiVolume) {
      throw new Error('ZIP: end-of-directory suggests a split archive (multiple disks). ' +
        'Please provide one complete .zip file; the original exporter may need to combine its volumes.');
    }
    ensure(pos >= 0,
      candidates ? 'end-of-directory metadata is inconsistent or unsupported' :
        'no valid end-of-directory record');
    var count = dv.getUint16(pos + 10, true), onDisk = dv.getUint16(pos + 8, true);
    var size = dv.getUint32(pos + 12, true), start = dv.getUint32(pos + 16, true);
    ensure(count === onDisk && count <= MAX_ENTRIES && count !== 0xffff,
      'too many entries or unsupported ZIP64 archive');
    ensure(size <= MAX_DIRECTORY && start !== 0xffffffff && size !== 0xffffffff &&
      start + size <= tailStart + pos, 'invalid central-directory bounds');
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
      var location = view.getUint32(offset + 42, true);
      var os = view.getUint8(offset + 5), attributes = view.getUint32(offset + 38, true);
      ensure(offset + 46 + nameLen + extraLen + commentLen <= size, 'truncated directory entry');
      ensure(!(flags & 1) && !(flags & 64), 'encrypted entries are unsupported');
      ensure(method === 0 || method === 8, 'unsupported compression method');
      ensure(compressed !== 0xffffffff && plain !== 0xffffffff && location !== 0xffffffff,
        'ZIP64 entries are unsupported');
      ensure(plain <= MAX_ENTRY, 'entry exceeds the 160 MiB limit');
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
    async function extract(entry) {
      ensure(entries.indexOf(entry) >= 0, 'unknown entry');
      var header = await file.slice(entry.offset, entry.offset + 30).arrayBuffer();
      ensure(header.byteLength === 30, 'truncated local header');
      var h = new DataView(header);
      ensure(h.getUint32(0, true) === 0x04034b50, 'bad local header');
      ensure(!(h.getUint16(6, true) & 1) && h.getUint16(8, true) === entry.method, 'local header differs');
      var nameLength = h.getUint16(26, true), extraLength = h.getUint16(28, true);
      ensure(nameLength === entry.rawName.length, 'local name length differs');
      var pathBytes = new Uint8Array(await file.slice(entry.offset + 30, entry.offset + 30 + nameLength).arrayBuffer());
      ensure(pathBytes.every(function(b,i) { return b === entry.rawName[i]; }), 'local name differs');
      var from = entry.offset + 30 + nameLength + extraLength, end = from + entry.compressed;
      ensure(end <= start, 'compressed entry overlaps directory');
      if (entry.method === 8) {
        ensure(typeof DecompressionStream !== 'undefined', 'browser lacks raw DEFLATE support');
      }
      var stream = file.slice(from, end).stream();
      if (entry.method === 8) stream = stream.pipeThrough(new DecompressionStream('deflate-raw'));
      var reader = stream.getReader(), result = new Uint8Array(entry.size), written = 0;
      try {
        while (true) {
          var next = await reader.read();
          if (next.done) break;
          ensure(written + next.value.length <= entry.size, 'entry expands beyond declared size');
          result.set(next.value, written); written += next.value.length;
        }
      } finally { reader.releaseLock(); }
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
