/* Validate both published preview bundles and their local worker imports.
 * Run: node tests/preview_bundle_test.js
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(file,'utf8');
const production=read(path.join(root,'index.html'));
assert(!/id="autoClean"/.test(production),'production must not contain unfinished Auto Clean feature');
assert(!/stem-zip\.js/.test(production),'production must not contain unfinished stem ZIP importer');

function verify(directory,opts){
 const preview=path.join(root,directory),html=read(path.join(preview,'index.html'));
 assert(html.includes(opts.label),'preview must show '+opts.label);
 assert(/noindex,\s*nofollow/i.test(html),'preview must not be indexed');
 const assets=new Set();
 for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
   const raw=match[1];
   if(/^(https?:|\/\/|#|\.\.\/|mailto:)/.test(raw))continue;
   const file=raw.split(/[?#]/)[0];
   if(/\.(js|css)$/.test(file))assets.add(file);
 }
 for(const dep of opts.workers)assets.add(dep);
 let checked=0;
 function visit(rel){
   assert(!rel.startsWith('/')&&!rel.includes('..')&&!rel.includes('\\'),
     'unsafe preview asset path: '+rel);
   const local=path.resolve(preview,rel);
   assert(local.startsWith(preview+path.sep),'asset escapes '+directory);
   assert(fs.existsSync(local),'missing '+directory+'/'+rel);
   if(assets.has(rel+'#visited'))return;
   assets.add(rel+'#visited');checked++;
   if(!rel.endsWith('.js'))return;
   const js=read(local);
   for(const imports of js.matchAll(/importScripts\s*\(([^)]+)\)/g)){
     for(const match of imports[1].matchAll(/["']([^"']+)["']/g))visit(match[1]);
   }
 }
 for(const rel of Array.from(assets))visit(rel);
 for(const file of opts.required) {
   assert(html.includes(file),'HTML missing required '+directory+'/'+file);
 }
 const meta=JSON.parse(read(path.join(preview,'build-info.json')));
 assert(meta.production_unchanged===true,'preview must record production isolation');
 assert(meta.source_commit&&/^[0-9a-f]{40}$/.test(meta.source_commit),
   'preview source SHA not recorded');
 console.log('PASS '+directory+': '+checked+' linked local assets and worker imports');
}

verify('preview',{
 label:'PREVIEW v5e',
 workers:['worker.js','polish-worker.js','auto-clean-worker.js','export-worker.js'],
 required:['auto-clean.js','id="autoClean"']
});
verify('preview-shimmer',{
 label:'SHIMMER TEST v5f',
 workers:['worker.js','polish-worker.js','auto-clean-worker.js','export-worker.js'],
 required:['auto-clean.js','id="autoClean"','id="shimmerFocus"']
});
verify('preview-stems',{
 label:'STEMS TEST',
 workers:['worker.js','polish-worker.js','stem-audio-worker.js','export-worker.js'],
 required:['stem-zip.js','stem-resample.js','stem-ui.js','Import stems ZIP']
});
console.log('PASS all three experimental previews and production isolation.');
