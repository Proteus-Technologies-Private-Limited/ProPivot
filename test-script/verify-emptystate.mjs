import { Window } from 'happy-dom';
const win = new Window();
globalThis.window = win; globalThis.document = win.document;
globalThis.HTMLElement = win.HTMLElement; globalThis.getComputedStyle = win.getComputedStyle.bind(win);
const { ProPivot } = await import('../dist/index.js');

// Mirror the page's structure & gating logic.
document.body.innerHTML = '<div id="placeholder"></div><div id="pivot" class="hidden"></div>';
const $ = (id) => document.getElementById(id);
let pivot = null;
function loadRaw(input) {
  if (!pivot) pivot = new ProPivot({ container: '#pivot', toolbar: true });
  const report = pivot.loadData(input);
  $('placeholder').classList.add('hidden');
  $('pivot').classList.remove('hidden');
  return report;
}
let fail = 0; const ok = (c,m)=>{ if(!c){fail++;console.error('FAIL:',m);} else console.log('ok  -',m); };

// Before any action: placeholder visible, grid hidden, no pivot built.
ok(!$('placeholder').classList.contains('hidden'), 'initial: placeholder visible');
ok($('pivot').classList.contains('hidden'), 'initial: grid hidden');
ok(pivot === null, 'initial: no ProPivot instance created (no data shown by default)');

// After "Try sample": grid revealed.
loadRaw([{ Region:'West', Sales:100 }, { Region:'East', Sales:200 }]);
await new Promise(r=>setTimeout(r,40));
ok($('placeholder').classList.contains('hidden'), 'after load: placeholder hidden');
ok(!$('pivot').classList.contains('hidden'), 'after load: grid visible');
ok($('pivot').innerHTML.length > 200, 'after load: grid rendered');

console.log(fail ? `\n${fail} FAILURE(S)` : '\nEMPTY-STATE OK'); process.exit(fail?1:0);
