#!/usr/bin/env node
/*
 * End-to-end smoke test of the preview build in headless Chromium (phone-sized).
 *   node dev/build-preview.js && node dev/smoke-test.js [screenshot-dir]
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const shots = process.argv[2] || path.join(__dirname, 'screenshots');
fs.mkdirSync(shots, { recursive: true });

// 1x1 red PNG used as a "camera" photo.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('  ok - ' + msg);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('popup', p => p.close());

  await page.goto('file://' + path.join(__dirname, 'preview.html'));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('.card');
  const shot = name => page.screenshot({ path: path.join(shots, name + '.png'), fullPage: false });

  console.log('Home');
  assert(await page.locator('.card').count() === 4, 'four sample patients listed');
  const firstWa = await page.locator('.card .round.wa').first().getAttribute('href');
  assert(/^https:\/\/wa\.me\/201\d{9}$/.test(firstWa), 'WhatsApp link uses +20 prefix: ' + firstWa);
  const firstTel = await page.locator('.card .phone').first().getAttribute('href');
  assert(/^tel:\+201\d{9}$/.test(firstTel), 'phone number is a call link: ' + firstTel);
  await shot('01-home');

  await page.fill('#q', 'فاطمه');
  await page.waitForTimeout(250);
  assert(await page.locator('.card').count() === 1, 'Arabic search ignores ة/ه difference');
  await page.fill('#q', '+20 15987');
  await page.waitForTimeout(250);
  assert(await page.locator('.card').count() === 1, 'search by phone in international form');
  await page.fill('#q', '');
  await page.waitForTimeout(250);
  await page.click('.chip[data-value="Ready for surgery"]');
  assert(await page.locator('.card').count() === 1, 'status chip filters list');
  await page.click('.chip[data-value="Ready for surgery"]');

  console.log('Wizard');
  await page.click('[data-act="new"]');
  await page.click('.option[data-value="El Mabara"]');
  await page.waitForSelector('.option[data-value="Dr Ahmed Elghity"]');
  await shot('02-wizard-consultant');
  await page.click('.option[data-value="Dr Ahmed Elghity"]');
  await page.waitForSelector('#f-name');
  await page.fill('#f-name', 'Test Patient');
  await page.fill('#f-phone', '٠١٠١٢٣٤٥٦٧٨');
  assert(await page.locator('#phone-warn .warn').count() === 1, 'duplicate phone (typed in Arabic digits) is detected');
  await page.fill('#f-phone', '01055554444');
  assert(await page.locator('#phone-warn .warn').count() === 0, 'valid unique phone shows no warning');
  await page.fill('#f-age', '40');
  await shot('03-wizard-contact');
  await page.click('[data-act="wiz-next"]');
  await page.setInputFiles('input[data-photo-kind="decision"][capture]', { name: 'decision.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector('.wizard .photo img');
  await shot('04-wizard-decision');
  await page.click('[data-act="wiz-next"]');
  await page.setInputFiles('input[data-photo-kind="preop"][multiple]', [
    { name: 'a.png', mimeType: 'image/png', buffer: PNG },
    { name: 'b.png', mimeType: 'image/png', buffer: PNG },
  ]);
  await page.waitForFunction(() => document.querySelectorAll('.wizard .photo img').length === 2);
  await page.click('[data-act="wiz-next"]');
  await page.check('input[data-anes-item="CBC"]');
  await page.check('input[data-anes-item="ECG"]');
  await page.selectOption('select[data-anes="asa"]', 'ASA II');
  await shot('05-wizard-anesthesia');
  await page.click('[data-act="wiz-next"]');
  // Add a new classification on the fly
  await page.click('[data-act="add-list-item"]');
  await page.fill('.sheet input', 'Trauma');
  await page.click('.sheet button[type="submit"]');
  await page.waitForSelector('.option.on[data-value="Trauma"]');
  assert(true, 'new classification added and selected');
  await page.click('[data-act="wiz-next"]');
  await page.waitForSelector('#f-hint');
  await page.fill('#f-hint', 'Needs cardiology clearance');
  await page.click('[data-act="wiz-next"]');
  await page.click('.option[data-value="Waiting for labs"]');
  await shot('06-wizard-status');
  await page.click('[data-act="wiz-save"]');
  await page.waitForSelector('.hero');
  await page.waitForFunction(() => !document.querySelector('.busy'));

  console.log('Patient page');
  assert(await page.locator('#upload-bar:not([hidden])').count() === 1, 'patient page opens at once while photos upload in the background');
  await page.waitForFunction(() => document.querySelectorAll('.photo img').length === 3 && document.getElementById('upload-bar').hidden, null, { timeout: 8000 });
  assert(true, 'decision + 2 pre-op photos uploaded');
  const folders = await page.evaluate(() => {
    const db = fakeGas.db();
    return Object.values(db.files).filter(f => f.folder && /^Test Patient \(/.test(f.name)).length;
  });
  assert(folders === 1, 'all photos went into one Drive folder');
  assert((await page.locator('.hero .hint').textContent()).includes('cardiology'), 'hint shown');
  assert(await page.locator('input[data-anes-item]:checked').count() === 2, 'anesthesia ticks saved');
  await shot('07-patient');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'patient page fits phone width');
  await page.check('input[data-anes-item="Chest X-ray"]');
  await page.waitForTimeout(700);
  await page.click('.chip[data-act="set-status"][data-value="Done"]');
  await page.waitForTimeout(700);
  assert(await page.locator('h2:has-text("Post-op photos")').count() === 1, 'post-op section unlocked when Done');
  await page.setInputFiles('input[data-photo-kind="postop"][multiple]', ['p1', 'p2', 'p3', 'p4'].map(n => ({ name: n + '.png', mimeType: 'image/png', buffer: PNG })));
  await page.waitForFunction(() => document.querySelectorAll('.photo img').length === 7, null, { timeout: 8000 });
  assert(await page.evaluate(() => getPatients_().find(x => x.name === 'Test Patient').photos.postop.length) === 4, 'four post-op photos uploaded, none lost');
  await page.fill('#note-text', 'Wound clean, follow up in 1 week');
  await page.click('[data-act="add-note"]');
  await page.waitForSelector('.note');
  assert((await page.locator('.note .tag').first().textContent()) === 'Post-op', 'note tagged post-op');
  assert(await page.locator('.timeline li').count() === 2, 'timeline shows creation + status change');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await shot('08-patient-postop');

  await page.click('.photo >> nth=0');
  await page.waitForSelector('.viewer img');
  await shot('09-viewer');
  await page.click('[data-act="viewer-close"]');

  await page.click('.contact [data-act="templates"]');
  await page.waitForSelector('.sheet .template');
  await page.waitForTimeout(400);
  const tpl = await page.locator('.sheet a.template').first().getAttribute('href');
  assert(tpl.startsWith('https://wa.me/201055554444?text='), 'template opens WhatsApp chat with text');
  await shot('10-templates');
  await page.click('.sheet [data-close]');

  console.log('Persistence (re-open the app)');
  await page.reload();
  await page.waitForSelector('.card');
  assert(await page.locator('.card').count() === 5, 'new patient persisted');
  const sheetRow = await page.evaluate(() => {
    const p = getPatients_().find(x => x.name === 'Test Patient');
    return { phone: p.phone, status: p.status, cls: p.classification, photos: p.photos.decision.length + p.photos.preop.length + p.photos.postop.length, items: Object.keys(p.anesthesia.items).length };
  });
  assert(sheetRow.phone === '01055554444', 'phone stored with leading zero');
  assert(sheetRow.status === 'Done' && sheetRow.cls === 'Trauma', 'status + classification stored');
  assert(sheetRow.photos === 7 && sheetRow.items === 3, 'photos + anesthesia stored');

  console.log('Settings');
  await page.click('[data-act="settings"]');
  await page.fill('form[data-list="statuses"] input', 'Postponed');
  await page.click('form[data-list="statuses"] button');
  assert(await page.locator('[data-act="set-del"][data-list="statuses"][disabled]').count() === 1, '“Done” cannot be removed');
  await page.click('[data-act="set-save"]');
  await page.waitForFunction(() => !document.querySelector('.busy'));
  await shot('11-settings');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'settings page fits phone width');
  await page.click('[data-act="back"]');
  await page.waitForSelector('.chip[data-value="Postponed"]');
  assert(true, 'new status appears on home');

  console.log('Edit + delete');
  await page.click('.card:has-text("Ahmed Mahmoud")');
  await page.click('.topbar [data-act="edit"]');
  await page.fill('#e-phone', '+20 100 111 2222');
  await page.click('[data-act="edit-save"]');
  await page.waitForSelector('.hero');
  assert((await page.locator('.contact .phone').textContent()) === '010 0111 2222', 'edited phone normalised to local format');
  await page.click('[data-act="delete-patient"]');
  await page.click('.sheet [data-ok]');
  await page.waitForSelector('.card');
  assert(await page.locator('.card').count() === 4, 'patient deleted');

  console.log('Security (server API)');
  const api = (key, fn, args) => page.evaluate(([k, f, a]) =>
    fetch('fake:server', { method: 'POST', body: JSON.stringify({ key: k, fn: f, args: a || [] }) }).then(r => r.json()), [key, fn, args]);
  const ownerKey = await page.evaluate(() => window.FAKE_OWNER_KEY);
  let r = await api('wrong-key-wrong-key-wrong-key-wrong-key', 'getBootstrap');
  assert(!r.ok && r.error === 'ACCESS_DENIED', 'wrong key is refused');
  r = await api(undefined, 'getPatients');
  assert(!r.ok && r.error === 'ACCESS_DENIED', 'missing key is refused');
  r = await api(ownerKey, 'setup');
  assert(!r.ok && /Unknown action/.test(r.error), 'editor-only functions cannot be called remotely');
  r = await api(ownerKey, 'getPatients');
  assert(r.ok && r.result.length === 4, 'owner key reads patients');

  r = await api(ownerKey, 'getBootstrap');
  assert(r.ok && r.result.serverVersion === 2, 'server reports version 2');

  console.log('Recovering photos lost by the old upload bug');
  const recovered = await page.evaluate(() => {
    const store = openStore_();
    const p = getPatients_().find(x => x.photos.postop.length);
    const before = p.photos.postop.length;
    // A photo that reached Drive but was never written to the sheet, plus its thumbnail.
    const file = DriveApp.getFolderById(p.folderId).createFile(Utilities.newBlob({ __b64: 'iVBORw0KGgo=' }, 'image/jpeg', 'postop 2026-10-26 101500.jpg'));
    DriveApp.getFolderById(store.ids.THUMBS_FOLDER_ID).createFile(Utilities.newBlob({ __b64: 'iVBORw0KGgo=' }, 'image/jpeg', p.id + ' postop 2026-10-26 101500.jpg'));
    setup();
    const after = getPatients_().find(x => x.id === p.id).photos.postop;
    const again = recoverPhotos_(store);
    return { added: after.length - before, last: after[after.length - 1], fileId: file.getId(), again: again };
  });
  assert(recovered.added === 1 && recovered.last.id === recovered.fileId && recovered.last.thumbId, 'setup re-adds a photo found in Drive, with its thumbnail');
  assert(recovered.again === 0, 'running it again adds nothing twice');

  console.log('People with access');
  await page.click('[data-act="settings"]');
  await page.waitForSelector('[data-act="add-person"]');
  await page.click('[data-act="add-person"]');
  await page.fill('.sheet input', 'Dr Sara');
  await page.click('.sheet button[type="submit"]');
  await page.waitForSelector('.sheet .qr svg');
  const link = await page.inputValue('#connect-link');
  assert(/#connect=[\w-]+$/.test(link), 'connect link with QR code created');
  await shot('13-add-person');
  await page.click('.sheet [data-close]');
  const saraKey = await page.evaluate(() => readPeople_().find(p => p.name === 'Dr Sara').key);
  r = await api(saraKey, 'getBootstrap');
  assert(r.ok && r.result.user === 'Dr Sara' && r.result.isAdmin === false, 'colleague key works and is not owner');
  r = await api(saraKey, 'listPeople');
  assert(!r.ok && /Only the owner/.test(r.error), 'colleague cannot manage access');
  r = await api(saraKey, 'addNote', [r.ok ? '' : (await api(ownerKey, 'getPatients')).result[0].id, 'Seen in clinic']);
  assert(r.ok && r.result.notes.slice(-1)[0].by === 'Dr Sara', 'changes are signed with the colleague’s name');
  await page.click('[data-act="remove-person"][data-name="Dr Sara"]');
  await page.click('.sheet [data-ok]');
  await page.waitForFunction(() => !document.querySelector('[data-act="remove-person"]'));
  r = await api(saraKey, 'getBootstrap');
  assert(!r.ok && r.error === 'ACCESS_DENIED', 'removed person is locked out');

  console.log('Connect / disconnect');
  await page.click('[data-act="disconnect"]');
  await page.click('.sheet [data-ok]');
  await page.waitForSelector('form[data-form="connect"]');
  assert(await page.evaluate(() => !localStorage.getItem('surgery-followups.cache.v1')), 'disconnect removes patient data from the device');
  await shot('14-connect');
  await page.fill('#c-url', 'fake:server');
  await page.fill('#c-key', 'not-the-key-not-the-key-not-the-key');
  await page.click('form[data-form="connect"] button');
  await page.waitForTimeout(800);
  assert(await page.locator('form[data-form="connect"]').count() === 1, 'wrong key does not connect');
  await page.fill('#c-key', ownerKey);
  await page.click('form[data-form="connect"] button');
  await page.waitForSelector('.card');
  assert(true, 'connects with server link + key');
  // Connect link opened on a "new" device
  await page.evaluate(() => localStorage.removeItem('surgery-followups.connection.v1'));
  const ownLink = await page.evaluate(k => location.href.split('#')[0] + '#connect=' +
    btoa(JSON.stringify({ u: 'fake:server', k: k })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), ownerKey);
  await page.goto(ownLink);
  await page.waitForFunction(() => !location.hash && document.querySelector('.card'));
  assert(!(await page.evaluate(() => location.hash)), 'connect link connects and is removed from the address bar');

  await page.emulateMedia({ colorScheme: 'dark' });
  await shot('12-home-dark');

  assert((await page.evaluate(() => fakeGasLockViolations.length)) === 0, 'every change is saved before the lock is released');
  assert(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log('\nAll checks passed. Screenshots in ' + shots);
})().catch(async e => {
  console.error(e);
  process.exit(1);
});
