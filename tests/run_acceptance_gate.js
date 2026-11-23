#!/usr/bin/env node
// Milestone A acceptance gate: one command, one exit code.
//   node tests/run_acceptance_gate.js
// Runs every tests/*_test.js and tests/security/*.test.mjs (edit_test.js needs a WAV argument and is run
// separately by its own workflow), REQUIRES ffmpeg and the ten Viking
// fixtures (SSF_VIKING_DIR or example-files/viking-shimmer), so no check can
// pass by skipping. Prints the exact commit, Node and FFmpeg versions, and a
// PASS/FAIL line per suite.
// Exit 0 only if every suite passed, none printed a SKIP line, and the
// revision is verifiable: a clean git checkout with a known commit. A dirty
// or unknown revision still runs every suite but exits 2 (GATE INVALID),
// because its result cannot be pinned to a SHA.
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');

// A suite passes only if it exited 0 and printed no SKIP line. With
// SSF_REQUIRE_FIXTURES=1 the fixture suites fail instead of skipping, so a
// SKIP here means a suite has a skip path the gate does not know about.
function suiteOk(status, output) {
  return status===0 && !/^\s*SKIP\b/m.test(String(output||''));
}

// Final verdict. Exit 1 if any suite failed; otherwise exit 2 if the
// revision cannot be pinned (dirty tree or unknown commit); otherwise 0.
function verdict({failed, total, commit, dirty}) {
  if (failed) return {code:1, line:'GATE FAILED: '+failed+' of '+total+' suites.'};
  if (!total) return {code:1, line:'GATE FAILED: no suites found.'};
  if (!/^[0-9a-f]{40}$/.test(String(commit||'')))
    return {code:2, line:'GATE INVALID: all '+total+' suites passed, but the commit is unknown. Run it in a git checkout.'};
  if (dirty)
    return {code:2, line:'GATE INVALID: all '+total+' suites passed, but the working tree has uncommitted changes. Commit or stash them and rerun.'};
  return {code:0, line:'GATE PASSED: all '+total+' suites on '+commit+'.'};
}

function main() {
  const dir=__dirname, repo=path.join(dir,'..');
  const tests=fs.readdirSync(dir).filter(f=>f.endsWith('_test.js')&&f!=='edit_test.js').sort();
  // Security regressions (issue #36) use node:test and live in tests/security.
  const secDir=path.join(dir,'security');
  if (fs.existsSync(secDir))
    for (const f of fs.readdirSync(secDir).filter(f=>/\.test\.m?js$/.test(f)).sort()) tests.push('security/'+f);
  const sh=(c,a)=>{const r=cp.spawnSync(c,a,{cwd:repo,encoding:'utf8'});return r.status===0?r.stdout.trim():null;};
  const commit=sh('git',['rev-parse','HEAD']), status=sh('git',['status','--porcelain']);
  const dirty=status===null||status!=='';
  console.log('SSF milestone A acceptance gate');
  console.log('  commit  '+(commit||'unavailable')+(dirty?'  (WORKING TREE NOT CLEAN OR NOT A GIT CHECKOUT: not a valid gate result)':''));
  console.log('  node    '+process.version+'   ffmpeg '+((sh('ffmpeg',['-version'])||'unavailable').split('\n')[0]));
  console.log('  fixtures '+(process.env.SSF_VIKING_DIR||'example-files/viking-shimmer'));
  let failed=0;
  for (const t of tests) {
    const start=Date.now();
    const args=t.startsWith('security/')?['--test',path.join(dir,t)]:[path.join(dir,t)];
    const r=cp.spawnSync(process.execPath,args,{cwd:repo,encoding:'utf8',
      env:{...process.env,SSF_REQUIRE_FIXTURES:'1'},timeout:20*60*1000,maxBuffer:64<<20});
    const out=(r.stdout||'')+(r.stderr||''), ok=suiteOk(r.status,out), secs=((Date.now()-start)/1000).toFixed(1);
    console.log('  '+(ok?'PASS':'FAIL')+'  '+t.padEnd(36)+secs.padStart(6)+' s');
    if (!ok) { failed++; console.log(out.split('\n').slice(-12).map(l=>'        '+l).join('\n')); }
    else if (t==='milestone_a_acceptance_test.js'||t==='stem_mp3_ffmpeg_parity_test.js')
      console.log(r.stdout.trim().split('\n').map(l=>'        '+l).join('\n'));
  }
  const v=verdict({failed,total:tests.length,commit,dirty});
  console.log(v.line);
  process.exit(v.code);
}

module.exports={suiteOk,verdict};
if (require.main===module) main();
