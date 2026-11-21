'use strict';
// Dependency-free, deliberately narrow guard against accidentally committing credentials.
// Not a replacement for repository history scanning or a managed secret scanner.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const files = ['index.html', 'app.js', 'engine.js', 'edit.js'];
function findings(source) {
  const rules = [
    { name: 'private-key-header', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
    { name: 'GitHub-token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g },
    { name: 'GitHub-fine-grained-token', re: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g },
    { name: 'OpenAI-project-key', re: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g },
    { name: 'AWS-access-key', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
    { name: 'hardcoded-secret-assignment', re: /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|auth[_-]?token)\s*[:=]\s*['"`][A-Za-z0-9_./+=-]{24,}['"`]/gi }
  ];
  return rules.flatMap(({name,re}) => [...source.matchAll(re)].map(m => ({name, offset:m.index})));
}
test('detector catches representative credential shapes', () => {
  for (const value of [
    '-----BEGIN PRIVATE KEY-----',
    'ghp_' + 'a'.repeat(36),
    'github_pat_' + 'a'.repeat(40),
    'sk-proj-' + 'a'.repeat(30),
    'AKIA' + 'A'.repeat(16),
    'apiKey = "' + 'a'.repeat(32) + '"'
  ]) assert.ok(findings(value).length, 'expected a detection');
  assert.deepEqual(findings('const apiKey = process.env.API_KEY;'), []);
  assert.deepEqual(findings('const accessToken = await getToken();'), []);
});
test('tracked production entrypoints contain no recognized embedded credentials', () => {
  for (const name of files) {
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    const matches = findings(source);
    assert.deepEqual(matches, [], name + ': possible credential patterns (rule and character offset only)');
  }
});
