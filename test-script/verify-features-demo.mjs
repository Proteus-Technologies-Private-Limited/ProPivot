// Load the shared feature gallery in happy-dom against the built bundle and
// render every example, asserting each yields a grid (or a note for code-only).
// Args: [bundlePath] [galleryPath]
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const bundlePath = process.argv[2] || 'dist/propivot.global.js';
const galleryPath = process.argv[3] || 'docs/assets/gallery.js';
const bundle = readFileSync(join(root, bundlePath), 'utf8');
const gallery = readFileSync(join(root, galleryPath), 'utf8');
console.log(`bundle=${bundlePath}  gallery=${galleryPath}`);

const win = new Window({ url: 'http://localhost/' });
win.document.body.innerHTML = `
  <nav id="nav"></nav><h2 id="title"></h2><div id="desc"></div><div id="tryhint"></div>
  <div id="demo"></div><code id="code"></code>
  <button id="copy"></button><button id="codepen"></button><button id="jsfiddle"></button>
  <span id="cdnjs"></span><span id="cdncss"></span>`;
win.eval('window.GALLERY_CFG = { cdnJs: "x.js", cdnCss: "x.css" };');
win.eval(bundle);
if (typeof win.ProPivot !== 'function') throw new Error('window.ProPivot not defined by bundle');
win.eval(gallery);

const tick = () => new Promise((r) => setTimeout(r, 25));
const ids = [...win.document.querySelectorAll('#nav button')].map((b) => b.dataset.id);
console.log(`examples: ${ids.length}`);
let failures = 0;
for (const id of ids) {
  win.location.hash = id;
  win.dispatchEvent(new win.Event('hashchange'));
  await tick();
  const demo = win.document.querySelector('#demo');
  const table = demo.querySelector('.pp-table');
  const note = demo.querySelector('.note');
  const logTxt = demo.querySelector('#log')?.textContent ?? '';
  const ok = (!!table || !!note) && !logTxt.startsWith('Error:');
  console.log(`${ok ? '✓' : '✗'} ${id.padEnd(18)} ${table ? 'grid' : note ? 'code-only' : 'EMPTY'} cells=${demo.querySelectorAll('td').length}`);
  if (!ok) { failures++; if (logTxt) console.log('   log:', logTxt.split('\n')[0]); }
}
console.log(failures ? `\n${failures} example(s) failed` : `\nAll ${ids.length} examples OK`);
process.exit(failures ? 1 : 0);
