#!/usr/bin/env node
/* Renders the app icons in docs/icons/ from one SVG design (needs Playwright). */
const path = require('path');
const { chromium } = require('playwright');

const glyph = scale => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round">
    <path d="M86 276h86l38-96 64 190 46-120 26 26h80" stroke-width="34"/>
    <path d="M376 104v72M340 140h72" stroke-width="26"/>
  </g>`;
const svg = (full, scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#14998e"/><stop offset="1" stop-color="#0b5f58"/></linearGradient></defs>
  ${full ? '<rect width="512" height="512" fill="url(#g)"/>' : '<rect x="16" y="16" width="480" height="480" rx="112" fill="url(#g)"/>'}
  ${glyph(scale)}</svg>`;

const ICONS = [
  { file: 'icon-192.png', size: 192, full: false, scale: 1 },
  { file: 'icon-512.png', size: 512, full: false, scale: 1 },
  { file: 'maskable-512.png', size: 512, full: true, scale: 0.72 },
  { file: 'apple-touch-icon.png', size: 180, full: true, scale: 0.86 },
];

(async () => {
  const browser = await chromium.launch();
  for (const ic of ICONS) {
    const page = await browser.newPage({ viewport: { width: ic.size, height: ic.size } });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(ic.full, ic.scale).replace('<svg ', `<svg width="${ic.size}" height="${ic.size}" `)}</body></html>`);
    await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'icons', ic.file), omitBackground: true });
    await page.close();
  }
  await browser.close();
  console.log('Icons written to docs/icons/');
})();
