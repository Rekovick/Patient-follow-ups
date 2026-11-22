#!/usr/bin/env node
/*
 * Checks that the two apps on the GitHub Pages site stay separate apps:
 * distinct manifest ids, scopes that don't overlap, the old address redirecting to app/,
 * and the retired root offline helper cleaning up after itself.
 *   node dev/site-test.js
 */
const { chromium } = require('playwright');
const { start } = require('./waitlist-server.js');

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
  console.log('  ok - ' + msg);
}

/** App identity as Chrome computes it: "id" resolved against the start_url's origin (start_url when absent). */
function appIdentity(manifest, manifestUrl) {
  const startUrl = new URL(manifest.start_url || './', manifestUrl);
  return manifest.id ? new URL(manifest.id, startUrl.origin).href : startUrl.href;
}

(async () => {
  const srv = await start(0);
  const base = srv.url + '/Patient-follow-ups/';
  const browser = await chromium.launch();
  const errors = [];

  console.log('Two separate apps');
  const apps = [];
  for (const dir of ['app/', 'waitlist/']) {
    const url = base + dir + 'manifest.webmanifest';
    const manifest = await (await fetch(url)).json();
    apps.push({ dir, id: appIdentity(manifest, url), scope: new URL(manifest.scope || './', url).href, start: new URL(manifest.start_url, url).href });
  }
  assert(apps[0].id !== apps[1].id, 'different app ids: ' + apps.map(a => a.id.replace(srv.url, '')).join(' vs '));
  assert(!apps[0].scope.startsWith(apps[1].scope) && !apps[1].scope.startsWith(apps[0].scope),
    'neither app’s area contains the other: ' + apps.map(a => a.scope.replace(srv.url, '')).join(' vs '));
  apps.forEach(a => assert(a.start.startsWith(a.scope), a.dir + ' starts inside its own area'));
  // The old manifest made this mistake; keep the check honest by proving it would have failed.
  assert(appIdentity({ id: './', start_url: './' }, base + 'manifest.webmanifest') === appIdentity({ id: './', start_url: './' }, base + 'waitlist/manifest.webmanifest'),
    'the old "id": "./" gave both apps the same identity (the bug)');

  console.log('Old address');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '#connect=abc123');
  await page.waitForURL(u => u.pathname === '/Patient-follow-ups/app/');
  await page.waitForSelector('form[data-form="connect"]');
  assert(true, 'the old address opens the follow-up app');
  const rootHtml = await (await fetch(base)).text();
  assert(!/rel="manifest"/.test(rootHtml), 'the old address is no longer an app of its own');
  // Hash survives the redirect (checked on the redirect page itself, before app.js consumes it).
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.route('**/app/app.js', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  await p2.goto(base + '#connect=abc123');
  await p2.waitForURL(u => u.pathname.endsWith('/app/'));
  assert((await p2.evaluate(() => location.hash)) === '#connect=abc123', 'old #connect links keep working through the redirect');
  await ctx2.close();

  console.log('Phones that had the old version');
  // Recreate the old state: the root offline helper registered, with its saved copy of the old app.
  await page.goto(base + 'app/');
  await page.evaluate(async () => {
    const c = await caches.open('surgery-followups-shell-v1');
    await c.put('./index.html', new Response('old app'));
    await navigator.serviceWorker.register('../sw.js');
  });
  await page.waitForFunction(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    const keys = await caches.keys();
    return !regs.some(r => new URL(r.scope).pathname === '/Patient-follow-ups/') && keys.indexOf('surgery-followups-shell-v1') < 0;
  }, null, { timeout: 15000 });
  assert(true, 'the old root offline helper deletes its stale copy and retires');

  console.log('Both apps installable and offline');
  for (const dir of ['app/', 'waitlist/']) {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p = await c.newPage();
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(base + dir);
    await p.evaluate(() => navigator.serviceWorker.ready);
    const scope = await p.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope);
    assert(new URL(scope).pathname === '/Patient-follow-ups/' + dir, dir + ' has its own offline helper');
    const cdp = await c.newCDPSession(p);
    const inst = await cdp.send('Page.getInstallabilityErrors');
    assert(inst.installabilityErrors.length === 0, dir + ' is installable');
    await p.reload();
    await c.setOffline(true);
    await p.reload();
    assert(await p.locator('#app').count() === 1, dir + ' opens with no signal');
    await c.close();
  }

  assert(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  srv.server.close();
  console.log('\nAll checks passed.');
})().catch(e => {
  console.error(e);
  process.exit(1);
});
