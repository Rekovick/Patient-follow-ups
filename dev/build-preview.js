#!/usr/bin/env node
/*
 * Builds dev/preview.html: the real app (Index + Styles + Client + Code.gs) running
 * against an in-browser fake of Google Sheets/Drive. Open it in any browser to try the UI.
 *   node dev/build-preview.js            -> with sample patients
 *   node dev/build-preview.js --empty    -> start with no patients
 *   node dev/build-preview.js --artifact -> dev/demo.html for the hosted demo page
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = name => fs.readFileSync(path.join(root, 'apps-script', name), 'utf8');
const dev = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const seed = process.argv.includes('--empty') ? '' : dev('demo-seed.js');

const backend = '<script>\n' + dev('fake-gas.js') + '\n' + src('Code.gs') + '\n' + seed + '\n</script>\n';

let html = src('Index.html')
  .replace(/<\?!=\s*include\('Styles'\);?\s*\?>/, () => src('Styles.html'))
  .replace(/<\?!=\s*include\('Client'\);?\s*\?>/, () => backend + src('Client.html'))
  .replace('<meta charset="utf-8">', '<meta charset="utf-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n    <title>Surgery Follow-ups (preview)</title>');

if (/<\?/.test(html)) throw new Error('Unresolved template tag left in preview');

const artifact = process.argv.includes('--artifact');
if (artifact) {
  // Shape for a hosted demo page: the host supplies doctype/html/head/body, and the title must come first.
  const banner =
    '<div class="demo-banner" style="background:var(--amber-bg);color:var(--amber-fg);font-size:13px;' +
    'padding:8px max(16px, env(safe-area-inset-right, 0px)) 8px max(16px, env(safe-area-inset-left, 0px));' +
    'display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;text-align:center">' +
    '<span><b>Demo</b> with sample patients. Changes are saved only in this browser.</span>' +
    '<button id="demo-reset" type="button" style="border:1px solid currentColor;background:none;color:inherit;' +
    'border-radius:8px;padding:2px 10px;font:inherit;cursor:pointer">Reset demo</button></div>\n' +
    '<script>document.getElementById("demo-reset").addEventListener("click",function(){' +
    'try{fakeGas.reset();localStorage.clear();}catch(e){}location.reload();});</script>\n';
  html = html
    .replace(/<!DOCTYPE html>\s*/i, '')
    .replace(/<\/?html[^>]*>\s*/g, '')
    .replace(/<\/?head>\s*/g, '')
    .replace(/<base[^>]*>\s*/, '')
    .replace(/<meta charset="utf-8">\s*/, '')
    .replace(/<meta name="viewport"[^>]*>\s*/, '')
    .replace(/<title>[^<]*<\/title>\s*/, '')
    .replace(/<body>\s*/, banner)
    .replace(/<\/body>\s*/, '');
  html = '<title>Surgery Follow-ups</title>\n' + html;
}

const out = path.join(__dirname, artifact ? 'demo.html' : 'preview.html');
fs.writeFileSync(out, html);
console.log('Wrote ' + path.relative(process.cwd(), out));
