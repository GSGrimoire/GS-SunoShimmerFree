'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ENTRYPOINTS = ['index.html', 'app.js', 'engine.js', 'edit.js'];
// This is a conservative source regression guard, not a JavaScript parser or runtime proof.
const RULES = Object.freeze([
  ['web-storage', /\b(?:localStorage|sessionStorage)\b|\b(?:window|globalThis)\s*\[\s*['"](?:localStorage|sessionStorage)['"]\s*\]/gi],
  ['indexed-db', /\bindexedDB\b|\bIDB(?:Database|Transaction|ObjectStore|Factory)\b/gi],
  ['cache-storage', /\bcaches\s*\.\s*(?:open|put|match|keys|delete)\s*\(|\b(?:window|globalThis)\s*\.\s*caches\b/gi],
  ['service-worker', /\bserviceWorker\s*\.\s*register\s*\(/gi],
  ['file-system-persistence', /\b(?:showSaveFilePicker|showDirectoryPicker|requestFileSystem|webkitRequestFileSystem)\s*\(/gi],
  ['cookie-write', /\bdocument\s*\.\s*cookie\s*=/gi]
]);
function findings(source) {
  const found = [];
  for (const [rule, pattern] of RULES) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) found.push({ rule, offset: match.index });
  }
  return found;
}
test('production entrypoints contain no implicit browser persistence APIs', () => {
  for (const file of ENTRYPOINTS) {
    const content = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
    const matches = findings(content);
    assert.deepEqual(matches, [], file + ': persistence API findings (rule/offset only): ' + JSON.stringify(matches));
  }
});
test('detects representative persistent browser storage APIs', () => {
  for (const sample of [
    'localStorage.setItem("song", audio)', 'sessionStorage["track"] = x',
    'indexedDB.open("tracks")', 'caches.open("audio")',
    'navigator.serviceWorker.register("/sw.js")',
    'showSaveFilePicker()', 'document.cookie = "session=x"'
  ]) assert.ok(findings(sample).length > 0, 'missed synthetic storage sample');
});
test('allows transient in-memory data and explicit download preparation', () => {
  for (const sample of [
    'const audio = new Uint8Array(10);',
    'const objectUrl = URL.createObjectURL(new Blob([audio]));',
    'const buffer = await file.arrayBuffer();',
    'const cache = new Map();'
  ]) assert.deepEqual(findings(sample), []);
});
test('reports no captured content or values in findings', () => {
  const result = findings('localStorage.setItem("private-track", secretAudio)');
  assert.deepEqual(result, [{ rule: 'web-storage', offset: 0 }]);
  assert.equal(JSON.stringify(result).includes('private-track'), false);
});
