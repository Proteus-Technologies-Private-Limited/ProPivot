const lib = require('../dist/index.cjs');
const { buildStore, normalizeReport, buildMatrix, LocalEngine, serializeMatrix, deserializeMatrix } = lib;
const US='␟', GS='␞';
const key=(rp,cp,m)=>rp.join(US)+GS+cp.join(US)+GS+m;

const data = [];
for (const r of ['West','East','North']) for (const y of [2023,2024,2025]) data.push({ r, y, sales: ({West:100,East:50,North:400}[r]) + (y-2023)*50 });

const m = buildMatrix(buildStore(data), normalizeReport({
  dataSource:{type:'json',data},
  slice:{ rows:[{uniqueName:'r'}], columns:[{uniqueName:'y'}], measures:[{uniqueName:'sales',aggregation:'runningtotals'}] },
}));
console.log('runningtotals West 2025 =', m.cells.get(key(['West'],['2025'],'sales')), '(expect 450)');

const flat = buildMatrix(buildStore(data), normalizeReport({
  dataSource:{type:'json',data},
  slice:{ rows:[{uniqueName:'r'}], columns:[{uniqueName:'y'}], measures:[{uniqueName:'sales'}] },
  options:{ grid:{ type:'flat' } },
}));
console.log('flat rows =', flat.flat.rows.length, '(expect 9), cols =', flat.flat.columns.map(c=>c.key).join(','));

(async () => {
  const eng = new LocalEngine();
  eng.setData(data);
  const cm = await eng.compute({ dataSource:{type:'json',data}, slice:{ rows:[{uniqueName:'r'}], measures:[{uniqueName:'sales'}] } });
  const round = deserializeMatrix(serializeMatrix(cm));
  console.log('engine grand sales =', round.cells.get(key([],[],'sales')), '(expect 2250)');
  console.log('worker bundle exists:', require('fs').existsSync(__dirname+'/../dist/propivot.worker.js'));
})();
