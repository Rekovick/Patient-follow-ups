#!/usr/bin/env node
/*
 * Builds dev/preview.html: the real app (Index + Styles + Client + Code.gs) running
 * against an in-browser fake of Google Sheets/Drive. Open it in any browser to try the UI.
 *   node dev/build-preview.js            -> with sample patients
 *   node dev/build-preview.js --empty    -> start with no patients
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
const out = path.join(__dirname, 'preview.html');
fs.writeFileSync(out, html);
console.log('Wrote ' + path.relative(process.cwd(), out));
