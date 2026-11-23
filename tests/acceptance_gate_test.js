// Regression for tests/run_acceptance_gate.js: the gate is release evidence,
// so it must not exit 0 on a dirty or unknown revision, or when a suite
// printed SKIP. Pure checks on the exported verdict logic, then the real
// script end to end in a throwaway git repo with trivial suites.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const {suiteOk,verdict}=require('./run_acceptance_gate.js');
let n=0; const ok=(c,m)=>{assert.ok(c,m);n++;};

const sha='0123456789abcdef0123456789abcdef01234567';
ok(suiteOk(0,'PASS all'), 'exit 0 without SKIP passes');
ok(!suiteOk(1,''), 'nonzero exit fails');
ok(!suiteOk(null,''), 'killed or timed out (status null) fails');
ok(!suiteOk(0,'SKIP: ffmpeg not available.'), 'SKIP line fails even with exit 0');
ok(!suiteOk(0,'checking\n  SKIP: fixtures missing\n'), 'indented SKIP on a later line fails');
ok(suiteOk(0,'no skipped frames'), 'the word "skipped" inside a line is not a SKIP line');
assert.equal(verdict({failed:0,total:13,commit:sha,dirty:false}).code,0); n++;
assert.equal(verdict({failed:2,total:13,commit:sha,dirty:false}).code,1); n++;
assert.equal(verdict({failed:0,total:13,commit:sha,dirty:true}).code,2); n++;
assert.equal(verdict({failed:0,total:13,commit:null,dirty:false}).code,2); n++;
assert.equal(verdict({failed:0,total:13,commit:'unavailable',dirty:false}).code,2); n++;
assert.equal(verdict({failed:1,total:13,commit:sha,dirty:true}).code,1, 'a failure wins over dirty'); n++;
assert.equal(verdict({failed:0,total:0,commit:sha,dirty:false}).code,1, 'no suites is a failure'); n++;
ok(/GATE INVALID/.test(verdict({failed:0,total:3,commit:sha,dirty:true}).line), 'dirty says GATE INVALID');
ok(!/PASSED/.test(verdict({failed:0,total:3,commit:sha,dirty:true}).line), 'dirty never prints PASSED');

// End to end: copy the real script next to trivial suites.
const hasGit=cp.spawnSync('git',['--version']).status===0;
if (!hasGit) { console.error('FAIL: git is required for the gate regression.'); process.exit(1); }
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ssf-gate-'));
try {
  const t=path.join(root,'tests'); fs.mkdirSync(t);
  fs.copyFileSync(path.join(__dirname,'run_acceptance_gate.js'),path.join(t,'run_acceptance_gate.js'));
  fs.writeFileSync(path.join(t,'a_test.js'),"console.log('ok');\n");
  const env={...process.env,GIT_CEILING_DIRECTORIES:path.dirname(root)};
  delete env.GIT_DIR; delete env.GIT_WORK_TREE;
  const run=()=>cp.spawnSync(process.execPath,[path.join(t,'run_acceptance_gate.js')],{cwd:root,encoding:'utf8',env});
  // Not a git checkout: unknown commit.
  let r=run(); assert.equal(r.status,2,r.stdout); ok(/GATE INVALID/.test(r.stdout),'no git: invalid');
  const g=(...a)=>{const x=cp.spawnSync('git',['-c','user.name=gate','-c','user.email=gate@example.invalid','-c','commit.gpgsign=false',...a],{cwd:root,encoding:'utf8'});assert.equal(x.status,0,x.stderr);};
  g('init','-q'); g('add','-A'); g('commit','-q','-m','fixture');
  r=run(); assert.equal(r.status,0,r.stdout); ok(/GATE PASSED: all 1 suites on [0-9a-f]{40}\./.test(r.stdout),'clean: passed with SHA');
  fs.appendFileSync(path.join(t,'a_test.js'),'// edit\n');
  r=run(); assert.equal(r.status,2,r.stdout); ok(/GATE INVALID/.test(r.stdout)&&!/GATE PASSED/.test(r.stdout),'modified tracked file: invalid');
  g('checkout','-q','--','tests/a_test.js');
  fs.writeFileSync(path.join(root,'stray.txt'),'x');
  r=run(); assert.equal(r.status,2,r.stdout); n++;
  fs.unlinkSync(path.join(root,'stray.txt'));
  fs.writeFileSync(path.join(t,'b_test.js'),"console.log('SKIP: ffmpeg not available.');\n");
  g('add','-A'); g('commit','-q','-m','skip suite');
  r=run(); assert.equal(r.status,1,r.stdout); ok(/FAIL  b_test\.js/.test(r.stdout)&&/GATE FAILED: 1 of 2/.test(r.stdout),'SKIP suite fails the gate');
} finally { fs.rmSync(root,{recursive:true,force:true}); }
console.log('acceptance gate regression: '+n+' checks passed');
