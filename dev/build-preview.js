#!/usr/bin/env node
/*
 * Builds dev/preview.html: the real app (docs/) running against the real Code.gs, with
 * Google Sheets/Drive replaced by an in-browser fake. Open it in any browser to try the UI.
 *   node dev/build-preview.js             -> with sample patients, already connected
 *   node dev/build-preview.js --empty     -> start with no patients
 *   node dev/build-preview.js --artifact  -> dev/demo.html for the hosted demo page
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const artifact = process.argv.includes('--artifact');
const flags = process.argv.includes('--empty') ? 'window.FAKE_SAMPLES = false;\n' : '';

const backend = '<script>\n' + flags + read('dev/fake-gas.js') + '\n' + read('apps-script/Code.gs') + '\n' + read('dev/demo-seed.js') + '\n</script>\n';
const scripts = backend + '<script>\n' + read('docs/vendor/qrcode.js') + '\n</script>\n<script>\n' + read('docs/app.js') + '\n</script>';

let html = read('docs/index.html')
  .replace(/^\s*<link rel="(manifest|icon|apple-touch-icon)"[^>]*>\n/gm, '')
  .replace('<link rel="stylesheet" href="styles.css">', () => '<style>\n' + read('docs/styles.css') + '\n</style>')
  .replace('<script src="app.js"></script>', () => scripts)
  .replace('<title>Surgery Follow-ups</title>', '<title>Surgery Follow-ups (preview)</title>');

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
    .replace(/<meta [^>]*>\s*/g, '')
    .replace(/<title>[^<]*<\/title>\s*/, '')
    .replace(/<body>\s*/, banner)
    .replace(/<\/body>\s*/, '');
  html = '<title>Surgery Follow-ups</title>\n' + html;
}

const out = path.join(__dirname, artifact ? 'demo.html' : 'preview.html');
fs.writeFileSync(out, html);
console.log('Wrote ' + path.relative(process.cwd(), out));
