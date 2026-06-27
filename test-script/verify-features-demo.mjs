// Throwaway check: load demo/features.html in happy-dom with the built global
// bundle, render every feature, and assert each produces a .pp-table with no error.
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
// Args: [bundlePath] [htmlPath] — default to the local demo build.
const bundlePath = process.argv[2] || 'dist/propivot.global.js';
const htmlPath = process.argv[3] || 'demo/features.html';
const bundle = readFileSync(join(root, bundlePath), 'utf8');
const html = readFileSync(join(root, htmlPath), 'utf8');
console.log(`bundle=${bundlePath}  page=${htmlPath}`);

// Pull the inline page script (the <script> block without a src attribute).
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const pageScript = inline[inline.length - 1];
if (!pageScript) throw new Error('could not find inline page script');

const win = new Window({ url: 'http://localhost/' });
win.document.body.innerHTML = '<nav id="nav"></nav><div id="title"></div><div id="desc"></div><div id="tryhint"></div><div id="demo"></div><code id="code"></code><button id="copy"></button><button id="codepen"></button><button id="jsfiddle"></button><span id="cdnjs"></span><span id="cdncss"></span>';

win.eval(bundle);          // defines window.ProPivot
if (typeof win.ProPivot !== 'function') throw new Error('window.ProPivot not defined by bundle');
win.eval(pageScript);      // wires nav + renders the first feature

const tick = () => new Promise((r) => setTimeout(r, 30));

const ids = [...win.document.querySelectorAll('#nav button')].map((b) => b.dataset.id);
let failures = 0;
for (const id of ids) {
  win.location.hash = id;
  win.dispatchEvent(new win.Event('hashchange'));
  await tick();
  const table = win.document.querySelector('#demo .pp-table');
  const logTxt = win.document.querySelector('#demo #log')?.textContent ?? '';
  const ok = !!table && !logTxt.startsWith('Error:');
  console.log(`${ok ? '✓' : '✗'} ${id.padEnd(18)} table=${!!table} cells=${win.document.querySelectorAll('#demo td').length}`);
  if (!ok) { failures++; if (logTxt) console.log('   log:', logTxt.split('\n')[0]); }
}
console.log(failures ? `\n${failures} feature(s) failed` : '\nAll features rendered OK');
process.exit(failures ? 1 : 0);
