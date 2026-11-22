#!/usr/bin/env node
/*
 * Builds dev/waitlist-demo.html: the Department Waiting List app running against the real
 * waitlist-server/Code.gs on a fake Google Sheet inside the page (one phone, no sharing),
 * shaped as a hosted demo page.
 *   node dev/build-waitlist-demo.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const seed = `
(function () {
  'use strict';
  setup();
  const key = PropertiesService.getScriptProperties().getProperty('TEAM_KEY');
  if (!JSON.parse(doPost({ postData: { contents: JSON.stringify({ key: key, fn: 'sync', args: [''] }) } }).getContent()).result.cases.length) {
    const ago = d => new Date(Date.now() - d * 864e5).toISOString();
    [
      ['Hoda Samir', '01122334455', 'Meningioma', 'El Sahel', 'Dr Alaa Ahmed', 'Labs', true, 'MRI booked Sunday', 'Dr Sara', 9],
      ['Mahmoud Ali', '01012345678', 'L4-L5 disc prolapse', 'El Mabara', 'Dr Ahmed Elghity', 'Waiting', false, '', 'Dr Ahmed', 21],
      ['سعاد عبد الله', '01598765432', 'Cervical myelopathy', '15th of May', 'General', 'Paperwork', false, 'Insurance approval pending', 'Dr Omar', 14],
      ['Karim Fathy', '01234567890', 'Lumbar canal stenosis', 'El Sahel', 'Dr Ahmed Elghity', 'Ready for surgery', false, '', 'Dr Sara', 30],
    ].forEach((r, i) => {
      USER_ = r[8];
      const c = save_('demo' + i, { name: r[0], phone: r[1], diagnosis: r[2], hospital: r[3], consultant: r[4], status: r[5], urgent: r[6], note: r[7] });
      // Back-date so the demo shows a real queue.
      const sh = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')).getSheetByName('Cases');
      const row = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(c.id).matchEntireCell(true).findNext().getRow();
      sh.getRange(row, COLUMNS.indexOf('createdAt') + 1).setValues([[ago(r[9])]]);
    });
  }
  try {
    if (!localStorage.getItem('waitlist.conf.v1')) {
      localStorage.setItem('waitlist.conf.v1', JSON.stringify({ url: 'fake:server', key: key, team: 'Neurosurgery (demo)', name: 'You' }));
    }
  } catch (e) { /* no storage: the join screen shows */ }
})();
`;

const banner =
  '<div style="background:var(--amber-bg);color:var(--amber-fg);font-size:13px;' +
  'padding:8px max(16px, env(safe-area-inset-right, 0px)) 8px max(16px, env(safe-area-inset-left, 0px));' +
  'display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;text-align:center">' +
  '<span><b>Demo</b>: one phone, sample cases. The real list syncs across everyone’s phones.</span>' +
  '<button id="demo-reset" type="button" style="border:1px solid currentColor;background:none;color:inherit;border-radius:8px;padding:2px 10px;font:inherit;cursor:pointer">Reset demo</button></div>\n' +
  '<script>document.getElementById("demo-reset").addEventListener("click",function(){try{fakeGas.reset();localStorage.clear();}catch(e){}location.reload();});</script>\n';

const scripts =
  '<script>\nwindow.FAKE_LATENCY = 150;\n' + read('dev/fake-gas.js') + '\n' + read('waitlist-server/Code.gs') + '\n' + seed + '</script>\n' +
  '<script>\n' + read('docs/vendor/qrcode.js') + '\n</script>\n<script>\n' + read('docs/waitlist/app.js') + '\n</script>';

let html = read('docs/waitlist/index.html')
  .replace('<link rel="stylesheet" href="styles.css">', () => '<style>\n' + read('docs/waitlist/styles.css') + '\n</style>')
  .replace('<script src="app.js"></script>', () => scripts)
  .replace(/<!DOCTYPE html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/g, '')
  .replace(/<\/?head>\s*/g, '')
  .replace(/<(meta|link) [^>]*>\s*/g, '')
  .replace(/<title>[^<]*<\/title>\s*/, '')
  .replace(/<body>\s*/, banner)
  .replace(/<\/body>\s*/, '');
html = '<title>Department Waiting List</title>\n' + html;

const out = path.join(__dirname, 'waitlist-demo.html');
fs.writeFileSync(out, html);
console.log('Wrote ' + path.relative(process.cwd(), out));
