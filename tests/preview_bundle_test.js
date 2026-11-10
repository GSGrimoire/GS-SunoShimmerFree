/* Static safety validation for published, isolated GitHub Pages preview.
 * Run: node tests/preview_bundle_test.js
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),preview=path.join(root,'preview');
const read=file=>fs.readFileSync(file,'utf8');
const html=read(path.join(preview,'index.html'));
assert(/PREVIEW v5e/.test(html),'preview must carry an unambiguous experimental label');
assert(/noindex,\s*nofollow/.test(html),'preview should not be indexed');
assert(/src="auto-clean\.js/.test(html),'online build must include new Auto Clean module');
assert(/id="autoClean"/.test(html),'Auto Clean control missing');
const mainHtml=read(path.join(root,'index.html'));
assert(!/id="autoClean"/.test(mainHtml),'production homepage must not accidentally embed draft Auto Clean');
const required=new Set();
for(const m of html.matchAll(/(?:src|href)="([^"]+)"/g)){
 const raw=m[1];
 if(/^(https?:|\/\/|#|\.\.\/|mailto:)/.test(raw))continue;
 const p=raw.split(/[?#]/)[0];
 if(/\.(?:js|css)$/.test(p))required.add(p);
}
for(const extra of ['worker.js','polish-worker.js','auto-clean-worker.js','export-worker.js']){
 required.add(extra);
}
const visited=new Set();
function visit(rel){
 assert(!rel.startsWith('/')&&!rel.includes('..'),'unsafe asset path '+rel);
 const file=path.resolve(preview,rel);
 assert(file.startsWith(preview+path.sep),'asset escapes preview');
 assert(fs.existsSync(file),'missing preview asset '+rel);
 if(visited.has(rel))return;visited.add(rel);
 if(!rel.endsWith('.js'))return;
 const code=read(file);
 for(const group of code.matchAll(/importScripts\s*\(([^)]+)\)/g)){
   for(const hit of group[1].matchAll(/["']([^"']+)["']/g)){
     visit(hit[1]);
   }
 }
}
for(const x of required)visit(x);
const meta=JSON.parse(read(path.join(preview,'build-info.json')));
assert(meta.production_unchanged===true);
assert(/^v5e$/.test(meta.version));
console.log('PASS preview assets: '+visited.size+' local resources and worker dependencies resolved; production isolated.');
