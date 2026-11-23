// ChatGPT-2 finding (2026-11-23, #47): the Sound Polish workflow's path
// filters must cover every file the acceptance gate runs, the browser
// harnesses and every production source file, for push and pull_request.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const repo=path.join(__dirname,'..');
const yml=fs.readFileSync(path.join(repo,'.github/workflows/sound-polish.yml'),'utf8');
function filters(event){
  const m=yml.match(new RegExp('\\n  '+event+':\\n    paths:\\n((?:      - \'[^\']+\'\\n)+)'));
  assert(m,event+' must have a paths list');
  return [...m[1].matchAll(/- '([^']+)'/g)].map(x=>x[1]);
}
function glob(p){return new RegExp('^'+p.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*\*/g,'\u0000').replace(/\*/g,'[^/]*').replace(/\u0000/g,'.*')+'$');}
const files=[];
for (const f of fs.readdirSync(path.join(repo,'tests'))) if (/\.(js|mjs|py)$/.test(f)) files.push('tests/'+f);
for (const sub of ['security','browser']) {
  const d=path.join(repo,'tests',sub);
  if (fs.existsSync(d)) for (const f of fs.readdirSync(d)) files.push('tests/'+sub+'/'+f);
}
for (const f of fs.readdirSync(repo)) if (/\.(js|html|css)$/.test(f)) files.push(f);
files.push('.github/workflows/sound-polish.yml');
assert(files.some(f=>f.startsWith('tests/security/'))&&files.some(f=>f.startsWith('tests/browser/')),'fixture sanity');
for (const event of ['push','pull_request']) {
  const pats=filters(event).map(glob);
  const missing=files.filter(f=>!pats.some(re=>re.test(f)));
  assert.deepEqual(missing,[],event+' paths do not cover: '+missing.join(', '));
}
console.log('Workflow trigger coverage: '+files.length+' gate, harness and source files covered for push and pull_request.');
