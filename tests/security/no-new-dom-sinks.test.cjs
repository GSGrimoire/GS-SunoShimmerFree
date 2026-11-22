'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// This is a source-level drift detector, not a JavaScript parser or sanitizer.
// Exact existing assignments are inventoried; changes require independent review.
const roots = ['app.js', 'engine.js', 'edit.js', 'wav.js'];
const allowed = new Set([
  "tile.innerHTML = src.innerHTML;",
  "$('secLabel').innerHTML = '';"
]);
function violations(source) {
  const findings = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Dynamic HTML assignment or insertion; intentionally fail closed on new forms.
    if (/\.(?:innerHTML|outerHTML)\s*=|\.insertAdjacentHTML\s*\(/.test(line) &&
        !allowed.has(line)) findings.push({line: i + 1, kind: 'html-sink'});
    if (/\bdocument\s*\.\s*(?:write|writeln)\s*\(|\b(?:eval|Function)\s*\(|\bnew\s+Function\s*\(/.test(line))
      findings.push({line: i + 1, kind: 'code-execution'});
    if (/\b(?:setTimeout|setInterval)\s*\(\s*['"`]/.test(line))
      findings.push({line: i + 1, kind: 'string-timer'});
  }
  return findings;
}
test('production JavaScript has no unreviewed HTML or code execution sinks', () => {
  for (const file of roots) {
    const source = fs.readFileSync(path.resolve(__dirname, '..', '..', file), 'utf8');
    assert.deepEqual(violations(source), [], file + ' has unreviewed dynamic sink(s)');
  }
});
test('known existing sinks are narrowly inventoried', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'app.js'), 'utf8');
  assert.match(source, /tile\.innerHTML\s*=\s*src\.innerHTML;/);
  assert.match(source, /\$\('secLabel'\)\.innerHTML\s*=\s*'';/);
});
test('synthetic injection and code execution sinks are rejected', () => {
  for (const source of [
    'target.innerHTML = untrusted;',
    'target.outerHTML = untrusted;',
    'target.insertAdjacentHTML("beforeend", untrusted);',
    'document.write(untrusted);',
    'eval(untrusted);',
    'new Function(untrusted);',
    'setTimeout("danger()", 100);'
  ]) assert.notEqual(violations(source).length, 0, source);
});
test('synthetic safe text assignment is accepted', () => {
  assert.deepEqual(violations('target.textContent = untrusted;'), []);
});
