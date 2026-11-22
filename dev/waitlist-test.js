#!/usr/bin/env node
/*
 * End-to-end test of the Department Waiting List with two phones sharing one list.
 *   node dev/waitlist-test.js [screenshot-dir]
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { start } = require('./waitlist-server.js');

const shots = process.argv[2] || path.join(__dirname, 'screenshots');
fs.mkdirSync(shots, { recursive: true });

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('  ok - ' + msg);
}

(async () => {
  const srv = await start(0);
  const appUrl = srv.url + '/Patient-follow-ups/waitlist/';
  const browser = await chromium.launch();
  const errors = [];
  async function phone() {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    return { ctx, page };
  }
  const shot = (page, name) => page.screenshot({ path: path.join(shots, name + '.png') });
  const syncNow = async page => {
    await page.click('#sync');
    await page.waitForFunction(() => !document.querySelector('#sync.syncing'));
  };
  const cardCount = page => page.locator('.card').count();

  console.log('Owner sets up the list');
  const A = await phone();
  await A.page.goto(appUrl);
  await A.page.click('details summary');
  await A.page.fill('#o-team', 'Neurosurgery');
  await A.page.fill('#o-url', srv.url + '/exec');
  await A.page.fill('#o-key', srv.key);
  await A.page.fill('#o-name', 'Dr Ahmed');
  await A.page.click('form[data-form="owner"] button');
  await A.page.waitForSelector('.empty');
  assert((await A.page.textContent('.head h1')).includes('Neurosurgery'), 'owner connected; list name shown');

  console.log('Adding cases');
  const add = async (page, c) => {
    await page.click('[data-act="add"]');
    await page.fill('#f-name', c.name);
    if (c.phone) await page.fill('#f-phone', c.phone);
    if (c.dx) await page.fill('#f-dx', c.dx);
    if (c.hospital) await page.selectOption('#f-hosp', c.hospital);
    if (c.urgent) await page.check('input[name="urgent"]');
    await page.click('form[data-form="case"] button[type="submit"]');
  };
  await add(A.page, { name: 'Mahmoud Ali', phone: '01012345678', dx: 'L4-L5 disc', hospital: 'El Sahel' });
  assert(await cardCount(A.page) === 1, 'case shows immediately, before the server answers');
  await add(A.page, { name: 'Hoda Samir', phone: '٠١١٢٢٣٣٤٤٥٥', dx: 'Meningioma', urgent: true });
  await A.page.waitForFunction(() => document.querySelector('#sync').className.includes('ok'));
  const firstName = await A.page.textContent('.card h3');
  assert(firstName === 'Hoda Samir', 'urgent case goes to the top of the list');
  assert((await A.page.textContent('.card .pos')) === '#1', 'cards show their place in the queue');
  const wa = await A.page.getAttribute('.card .round.wa', 'href');
  const tel = await A.page.getAttribute('.card .round.call', 'href');
  assert(wa === 'https://wa.me/201122334455' && tel === 'tel:+201122334455', 'call and WhatsApp use +20 (Arabic digits accepted): ' + wa);
  const stored = srv.backend.api.doPost({ postData: { contents: JSON.stringify({ key: srv.key, fn: 'sync', args: [''] }) } }).getContent();
  assert(JSON.parse(stored).result.cases.some(c => c.phone === '01122334455' && c.createdBy === 'Dr Ahmed'), 'saved in the Sheet with leading zero and the author’s name');
  await shot(A.page, 'w1-list');

  console.log('A colleague joins with the invite link');
  await A.page.click('[data-act="menu"]');
  await A.page.waitForSelector('.qr svg');
  const share = await A.page.getAttribute('.sheet a.wa', 'href');
  const invite = decodeURIComponent(share.split('text=')[1]).split(': ').pop();
  assert(/#join=[\w-]+$/.test(invite), 'invite link with QR code and WhatsApp share');
  await shot(A.page, 'w2-invite');
  await A.page.click('.sheet [data-close]');
  const B = await phone();
  await B.page.goto(invite);
  await B.page.waitForSelector('form[data-form="join"]');
  assert((await B.page.textContent('.join h2')) === 'Join Neurosurgery', 'join screen names the list');
  assert(!(await B.page.evaluate(() => location.hash)), 'the key is removed from the address bar');
  await shot(B.page, 'w3-join');
  await B.page.fill('#j-name', 'Dr Sara');
  await B.page.click('form[data-form="join"] button');
  await B.page.waitForSelector('.card');
  assert(await cardCount(B.page) === 2, 'colleague sees the whole list');

  console.log('Sync between phones');
  await B.page.click('.card:has-text("Mahmoud Ali") [data-act="status"]');
  await B.page.click('.sheet [data-value="Labs"]');
  await B.page.waitForFunction(() => document.querySelector('#sync').className.includes('ok'));
  await syncNow(A.page);
  assert((await A.page.textContent('.card:has-text("Mahmoud Ali") .badge')) === 'Labs', 'status changed on one phone shows on the other');
  // Two people edit different fields of the same case at the same time: both changes survive.
  await A.page.click('.card:has-text("Hoda Samir")');
  await A.page.fill('#f-note', 'MRI booked Sunday');
  await B.page.click('.card:has-text("Hoda Samir")');
  await B.page.selectOption('#f-cons', 'Dr Alaa Ahmed');
  await A.page.click('form[data-form="case"] button[type="submit"]');
  await B.page.click('form[data-form="case"] button[type="submit"]');
  await A.page.waitForFunction(() => document.querySelector('#sync').className.includes('ok'));
  await B.page.waitForFunction(() => document.querySelector('#sync').className.includes('ok'));
  await syncNow(A.page);
  await syncNow(B.page);
  for (const p of [A.page, B.page]) {
    const t = await p.textContent('.card:has-text("Hoda Samir")');
    assert(t.includes('MRI booked Sunday') && t.includes('Dr Alaa Ahmed'), 'both edits to the same case are kept');
  }

  console.log('No signal');
  await B.ctx.setOffline(true);
  await add(B.page, { name: 'Offline Patient', phone: '01599998888' });
  await B.page.waitForFunction(() => document.querySelector('#sync').textContent.includes('1 to send'));
  assert((await B.page.textContent('.card:has-text("Offline Patient") .by')).includes('not sent yet'), 'case added offline is kept and marked “not sent yet”');
  await shot(B.page, 'w4-offline');
  await B.page.reload().catch(() => {});
  await B.ctx.setOffline(false);
  await B.page.goto(appUrl);
  await B.page.waitForFunction(() => document.querySelector('#sync').className.includes('ok') && !document.querySelector('.card.pending'));
  await syncNow(A.page);
  assert(await A.page.locator('.card:has-text("Offline Patient")').count() === 1, 'it is sent when the signal returns (even after closing the app)');

  console.log('Search, filters, delete');
  await A.page.fill('#q', '٠١٥٩٩');
  assert(await cardCount(A.page) === 1, 'search by phone digits');
  await A.page.fill('#q', '');
  await A.page.click('[data-key="urgent"]');
  assert(await cardCount(A.page) === 1, 'Urgent filter');
  await A.page.click('[data-key="mine"]');
  assert(await cardCount(A.page) === 2, '“Added by me” filter');
  await A.page.click('[data-key="active"]');
  await A.page.click('.card:has-text("Mahmoud Ali")');
  await A.page.click('[data-act="delete"]');
  await A.page.click('.sheet [data-yes]');
  await A.page.waitForFunction(() => document.querySelector('#sync').className.includes('ok'));
  await syncNow(B.page);
  assert(await B.page.locator('.card:has-text("Mahmoud Ali")').count() === 0, 'a deleted case disappears from every phone');

  console.log('Installable app');
  const cdp = await A.ctx.newCDPSession(A.page);
  await A.page.reload();
  await A.page.evaluate(() => navigator.serviceWorker.ready);
  const inst = await cdp.send('Page.getInstallabilityErrors');
  assert(inst.installabilityErrors.length === 0, 'Chrome reports it installable: ' + JSON.stringify(inst.installabilityErrors));
  assert(await A.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'fits a phone screen');
  await A.ctx.setOffline(true);
  await A.page.reload();
  assert(await A.page.locator('.card').count() >= 1, 'opens with no signal, showing the saved list');
  await A.ctx.setOffline(false);
  await A.page.emulateMedia({ colorScheme: 'dark' });
  await shot(A.page, 'w5-dark');

  console.log('Speed and security');
  const quiet = JSON.parse(srv.backend.api.doPost({ postData: { contents: JSON.stringify({ key: srv.key, fn: 'sync', args: [new Date(Date.now() + 1000).toISOString()] }) } }).getContent());
  assert(quiet.ok && quiet.result.cases.length === 0 && !quiet.result.lists, 'a sync with nothing new is answered without opening the Sheet');
  const bad = JSON.parse(srv.backend.api.doPost({ postData: { contents: JSON.stringify({ key: 'x'.repeat(64), fn: 'sync', args: [''] }) } }).getContent());
  assert(!bad.ok && bad.error === 'ACCESS_DENIED', 'a wrong key is refused');
  const sneaky = JSON.parse(srv.backend.api.doPost({ postData: { contents: JSON.stringify({ key: srv.key, fn: 'resetTeamKey', args: [] }) } }).getContent());
  assert(!sneaky.ok, 'editor-only functions cannot be called through the web');
  srv.backend.api.resetTeamKey();
  await syncNow(B.page);
  await B.page.waitForSelector('form[data-form="join"]');
  assert((await B.page.textContent('.join')).includes('no longer works'), 'after the owner resets the key, old links stop working');

  assert(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  srv.server.close();
  console.log('\nAll checks passed. Screenshots in ' + shots);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
