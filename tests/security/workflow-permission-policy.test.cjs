'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowDir = path.resolve(__dirname, '../../.github/workflows');

function auditWorkflow(source) {
  const failures = [];
  // Conservative text checks. Not a substitute for parsing YAML or evaluating
  // transitive permissions and third-party action behavior.
  if (/^\s*(?:pull_request_target|workflow_run)\s*:/m.test(source) ||
      /^\s*on\s*:\s*\[?[^\n]*(?:pull_request_target|workflow_run)/m.test(source))
    failures.push('privileged event trigger');
  if (/^\s*(?:permissions\s*:\s*write-all|(?:contents|actions|checks|deployments|issues|packages|pull-requests|security-events|statuses)\s*:\s*write)\s*(?:#.*)?$/m.test(source))
    failures.push('elevated repository permission');
  if (/^\s*persist-credentials\s*:\s*true\s*(?:#.*)?$/m.test(source))
    failures.push('persistent checkout credentials explicitly enabled');
  return failures;
}

test('policy catches privileged events, write scopes and persistent credentials', () => {
  for (const example of [
    'on:\n  pull_request_target:\n',
    'on: [push, workflow_run]',
    'permissions: write-all',
    'permissions:\n  contents: write',
    'with:\n  persist-credentials: true'
  ]) assert.notDeepEqual(auditWorkflow(example), [], example);
  assert.deepEqual(auditWorkflow('on:\n  pull_request:\npermissions:\n  contents: read\nwith:\n  persist-credentials: false\n'), []);
});

test('tracked workflows contain no explicitly privileged triggers or permissions', () => {
  assert.ok(fs.existsSync(workflowDir), 'workflow directory missing');
  const names = fs.readdirSync(workflowDir).filter(name => /\.ya?ml$/i.test(name));
  assert.ok(names.length > 0, 'no workflow files inspected');
  const violations = [];
  for (const name of names) {
    const findings = auditWorkflow(fs.readFileSync(path.join(workflowDir, name), 'utf8'));
    for (const finding of findings) violations.push(name + ': ' + finding);
  }
  assert.deepEqual(violations, []);
});
