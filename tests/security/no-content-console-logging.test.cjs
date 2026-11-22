'use strict';
// Static, conservative guard: never log user audio, filenames, or project state
// through console calls in the current browser production entrypoints.
// This is not a full JavaScript parser or runtime telemetry audit.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const entrypoints = ['app.js', 'engine.js', 'edit.js', 'index.html'];

function detectDebugSurfaces(source) {
  const rules = [
    { name: 'console-call', re: /\bconsole\s*(?:\.\s*(?:log|debug|info|warn|error|trace|dir|table)|\[\s*['"](?:log|debug|info|warn|error|trace|dir|table)['"]\s*\])\s*\(/g },
    { name: 'debugger-statement', re: /\bdebugger\s*;/g }
  ];
  return rules.flatMap(({name, re}) => [...source.matchAll(re)].map(m => ({name, offset:m.index})));
}

test('detector flags direct and bracket console calls without leaking arguments', () => {
  const sample = "console.log(privateAudio); console['error'](filename); debugger;";
  assert.deepEqual(detectDebugSurfaces(sample).map(x => x.name), ['console-call', 'console-call', 'debugger-statement']);
  assert.ok(detectDebugSurfaces(sample).every(x => !Object.hasOwn(x, 'value')));
});

test('detector accepts code without console/debugger output', () => {
  assert.deepEqual(detectDebugSurfaces('const x = Math.max(1, 2);'), []);
});

test('production entrypoints contain no direct console calls or debugger statements', () => {
  const violations = [];
  for (const file of entrypoints) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const finding of detectDebugSurfaces(source)) violations.push(file + ':' + finding.name + '@' + finding.offset);
  }
  assert.deepEqual(violations, [], 'Review possible sensitive logging: ' + violations.join(', '));
});
