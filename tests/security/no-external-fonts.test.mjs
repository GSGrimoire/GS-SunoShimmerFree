// Privacy regression: landing page must not passively connect to third-party font hosts.
// Run from repository root: node --test tests/security/no-external-fonts.test.mjs
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

test('landing page has no third-party Google Fonts endpoints', () => {
  assert.doesNotMatch(html, /(?:fonts\\.googleapis\\.com|fonts\\.gstatic\\.com)/i);
});

test('landing page does not passively connect to external style or font hosts', () => {
  const tags = html.match(/<link\\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!/\\brel\\s*=\\s*['\"]?(?:stylesheet|preconnect|preload)/i.test(tag)) continue;
    assert.doesNotMatch(tag, /\\bhref\\s*=\\s*['\"]?https?:\\/\\//i, `External resource link: ${tag}`);
  }
});
