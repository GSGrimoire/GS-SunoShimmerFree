/* Local-only immutable edit recipes; no audio bytes or browser state. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SunoStudioProject = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var VERSION = 1, MAX_TRACKS = 128, MAX_EDITS = 10000;
  function fail(message) { throw new TypeError('Studio project: ' + message); }
  function integer(value, label, min, max) {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail(label + ' must be a safe integer in range');
    return value;
  }
  function name(value, label) {
    if (typeof value !== 'string' || !value.length || value.length > 128 || /[\u0000-\u001f]/.test(value)) fail(label + ' is invalid');
    return value;
  }
  function unique(items, label) { if (new Set(items).size !== items.length) fail('duplicate ' + label); }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function freeze(value) {
    if (value && typeof value === 'object') {
      Object.keys(value).forEach(function (key) { freeze(value[key]); });
      Object.freeze(value);
    }
    return value;
  }
  function source(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid source');
    var s = {id: name(input.id, 'source id'), label: name(input.label, 'source label'),
      sampleRate: integer(input.sampleRate, 'sample rate', 8000, 384000),
      channels: integer(input.channels, 'channels', 1, 2),
      frames: integer(input.frames, 'source frames', 1, Number.MAX_SAFE_INTEGER)};
    if (input.digest !== undefined) {
      if (typeof input.digest !== 'string' || !/^[a-f0-9]{64}$/i.test(input.digest)) fail('digest must be a SHA-256 hex string');
      s.digest = input.digest.toLowerCase();
    }
    return s;
  }
  function track(input, sources) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid track');
    var t = {id: name(input.id, 'track id'), sourceId: name(input.sourceId, 'track source id'),
      startFrame: integer(input.startFrame, 'track start', 0, Number.MAX_SAFE_INTEGER),
      sourceStartFrame: integer(input.sourceStartFrame, 'source start', 0, Number.MAX_SAFE_INTEGER),
      frameCount: integer(input.frameCount, 'track duration', 1, Number.MAX_SAFE_INTEGER),
      gain: input.gain === undefined ? 1 : input.gain,
      muted: input.muted === undefined ? false : input.muted};
    if (typeof t.gain !== 'number' || !Number.isFinite(t.gain) || t.gain < 0 || t.gain > 4) fail('track gain out of range');
    if (typeof t.muted !== 'boolean') fail('track muted must be boolean');
    var s = sources.find(function (s) { return s.id === t.sourceId; });
    if (!s) fail('track source not found');
    if (!Number.isSafeInteger(t.sourceStartFrame + t.frameCount) || t.sourceStartFrame + t.frameCount > s.frames) fail('track exceeds source');
    if (!Number.isSafeInteger(t.startFrame + t.frameCount)) fail('track exceeds timeline');
    return t;
  }
  function edit(input, tracks) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid edit');
    var e = {id: name(input.id, 'edit id'), trackId: name(input.trackId, 'edit track id'),
      type: input.type, startFrame: integer(input.startFrame, 'edit start', 0, Number.MAX_SAFE_INTEGER),
      endFrame: integer(input.endFrame, 'edit end', 1, Number.MAX_SAFE_INTEGER)};
    if (!['gain', 'mute'].includes(e.type)) fail('unsupported edit type');
    if (e.endFrame <= e.startFrame) fail('edit must have positive duration');
    var t = tracks.find(function (t) { return t.id === e.trackId; });
    if (!t) fail('edit track not found');
    if (e.startFrame < t.startFrame || e.endFrame > t.startFrame + t.frameCount) fail('edit outside track');
    if (e.type === 'gain') {
      if (typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value < 0 || input.value > 4) fail('edit gain out of range');
      e.value = input.value;
    }
    return e;
  }
  function validate(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid manifest');
    if (input.schemaVersion !== VERSION) fail('unsupported schema version');
    var p = {schemaVersion: VERSION, sampleRate: integer(input.sampleRate, 'project sample rate', 8000, 384000),
      sources: [], tracks: [], edits: []};
    if (!Array.isArray(input.sources) || !Array.isArray(input.tracks) || !Array.isArray(input.edits)) fail('missing collections');
    if (input.sources.length > MAX_TRACKS || input.tracks.length > MAX_TRACKS || input.edits.length > MAX_EDITS) fail('collection limit exceeded');
    p.sources = input.sources.map(source);
    unique(p.sources.map(function (s) { return s.id; }), 'source id');
    p.tracks = input.tracks.map(function (t) { return track(t, p.sources); });
    unique(p.tracks.map(function (t) { return t.id; }), 'track id');
    p.edits = input.edits.map(function (e) { return edit(e, p.tracks); });
    unique(p.edits.map(function (e) { return e.id; }), 'edit id');
    // Reject unimplemented resampling rather than silently misaligning media.
    p.tracks.forEach(function (t) {
      var s = p.sources.find(function (s) { return s.id === t.sourceId; });
      if (s.sampleRate !== p.sampleRate) fail('resampling is required for source ' + s.id);
    });
    return freeze(p);
  }
  function empty(sampleRate) { return validate({schemaVersion: VERSION, sampleRate: sampleRate, sources: [], tracks: [], edits: []}); }
  function apply(project, operation) {
    var next = clone(validate(project));
    if (!operation || typeof operation !== 'object') fail('invalid operation');
    switch (operation.type) {
      case 'addSource': next.sources.push(operation.source); break;
      case 'addTrack': next.tracks.push(operation.track); break;
      case 'addEdit': next.edits.push(operation.edit); break;
      case 'removeEdit': {
        var id = name(operation.id, 'edit id');
        var index = next.edits.findIndex(function (e) { return e.id === id; });
        if (index === -1) fail('edit not found');
        next.edits.splice(index, 1); break;
      }
      case 'setTrack': {
        var trackId = name(operation.id, 'track id');
        var index2 = next.tracks.findIndex(function (t) { return t.id === trackId; });
        if (index2 === -1) fail('track not found');
        if (!['gain', 'muted'].includes(operation.field)) fail('unsupported track property');
        next.tracks[index2][operation.field] = operation.value;
        break;
      }
      default: fail('unsupported operation');
    }
    return validate(next);
  }
  // This is a reference evaluator, not a per-sample real-time render callback.
  function gainAt(project, trackId, frame) {
    var p = validate(project), t = p.tracks.find(function (t) { return t.id === trackId; });
    if (!t) fail('track not found');
    integer(frame, 'frame', 0, Number.MAX_SAFE_INTEGER);
    if (frame < t.startFrame || frame >= t.startFrame + t.frameCount || t.muted) return 0;
    var gain = t.gain;
    p.edits.forEach(function (e) {
      if (e.trackId === trackId && e.startFrame <= frame && frame < e.endFrame) {
        if (e.type === 'mute') gain = 0;
        else if (gain !== 0) gain *= e.value;
      }
    });
    return gain;
  }
  return freeze({VERSION: VERSION, empty: empty, validate: validate, apply: apply, gainAt: gainAt});
});
