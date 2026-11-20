/* Fail-closed local source identity gate for a future studio renderer. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SunoStudioSourceIdentity = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function fail(message) { throw new TypeError('Studio source identity: ' + message); }
  function safeInt(value, min) { return Number.isSafeInteger(value) && value >= min; }
  function hex(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value); }
  function verifySource(expected, actual) {
    if (!expected || typeof expected !== 'object' || !actual || typeof actual !== 'object') fail('missing source metadata');
    if (!hex(expected.digest)) fail('source fingerprint required before render');
    if (!hex(actual.digest)) fail('actual source fingerprint unavailable');
    if (!safeInt(expected.frames, 1) || !safeInt(actual.frames, 1) || expected.frames !== actual.frames) fail('decoded frame count mismatch');
    if (!safeInt(expected.sampleRate, 8000) || !safeInt(actual.sampleRate, 8000) || expected.sampleRate !== actual.sampleRate) fail('sample rate mismatch');
    if (![1, 2].includes(expected.channels) || expected.channels !== actual.channels) fail('channel count mismatch');
    if (expected.digest.toLowerCase() !== actual.digest.toLowerCase()) fail('source fingerprint mismatch');
    return true;
  }
  function verifyProject(project, resolved) {
    if (!project || !Array.isArray(project.sources) || !Array.isArray(project.tracks)) fail('invalid project');
    if (!(resolved instanceof Map)) fail('resolved sources must be a Map');
    if (resolved.size !== project.sources.length) fail('resolved source count mismatch');
    const ids = new Set();
    for (const source of project.sources) {
      if (!source || typeof source.id !== 'string' || !source.id || ids.has(source.id)) fail('invalid or duplicate source id');
      ids.add(source.id);
      if (!resolved.has(source.id)) fail('missing resolved source');
      verifySource(source, resolved.get(source.id));
    }
    for (const track of project.tracks) {
      if (!track || !ids.has(track.sourceId)) fail('track references missing source');
    }
    return true;
  }
  return Object.freeze({verifySource, verifyProject});
});
