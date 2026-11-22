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

// 1x1 PNG used as a "camera" photo.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
const pic = n => ({ name: n + '.png', mimeType: 'image/png', buffer: PNG });

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('  ok - ' + msg);
}

(async () => {
  const srv = await start(0);
  const appUrl = srv.url + '/Patient-follow-ups/waitlist/';
  const server = (fn, args) => JSON.parse(srv.backend.api.doPost({ postData: { contents: JSON.stringify({ key: srv.key, user: 'test', fn: fn, args: args || [] }) } }).getContent());
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
  const synced = page => page.waitForFunction(() => {
    const s = document.querySelector('#sync');
    return (!s || s.className.includes('ok')) && document.getElementById('upload-bar') && document.getElementById('upload-bar').hidden;
  });
  const syncNow = async page => {
    if (!(await page.locator('#sync').count())) { await page.click('[data-act="back"]'); await page.waitForSelector('#sync'); }
    await page.click('#sync');
    await page.waitForFunction(() => !document.querySelector('#sync.syncing'));
  };
  const cardCount = page => page.locator('.card').count();
  const openCase = async (page, name) => {
    // Done cases leave the Active list; look under Done for them.
    if (!(await page.locator('.card:has-text("' + name + '")').count())) await page.click('[data-key="s:Done"]');
    await page.click('.card:has-text("' + name + '") h3');
    await page.waitForSelector('.hero');
  };

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
  assert(await A.page.locator('#f-hosp, #f-cons').count() === 0, 'no hospital or consultant fields');

  console.log('Adding cases with photos');
  const add = async (page, c) => {
    await page.click('[data-act="add"]');
    await page.fill('#f-name', c.name);
    if (c.phone) await page.fill('#f-phone', c.phone);
    if (c.dx) await page.fill('#f-dx', c.dx);
    if (c.urgent) await page.check('input[name="urgent"]');
    if (c.decision) {
      await page.setInputFiles('form #draft-decision input[capture]', pic('decision'));
      await page.waitForSelector('#draft-decision .photo img');
    }
    if (c.preop) {
      await page.setInputFiles('form #draft-preop input[multiple]', c.preop.map(pic));
      await page.waitForFunction(n => document.querySelectorAll('#draft-preop .photo img').length === n, c.preop.length);
    }
    await page.click('form[data-form="case"] button[type="submit"]');
  };
  await add(A.page, { name: 'Mahmoud Ali', phone: '01012345678', dx: 'L4-L5 disc' });
  await A.page.waitForSelector('.hero');
  assert((await A.page.textContent('.hero h2')) === 'Mahmoud Ali', 'a new case opens its page straight away');
  await A.page.click('[data-act="back"]');
  await A.page.waitForSelector('.card');
  await add(A.page, { name: 'Hoda Samir', phone: '٠١١٢٢٣٣٤٤٥٥', dx: 'Meningioma', urgent: true, decision: true, preop: ['p1', 'p2'] });
  await A.page.waitForSelector('.hero');
  assert(await A.page.locator('.photo.uploading').count() >= 1, 'photos show at once, uploading in the background');
  await synced(A.page);
  await A.page.waitForFunction(() => document.querySelectorAll('.photo img[data-fid]').length === 3);
  assert(true, 'decision + 2 pre-op photos uploaded');
  assert(await A.page.locator('.panel.locked:has-text("Post-op")').count() === 1, 'post-op photos wait until the case is Done');
  await shot(A.page, 'w6-case');
  const saved = server('sync', ['']).result.cases.find(c => c.name === 'Hoda Samir');
  assert(saved.phone === '01122334455' && saved.photos.decision.length === 1 && saved.photos.preop.length === 2 && saved.folderId,
    'saved in the Sheet with leading zero, photos in its own Drive folder');
  await A.page.click('[data-act="back"]');
  await A.page.waitForSelector('.card');
  assert((await A.page.textContent('.card h3')) === 'Hoda Samir', 'urgent case goes to the top of the list');
  assert((await A.page.textContent('.card .pics')).trim() === '3', 'card shows how many photos the case has');
  const wa = await A.page.getAttribute('.card .round.wa', 'href');
  assert(wa === 'https://wa.me/201122334455', 'WhatsApp uses +20 (Arabic digits accepted)');
  await shot(A.page, 'w1-list');

  console.log('A colleague joins with the invite link');
  await A.page.click('[data-act="menu"]');
  await A.page.waitForSelector('.qr svg');
  const share = await A.page.getAttribute('.sheet a.wa', 'href');
  const invite = decodeURIComponent(share.split('text=')[1]).split(': ').pop();
  await A.page.click('.sheet [data-close]');
  const B = await phone();
  await B.page.goto(invite);
  await B.page.fill('#j-name', 'Dr Sara');
  await B.page.click('form[data-form="join"] button');
  await B.page.waitForSelector('.card');
  assert(await cardCount(B.page) === 2, 'colleague sees the whole list');
  await openCase(B.page, 'Hoda Samir');
  await B.page.waitForFunction(() => Array.from(document.querySelectorAll('.photo img[data-fid]')).filter(i => i.src.startsWith('data:image')).length === 3);
  assert(true, 'colleague sees the photos');
  await B.page.click('.photo >> nth=0');
  await B.page.waitForFunction(() => document.querySelector('.viewer img') && !document.querySelector('.viewer .spin'));
  assert(true, 'tapping a photo opens it full screen');
  await shot(B.page, 'w7-viewer');
  await B.page.click('[data-act="viewer-close"]');

  console.log('Sync between phones');
  await B.page.click('.statuses [data-value="Done"]');
  await synced(B.page);
  assert(await B.page.locator('h3:has-text("Post-op photos")').count() === 1 && !(await B.page.locator('.panel.locked').count()), 'marking Done unlocks post-op photos');
  await B.page.setInputFiles('input[data-photo-kind="postop"][multiple]', [pic('post1'), pic('post2')]);
  await B.page.waitForFunction(() => document.querySelectorAll('.photo img[data-fid]').length === 5);
  await synced(B.page);
  await syncNow(A.page);
  await openCase(A.page, 'Hoda Samir');
  assert((await A.page.textContent('.hero .badge')) === 'Done', 'status changed on one phone shows on the other');
  await A.page.waitForFunction(() => document.querySelectorAll('.photo img[data-fid]').length === 5);
  assert(true, 'post-op photos added on one phone show on the other');
  // Two people edit different fields of the same case at the same time: both changes survive.
  await A.page.click('.head [data-act="edit"]');
  await A.page.fill('#f-note', 'MRI booked Sunday');
  await B.page.click('.head [data-act="edit"]');
  await B.page.fill('#f-dx', 'Parasagittal meningioma');
  await A.page.click('form[data-form="case"] button[type="submit"]');
  await B.page.click('form[data-form="case"] button[type="submit"]');
  await synced(A.page);
  await synced(B.page);
  for (const p of [A.page, B.page]) {
    await syncNow(p);
    await openCase(p, 'Hoda Samir');
    const t = await p.textContent('.hero');
    assert(t.includes('MRI booked Sunday') && t.includes('Parasagittal meningioma'), 'both edits to the same case are kept');
  }

  console.log('No signal');
  await B.page.click('[data-act="back"]');
  await B.ctx.setOffline(true);
  await add(B.page, { name: 'Offline Patient', phone: '01599998888', decision: true });
  await B.page.waitForSelector('.hero');
  await B.page.waitForFunction(() => (document.getElementById('upload-bar').textContent || '').includes('waiting for signal'));
  assert(true, 'a photo taken with no signal waits, and says so');
  await shot(B.page, 'w4-offline');
  await B.ctx.setOffline(false);
  await B.page.evaluate(() => window.dispatchEvent(new Event('online')));
  await synced(B.page);
  await B.page.waitForFunction(() => document.querySelectorAll('.photo img[data-fid]').length === 1);
  const off = server('sync', ['']).result.cases.find(c => c.name === 'Offline Patient');
  assert(off && off.photos.decision.length === 1, 'case and photo are sent when the signal returns');

  console.log('Delete');
  await B.page.click('.photo >> nth=0');
  await B.page.click('[data-act="viewer-delete"]');
  await B.page.click('.sheet [data-yes]');
  await B.page.waitForFunction(() => !document.querySelector('.viewer') && !document.querySelector('.photo img[data-fid]'));
  assert(server('sync', ['']).result.cases.find(c => c.name === 'Offline Patient').photos.decision.length === 0, 'a photo can be deleted');
  await syncNow(A.page);
  await A.page.click('[data-key="active"]');
  await openCase(A.page, 'Mahmoud Ali');
  await A.page.click('.page [data-act="delete"]');
  await A.page.click('.sheet [data-yes]');
  await A.page.waitForSelector('.card');
  await synced(A.page);
  await syncNow(B.page);
  assert(await B.page.locator('.card:has-text("Mahmoud Ali")').count() === 0, 'a deleted case disappears from every phone');

  console.log('Search and filters');
  await A.page.click('[data-key="active"]');
  await A.page.fill('#q', '٠١٥٩٩');
  await A.page.waitForFunction(() => document.querySelectorAll('.card').length === 1);
  assert(true, 'search by phone digits');
  await A.page.fill('#q', '');
  await A.page.click('[data-key="mine"]');
  assert(await cardCount(A.page) === 0, '“Added by me” leaves out done cases and colleagues’ cases');
  await A.page.click('[data-key="s:Done"]');
  assert(await cardCount(A.page) === 1, 'status filter');
  await A.page.click('[data-key="active"]');

  console.log('Installable, light, offline');
  const cdp = await A.ctx.newCDPSession(A.page);
  await A.page.reload();
  await A.page.evaluate(() => navigator.serviceWorker.ready);
  const inst = await cdp.send('Page.getInstallabilityErrors');
  assert(inst.installabilityErrors.length === 0, 'Chrome reports it installable');
  await A.page.emulateMedia({ colorScheme: 'dark' });
  const bg = await A.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert(bg === 'rgb(244, 246, 250)', 'stays light even when the phone is in dark mode (' + bg + ')');
  assert(await A.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'fits a phone screen');
  await A.ctx.setOffline(true);
  await A.page.reload();
  await openCase(A.page, 'Hoda Samir');
  await A.page.waitForFunction(() => Array.from(document.querySelectorAll('.photo img[data-fid]')).filter(i => i.src.startsWith('data:image')).length === 5);
  assert(true, 'opens with no signal, photos included');
  await A.ctx.setOffline(false);

  console.log('Speed and security');
  const quiet = server('sync', [new Date(Date.now() + 1000).toISOString()]);
  assert(quiet.ok && quiet.result.cases.length === 0 && !quiet.result.lists, 'a sync with nothing new is answered without opening the Sheet');
  const bad = JSON.parse(srv.backend.api.doPost({ postData: { contents: JSON.stringify({ key: 'x'.repeat(64), fn: 'sync', args: [''] }) } }).getContent());
  assert(!bad.ok && bad.error === 'ACCESS_DENIED', 'a wrong key is refused');
  assert(!server('resetTeamKey').ok && !server('setup').ok, 'editor-only functions cannot be called through the web');
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
