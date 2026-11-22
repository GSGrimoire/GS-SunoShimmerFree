'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Narrow line-pattern drift alert, NOT a syntax-aware security gate.
// It misses computed and multiline assignments, aliases and dynamic calls.
// Exceptions are tied to the reviewed file, physical line and exact text.
// Changes to this inventory require an independent security review.
const roots = ['app.js', 'engine.js', 'edit.js', 'wav.js'];
const reviewed = new Map([
  ['app.js:357', 'tile.className = src.className; tile.innerHTML = src.innerHTML;'],
  ['app.js:441', "$('secLabel').innerHTML = '';"]
]);
function violations(source, file = 'synthetic.js') {
  const findings = [];
  const lines = source.split(/\r?\n/);
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim(), site = file + ':' + (i + 1);
    const existing = reviewed.get(site) === line && !seen.has(site);
    if (existing) seen.add(site);
    // Deliberately line-oriented: a drift alert, not a complete sink search.
    // Exclude comparisons from the single-line assignment heuristic.
    if (/\.(?:innerHTML|outerHTML)\s*=(?!=|>)|\.insertAdjacentHTML\s*\(/.test(line) &&
        !existing) findings.push({line: i + 1, kind: 'html-sink'});
    if (/\bdocument\s*\.\s*(?:write|writeln)\s*\(|\b(?:eval|Function)\s*\(|\bnew\s+Function\s*\(/.test(line))
      findings.push({line: i + 1, kind: 'code-execution'});
    if (/\b(?:setTimeout|setInterval)\s*\(\s*['"`]/.test(line))
      findings.push({line: i + 1, kind: 'string-timer'});
  }
  return findings;
}
test('four production root files have no new single-line sink patterns', () => {
  for (const file of roots) {
    const source = fs.readFileSync(path.resolve(__dirname, '..', '..', file), 'utf8');
    assert.deepEqual(violations(source, file), [], file + ' has unreviewed dynamic sink(s)');
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

test('grandfathered statements cannot be duplicated, moved or used in other files', () => {
  const [copy, clear] = [...reviewed.values()];
  for (const statement of [copy, clear]) {
    assert.notEqual(violations(statement, 'engine.js').length, 0);
    assert.notEqual(violations(statement, 'app.js').length, 0);
  }
  const app = fs.readFileSync(path.resolve(__dirname, '..', '..', 'app.js'), 'utf8');
  assert.notEqual(violations(app + '\\n' + copy, 'app.js').length, 0);
  assert.notEqual(violations(app + '\\n' + clear, 'app.js').length, 0);
  assert.notEqual(violations('\\n' + app, 'app.js').length, 0,
    'moving the original reviewed sites must invalidate their line-bound exceptions');
});
test('comparison is not an assignment', () => {
  assert.deepEqual(violations('target.innerHTML === untrusted;'), []);
  assert.deepEqual(violations('target.outerHTML == untrusted;'), []);
});
test('known syntax blind spots are explicit, not security assurances', () => {
  // These negative controls prove the limited detector MUST NOT be called
  // a comprehensive injection gate.
  assert.deepEqual(violations('target.innerHTML\\n = untrusted;'), []);
  assert.deepEqual(violations("target['innerHTML'] = untrusted;"), []);
});
