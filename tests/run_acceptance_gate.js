#!/usr/bin/env node
// Milestone A acceptance gate: one command, one exit code.
//   node tests/run_acceptance_gate.js
// Runs every tests/*_test.js (edit_test.js needs a WAV argument and is run
// separately by its own workflow), REQUIRES ffmpeg and the ten Viking
// fixtures (SSF_VIKING_DIR or example-files/viking-shimmer), so no check can
// pass by skipping. Prints the exact commit, Node and FFmpeg versions, and a
// PASS/FAIL line per suite. Exit 0 only if every suite passed.
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const dir=__dirname, repo=path.join(dir,'..');
const tests=fs.readdirSync(dir).filter(f=>f.endsWith('_test.js')&&f!=='edit_test.js').sort();
const sh=(c,a)=>{const r=cp.spawnSync(c,a,{cwd:repo,encoding:'utf8'});return r.status===0?r.stdout.trim():'unavailable';};
const commit=sh('git',['rev-parse','HEAD']), dirty=sh('git',['status','--porcelain'])!=='';
console.log('SSF milestone A acceptance gate');
console.log('  commit  '+commit+(dirty?'  (WORKING TREE HAS UNCOMMITTED CHANGES: not a valid gate result)':''));
console.log('  node    '+process.version+'   ffmpeg '+(sh('ffmpeg',['-version']).split('\n')[0]||'unavailable'));
console.log('  fixtures '+(process.env.SSF_VIKING_DIR||'example-files/viking-shimmer'));
let failed=0;
for (const t of tests) {
  const start=Date.now();
  const r=cp.spawnSync(process.execPath,[path.join(dir,t)],{cwd:repo,encoding:'utf8',
    env:{...process.env,SSF_REQUIRE_FIXTURES:'1'},timeout:20*60*1000,maxBuffer:64<<20});
  const ok=r.status===0, secs=((Date.now()-start)/1000).toFixed(1);
  console.log('  '+(ok?'PASS':'FAIL')+'  '+t.padEnd(36)+secs.padStart(6)+' s');
  if (!ok) { failed++; console.log((r.stdout+r.stderr).split('\n').slice(-12).map(l=>'        '+l).join('\n')); }
  else if (t==='milestone_a_acceptance_test.js'||t==='stem_mp3_ffmpeg_parity_test.js')
    console.log(r.stdout.trim().split('\n').map(l=>'        '+l).join('\n'));
}
console.log(failed?'GATE FAILED: '+failed+' of '+tests.length+' suites.':'GATE PASSED: all '+tests.length+' suites.'+(dirty?' (uncommitted changes: rerun on a clean checkout)':''));
process.exit(failed?1:0);
