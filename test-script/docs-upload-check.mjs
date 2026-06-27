// Loads the committed SITE bundle (docs/assets/propivot.global.js) in a DOM and
// runs docs/upload.html's logic to confirm the published page renders a pivot.
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';
const win = new Window({ url: 'http://localhost/' });
const doc = win.document;
globalThis.window = win; globalThis.document = doc; globalThis.location = win.location;
new win.Function(readFileSync(new URL('../docs/assets/propivot.global.js', import.meta.url), 'utf8'))();
const PP = win.ProPivot;
if (!PP) throw new Error('window.ProPivot not defined by committed site bundle');

// Inference logic mirrored from docs/upload.html
const ISO=/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/, NUM=/^-?\s*\$?\s*[\d,]*\.?\d+%?$/;
const toN=(v)=>{const n=Number(String(v).replace(/[$,%\s]/g,''));return isFinite(n)?n:null;};
function infer(data){const cols=Object.keys(data[0]);const mapping={},types={};
  cols.forEach(c=>{let nn=0,nd=0,ne=0;data.forEach(r=>{const v=r[c];if(v===''||v==null)return;ne++;const s=String(v).trim();if(ISO.test(s))nd++;else if(NUM.test(s)&&toN(s)!=null)nn++;});
    types[c]=ne===0?'string':nd===ne?'year/month/day':nn===ne?'number':'string';mapping[c]={type:types[c],caption:c};});
  data.forEach(r=>cols.forEach(c=>{if(types[c]==='number'){const n=toN(r[c]);r[c]=n==null?null:n;}}));return{mapping,types};}

const SAMPLE=[{Region:'West',Category:'Furniture',Date:'2024-01-15',Sales:1200.5,Quantity:4},
 {Region:'East',Category:'Office',Date:'2024-03-11',Sales:240.75,Quantity:12},
 {Region:'North',Category:'Technology',Date:'2024-02-19',Sales:5600,Quantity:3}];
const {mapping,types}=infer(SAMPLE);
const firstText=Object.keys(mapping).find(c=>types[c]!=='number');
const firstNum=Object.keys(mapping).find(c=>types[c]==='number');
const container=doc.createElement('div');container.id='pivot';doc.body.appendChild(container);
let done=false,error=null;
new PP({container,toolbar:true,report:{dataSource:{type:'json',data:SAMPLE,mapping},
  slice:{rows:[{uniqueName:firstText}],columns:[],measures:[{uniqueName:firstNum,aggregation:'sum'}]},
  options:{grid:{type:'compact',showGrandTotals:'on'}}},reportcomplete:()=>{done=true;},dataerror:(e)=>{error=e;}});
await new Promise(r=>win.setTimeout(r,60));
if(error)throw error;
const cells=container.querySelectorAll('td.pp-cell').length;
const ok=done&&cells>0&&types.Date==='year/month/day'&&types.Sales==='number'&&SAMPLE[0].Sales===1200.5;
console.log('types:',types,'| value cells:',cells,'| reportcomplete:',done);
console.log(ok?'✅ PASS — published upload page renders with committed site bundle':'❌ FAIL');
process.exit(ok?0:1);
