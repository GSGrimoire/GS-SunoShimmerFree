'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Conservative HTML source policy. Not a browser HTML parser or a network monitor.
function violations(html) {
  const found = [];
  const tags = html.match(/<\s*[a-z][^>]*>/gi) || [];
  for (const tag of tags) {
    const name = /^<\s*([a-z][\w:-]*)/i.exec(tag)?.[1]?.toLowerCase();
    if (!name) continue;
    const attrs = Object.create(null);
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4];
    }
    if (Object.keys(attrs).some(key => /^on[a-z]+$/.test(key))) found.push('inline-event-handler');
    if (['iframe', 'frame', 'object', 'embed', 'applet'].includes(name)) found.push('active-embed');
    if (name === 'script') {
      if (!Object.hasOwn(attrs, 'src')) found.push('inline-script');
      else if (!/^(?!\/\/)(?![a-z][\w+.-]*:)(?!\\\\)[^?#]+(?:[?#].*)?$/i.test(attrs.src)) found.push('external-script');
    }
    if (name === 'form' && (!Object.hasOwn(attrs, 'action') || !/^(?!\/\/)(?![a-z][\w+.-]*:)[^?#]*(?:[?#].*)?$/i.test(attrs.action))) found.push('form-target');
    if (name === 'base') found.push('base-url');
    if (name === 'meta' && /refresh/i.test(attrs['http-equiv'] || '')) found.push('meta-refresh');
  }
  return [...new Set(found)].sort();
}
test('production page has no active remote embed or inline execution surface', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
  assert.deepEqual(violations(html), []);
});
test('rejects remote script, protocol-relative script, and inline script', () => {
  assert.deepEqual(violations('<script src="https://example.test/x.js"></script>'), ['external-script']);
  assert.deepEqual(violations('<script src="//example.test/x.js"></script>'), ['external-script']);
  assert.deepEqual(violations('<script>sendData()</script>'), ['inline-script']);
});
test('rejects embedded content, inline handlers, remote forms, base and redirects', () => {
  const bad = '<iframe src="https://example.test"></iframe><button onclick="send()">Go</button><form action="https://example.test/upload"></form><base href="https://example.test/"><meta http-equiv="refresh" content="0;url=https://example.test">';
  assert.deepEqual(violations(bad), ['active-embed', 'base-url', 'form-target', 'inline-event-handler', 'meta-refresh']);
});
test('allows local scripts, local styles and user-initiated external navigation', () => {
  assert.deepEqual(violations('<script src="app.js"></script><link rel="stylesheet" href="style.css"><a href="https://github.com/">Source</a><form action="/save"></form>'), []);
});
