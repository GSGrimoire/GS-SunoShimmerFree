'use strict';
// Conservative four-entrypoint source heuristic, not a JavaScript parser or
// runtime telemetry audit. Flags direct console member calls (identifier or
// simple quoted literal, including optional chaining) and the debugger token.
// Comments, strings and non-global console objects can cause false positives;
// aliases, computed/escaped names and other indirect forms can be missed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const entrypoints = ['app.js', 'engine.js', 'edit.js', 'index.html'];

function detectDebugSurfaces(source) {
  const rules = [
    { name: 'console-call', re: /\bconsole\s*(?:(?:\.|\?\.)\s*[$\w]+|(?:\?\.\s*)?\[\s*(?:"[^"\\\r\n]*"|'[^'\\\r\n]*')\s*\])\s*(?:\?\.\s*)?\(/g },
    { name: 'debugger-statement', re: /\bdebugger\b/g }
  ];
  return rules.flatMap(({name, re}) => [...source.matchAll(re)].map(m => ({name, offset:m.index})));
}

const cases = [
  ['dot log', 'console.log(privateAudio);', 'console-call'],
  ['bracket error', "console['error'](filename);", 'console-call'],
  ['assert', 'console.assert(false, filename);', 'console-call'],
  ['group', 'console.group(filename);', 'console-call'],
  ['group collapsed', 'console.groupCollapsed(filename);', 'console-call'],
  ['group end', 'console.groupEnd();', 'console-call'],
  ['count', 'console.count(filename);', 'console-call'],
  ['bracket assert', 'console["assert"](false, filename);', 'console-call'],
  ['optional receiver', 'console?.log(filename);', 'console-call'],
  ['optional member call', 'console.log?.(filename);', 'console-call'],
  ['optional bracket receiver', 'console?.["assert"](false, filename);', 'console-call'],
  ['optional bracket call', "console['count']?.(filename);", 'console-call'],
  ['both optional', 'console?.group?.(filename);', 'console-call'],
  ['timer label', 'console.time(filename);', 'console-call'],
  ['explicit debugger', 'debugger;', 'debugger-statement'],
  ['newline debugger', 'function f(filename) {\n  debugger\n  return filename;\n}', 'debugger-statement'],
  ['closing brace debugger', 'function f() { debugger }', 'debugger-statement'],
  ['end of source debugger', 'debugger', 'debugger-statement'],
  ['comment after debugger', 'debugger /* note */\nconst x = 1;', 'debugger-statement']
];
for (const [label, sample, rule] of cases) {
  test('detector flags ' + label + ' without leaking arguments', () => {
    const offset = sample.indexOf(rule === 'console-call' ? 'console' : 'debugger');
    assert.deepEqual(detectDebugSurfaces(sample), [{name: rule, offset}]);
  });
}

test('detector accepts in-memory operations and non-call console member references', () => {
  for (const sample of [
    'const x = Math.max(1, 2);',
    'const length = filename.length; const copy = privateAudio.slice();',
    'const debuggerEnabled = false; const consoleMode = "quiet";',
    'const supported = typeof console.log === "function";',
    'const x = other.log(filename);'
  ]) assert.deepEqual(detectDebugSurfaces(sample), []);
});

test('production entrypoints contain no direct console calls or debugger tokens', () => {
  const violations = [];
  for (const file of entrypoints) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const finding of detectDebugSurfaces(source)) violations.push(file + ':' + finding.name + '@' + finding.offset);
  }
  assert.deepEqual(violations, [], 'Review possible sensitive logging: ' + violations.join(', '));
});
