#!/usr/bin/env node
// Local-only browser network smoke test; Playwright is optional and separately installed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const [site, fixture] = process.argv.slice(2);
if (!site || !fixture) { console.error('Usage: node privacy-network-smoke.mjs <local-http-url> <synthetic-wav-path>'); process.exit(2); }
const url = new URL(site);
if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname) || url.protocol !== 'http:') throw new Error('Only loopback HTTP URLs allowed');
const bytes = readFileSync(resolve(fixture));
if (bytes.length < 44 || bytes.toString('ascii',0,4) !== 'RIFF' || bytes.toString('ascii',8,12) !== 'WAVE') throw new Error('Synthetic WAV required');
let chromium;
try { ({ chromium } = await import('playwright')); } catch { throw new Error('Install Playwright and Chromium in isolated test environment'); }
const browser = await chromium.launch({headless:true});
const requests = [];
try {
 const context = await browser.newContext({serviceWorkers:'block'});
 const page = await context.newPage();
 page.on('request', request => {
  const target = new URL(request.url());
  if (!['http:','https:'].includes(target.protocol)) return;
  requests.push({method:request.method(),origin:target.origin,path:target.pathname,external:target.origin!==url.origin});
 });
 await page.goto(url.href,{waitUntil:'networkidle'});
 const baseline = requests.length;
 const input = page.locator('input[type="file"]').first();
 if (await input.count() !== 1) throw new Error('No file input: adapt harness before claiming coverage');
 await input.setInputFiles({name:'synthetic-test.wav',mimeType:'audio/wav',buffer:bytes});
 await page.waitForTimeout(2000);
 const observed = requests.slice(baseline);
 const unexpected = observed.filter(r=>r.external || !['GET','HEAD'].includes(r.method));
 console.log(JSON.stringify({baselineRequests:baseline,postImportRequests:observed,unexpected},null,2));
 if (unexpected.length) throw new Error('Unexpected external or mutating request during import');
 console.log('PASS: no external or mutating requests observed in sampled import interval');
} finally { await browser.close(); }
