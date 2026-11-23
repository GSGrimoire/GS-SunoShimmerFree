// Issue #36: the production page carries an enforced Content-Security-Policy
// that forbids loading code or sending data to any other origin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const meta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
test('production page declares a Content-Security-Policy', () => { assert.ok(meta); });
test('policy keeps scripts, network and styles on the page origin', () => {
  const p = Object.fromEntries(meta[1].split(';').map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(p['default-src'], ["'self'"]);
  assert.deepEqual(p['script-src'], ["'self'"]);
  assert.deepEqual(p['connect-src'], ["'self'", 'blob:', 'data:']);
  assert.deepEqual(p['style-src'], ["'self'"]);
  assert.deepEqual(p['object-src'], ["'none'"]);
  assert.deepEqual(p['form-action'], ["'none'"]);
  for (const v of Object.values(p).flat()) assert.ok(!/^https?:|^\*$|unsafe-(inline|eval)/.test(v), 'no remote host, wildcard or unsafe source: ' + v);
});
test('policy does not need inline code: page has no inline scripts, styles or handlers', () => {
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(html, /<style[\s>]/);
  assert.doesNotMatch(html, /\son[a-z]+="/);
});
test('page sends no referrer', () => { assert.match(html, /<meta name="referrer" content="no-referrer">/); });
