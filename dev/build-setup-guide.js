#!/usr/bin/env node
/*
 * Builds dev/setup-guide.html: the step-by-step launch page, with a copy button for
 * apps-script/Code.gs (the data server) and links for turning on the installable app.
 *   node dev/build-setup-guide.js
 */
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');
const APP_URL = /const APP_URL = '([^']+)'/.exec(code)[1];
const data = [{
  editorName: 'Code.gs',
  how: 'In the editor, click inside <code>Code.gs</code>, press <b>Ctrl + A</b> and <b>Delete</b> so it is completely empty, then <b>Ctrl + V</b>.',
  text: code,
  lines: code.split('\n').length,
}];
const json = JSON.stringify(data).replace(/</g, '\\u003c');

const html = `<title>Follow-ups Launch Kit</title>
<style>
  /* Layout: one readable column of numbered setup steps; file blocks sit inside their step. */
  :root {
    --bg: #f2f5f4; --surface: #ffffff; --ink: #14201e; --muted: #5a6b68; --line: #dbe3e1;
    --accent: #0f766e; --accent-ink: #ffffff; --accent-soft: #e0f1ee; --code: #f6f8f8;
    --warn-bg: #fff4d6; --warn-fg: #7a5200; --ok: #146c3a;
    --font-display: "Bricolage Grotesque", system-ui, sans-serif;
    --font-body: "Source Sans 3", system-ui, -apple-system, "Segoe UI", sans-serif;
    --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0e1513; --surface: #16201e; --ink: #e4ecea; --muted: #97a8a4; --line: #283633;
      --accent: #2bb3a5; --accent-ink: #04201d; --accent-soft: #143a36; --code: #111a18;
      --warn-bg: #3b2f12; --warn-fg: #ffd27a; --ok: #8be0a9; color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --bg: #0e1513; --surface: #16201e; --ink: #e4ecea; --muted: #97a8a4; --line: #283633;
    --accent: #2bb3a5; --accent-ink: #04201d; --accent-soft: #143a36; --code: #111a18;
    --warn-bg: #3b2f12; --warn-fg: #ffd27a; --ok: #8be0a9; color-scheme: dark;
  }
  * { box-sizing: border-box; }
  body { background: var(--bg); color: var(--ink); font: 17px/1.55 var(--font-body); }
  main { max-width: 760px; margin: 0 auto; padding-block: 32px 64px;
    padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
  h1, h2 { font-family: var(--font-display); text-wrap: balance; margin: 0; }
  h1 { font-size: clamp(30px, 6vw, 42px); line-height: 1.1; letter-spacing: -0.01em; }
  .lede { color: var(--muted); margin: 10px 0 0; max-width: 62ch; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
  .pill { font-size: 13px; font-weight: 600; padding: 4px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
  .progress { margin-top: 24px; font-size: 14px; color: var(--muted); display: flex; align-items: center; gap: 10px; }
  .bar { flex: 1; height: 6px; border-radius: 6px; background: var(--line); overflow: hidden; }
  .bar span { display: block; height: 100%; width: 0; background: var(--accent); transition: width .25s; }
  ol.steps { list-style: none; padding: 0; margin: 28px 0 0; display: grid; gap: 14px; counter-reset: step; }
  .step { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 18px; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 14px; }
  .step.done { opacity: .62; }
  .num { counter-increment: step; width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
    background: var(--accent-soft); color: var(--accent); font: 700 15px var(--font-display); grid-row: span 2; }
  .num::before { content: counter(step); }
  .step.done .num { background: var(--accent); color: var(--accent-ink); }
  .step.done .num::before { content: "✓"; }
  .step h2 { font-size: 19px; line-height: 1.3; }
  .body { min-width: 0; }
  .body p { margin: 6px 0 0; }
  .body ul { margin: 8px 0 0; padding-left: 20px; }
  .body li + li { margin-top: 4px; }
  code { font: 0.86em var(--font-mono); background: var(--code); border: 1px solid var(--line); border-radius: 5px; padding: 1px 5px; }
  .tick { margin-top: 12px; display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: var(--muted); cursor: pointer; }
  .tick input { width: 18px; height: 18px; accent-color: var(--accent); }
  .note { margin-top: 10px; padding: 10px 12px; border-radius: 10px; background: var(--warn-bg); color: var(--warn-fg); font-size: 15px; }
  .files { display: grid; gap: 10px; margin-top: 12px; }
  .file { border: 1px solid var(--line); border-radius: 12px; background: var(--code); padding: 12px; min-width: 0; }
  .file-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .file-name { font: 600 15px var(--font-mono); flex: 1 1 160px; min-width: 0; overflow-wrap: anywhere; }
  .file-name small { display: block; font: 400 12px var(--font-body); color: var(--muted); }
  @media (max-width: 560px) { .step .body { grid-column: 1 / -1; } .step { padding: 16px; } }
  .file p { font-size: 14px; color: var(--muted); margin: 6px 0 0; }
  button.copy { border: 0; border-radius: 9px; padding: 8px 14px; background: var(--accent); color: var(--accent-ink);
    font: 600 14px var(--font-body); cursor: pointer; min-width: 92px; }
  button.copy.copied { background: var(--ok); color: var(--surface); }
  button.copy:focus-visible, .tick input:focus-visible, a:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
  textarea.fallback { width: 100%; height: 160px; margin-top: 10px; font: 12px var(--font-mono); background: var(--surface); color: var(--ink);
    border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
  a { color: var(--accent); font-weight: 600; }
  .later { margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--line); display: grid; gap: 18px; }
  .later h2 { font-size: 20px; }
  .later p, .later li { color: var(--muted); }
  .later ul { margin: 6px 0 0; padding-left: 20px; }
  @media (prefers-reduced-motion: reduce) { .bar span { transition: none; } }
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&family=Source+Sans+3:wght@400;600&family=JetBrains+Mono:wght@400;600&display=swap">

<main>
  <h1>Make Surgery Follow-ups installable</h1>
  <p class="lede">Google Apps Script now only stores your data, in the same Sheet and Drive folder as before. The app itself runs from its own address, so your phone can install it like a normal app. Every request needs your private access key.</p>
  <div class="meta"><span class="pill">About 10 minutes</span><span class="pill">Steps 1–5 on a computer</span><span class="pill">Steps 6–7 on your phone</span></div>
  <div class="progress"><span id="prog-text">0 of 7 steps done</span><div class="bar"><span id="prog-bar"></span></div></div>

  <ol class="steps">
    <li class="step" data-step="1"><span class="num"></span><h2>Replace Code.gs</h2><div class="body">
      <p>Open your <b>Surgery Follow-ups</b> project at <a href="https://script.google.com/home" target="_blank" rel="noopener">script.google.com</a>. Press <b>Copy</b>, then replace everything in <code>Code.gs</code>.</p>
      <div class="files" id="files"></div>
      <p>If you made <code>Index</code>, <code>Styles</code> or <code>Client</code> files earlier, delete them (⋮ next to the file → Delete). They aren't used anymore.</p>
      <label class="tick"><input type="checkbox" id="s1"> Done</label></div></li>

    <li class="step" data-step="2"><span class="num"></span><h2>Run setup to get your access key</h2><div class="body">
      <p>Press <b>Ctrl + S</b>. Choose <code>setup</code> in the function menu and click <b>▷ Run</b>. If Google asks for permission again, allow it the same way as before.</p>
      <p>The log ends with a line like <i>Your ACCESS KEY (keep it private): 4f9c…</i>. Keep this tab open, because you'll paste that key in step 5.</p>
      <div class="note">Treat the key like a password. Anyone with it, plus your server link, can open the patient list. If it ever leaks, run <code>resetAccessKeys</code> to lock everyone out and get a new one.</div>
      <label class="tick"><input type="checkbox" id="s2"> I can see my key</label></div></li>

    <li class="step" data-step="3"><span class="num"></span><h2>Update the deployment</h2><div class="body">
      <p><b>Deploy → Manage deployments</b> → ✏️ <b>Edit</b>, then set:</p>
      <ul>
        <li>Version: <b>New version</b></li>
        <li>Execute as: <b>Me</b></li>
        <li>Who has access: <b>Anyone</b> (not "Anyone with Google account")</li>
      </ul>
      <p>Click <b>Deploy</b>. Your link stays the same and ends in <code>/exec</code>; copy it for step 5.</p>
      <div class="note">"Anyone" only lets the app reach the server. Without the access key, the server answers every request with "access denied" and never shows patient data.</div>
      <label class="tick"><input type="checkbox" id="s3"> Done</label></div></li>

    <li class="step" data-step="4"><span class="num"></span><h2>Turn on the app's address (one time)</h2><div class="body">
      <p>Open <a href="https://github.com/Rekovick/Patient-follow-ups/settings/pages" target="_blank" rel="noopener">GitHub → your repository → Settings → Pages</a> and set:</p>
      <ul>
        <li>Source: <b>Deploy from a branch</b></li>
        <li>Branch: <b>ccr-f6ecb352-w5ka0a</b>, folder <b>/docs</b>, then <b>Save</b></li>
      </ul>
      <p>After about a minute, <a href="${APP_URL}" target="_blank" rel="noopener">${APP_URL.replace('https://', '')}</a> opens the app's <i>Connect this device</i> screen. This address only serves the app's screens; no patient data is stored there.</p>
      <label class="tick"><input type="checkbox" id="s4"> The page opens</label></div></li>

    <li class="step" data-step="5"><span class="num"></span><h2>Connect on the computer</h2><div class="body">
      <p>On that page, paste your <b>server link</b> (step 3) and <b>access key</b> (step 2), then click <b>Connect</b>. You should see your patients.</p>
      <label class="tick"><input type="checkbox" id="s5"> Connected</label></div></li>

    <li class="step" data-step="6"><span class="num"></span><h2>Connect and install on your phone</h2><div class="body">
      <p>On the computer, open <b>Settings</b> (top right) → <b>Connect my other device</b>. A QR code appears.</p>
      <ul>
        <li>Scan it with your phone's camera and open the link. The app connects by itself.</li>
        <li>Android: tap <b>Install</b> at the top of the app, or Chrome <b>⋮ → Install app</b>.</li>
        <li>iPhone: open the link in <b>Safari</b>, then <b>Share → Add to Home Screen</b>.</li>
      </ul>
      <p>It now opens full-screen from its own icon, with no browser bar and no Google banner.</p>
      <label class="tick"><input type="checkbox" id="s6"> Installed</label></div></li>

    <li class="step" data-step="7"><span class="num"></span><h2>Remove the old shortcut</h2><div class="body">
      <p>The old home-screen shortcut (the <code>script.google.com</code> link) no longer opens the app, so delete it. Then check that the phone number and WhatsApp buttons work in the new app.</p>
      <label class="tick"><input type="checkbox" id="s7"> Done</label></div></li>
  </ol>

  <section class="later">
    <div><h2>Giving a colleague access</h2>
      <p>In the app: <b>Settings → People with access → Add a person</b>. Type their name and send them the link or QR code that appears; they open it once and install the app. Their name appears on every change they make. To take access away, remove them there, and all their devices are disconnected.</p></div>
    <div><h2>Updating the app later</h2>
      <ul>
        <li><b>Screens and features</b> (the <code>docs/</code> folder): update on their own when new code is pushed. Phones pick them up the next time the app opens.</li>
        <li><b>Data server</b> (<code>Code.gs</code>): paste the new file, then <b>Deploy → Manage deployments → ✏️ Edit → New version → Deploy</b>.</li>
      </ul></div>
    <div><h2>If something goes wrong</h2>
      <ul>
        <li><b>"Could not reach the server"</b>: the deployment's access isn't set to <b>Anyone</b>, or a new version wasn't deployed (step 3).</li>
        <li><b>"That server link doesn't look right"</b>: use the deployment link that ends in <code>/exec</code>, not the editor's address.</li>
        <li><b>"This access key isn't valid"</b>: the key was mistyped, reset, or that person was removed. Run <code>setup</code> again to see the owner key.</li>
        <li><b>The app's address shows "404"</b>: GitHub Pages is still starting (wait a minute), or the branch or <code>/docs</code> folder in step 4 is wrong.</li>
      </ul></div>
  </section>
</main>

<script type="application/json" id="file-data">${json}</script>
<script>
(function () {
  var files = JSON.parse(document.getElementById('file-data').textContent);
  var box = document.getElementById('files');
  files.forEach(function (f, i) {
    var el = document.createElement('div');
    el.className = 'file';
    el.innerHTML = '<div class="file-head"><span class="file-name"></span><button class="copy" type="button" id="copy-' + i + '">Copy</button></div><p></p>';
    el.querySelector('.file-name').textContent = (i + 1) + '. ' + f.editorName;
    var small = document.createElement('small');
    small.textContent = f.lines + ' lines';
    el.querySelector('.file-name').appendChild(small);
    el.querySelector('p').innerHTML = f.how;
    var btn = el.querySelector('button');
    btn.addEventListener('click', function () {
      function done() {
        btn.textContent = 'Copied ✓';
        btn.classList.add('copied');
        setTimeout(function () { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2500);
      }
      function fallback() {
        var ta = el.querySelector('textarea');
        if (!ta) {
          ta = document.createElement('textarea');
          ta.className = 'fallback';
          ta.readOnly = true;
          ta.value = f.text;
          el.appendChild(ta);
        }
        ta.focus();
        ta.select();
        btn.textContent = 'Press Ctrl+C';
      }
      try {
        navigator.clipboard.writeText(f.text).then(done, fallback);
      } catch (e) {
        fallback();
      }
    });
    box.appendChild(el);
  });

  var KEY = 'launch-kit-steps';
  var state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { state = {}; }
  var boxes = Array.prototype.slice.call(document.querySelectorAll('.tick input'));
  function update() {
    var n = 0;
    boxes.forEach(function (b) {
      b.closest('.step').classList.toggle('done', b.checked);
      if (b.checked) n++;
    });
    document.getElementById('prog-text').textContent = n + ' of ' + boxes.length + ' steps done';
    document.getElementById('prog-bar').style.width = (n * 100 / boxes.length) + '%';
  }
  boxes.forEach(function (b) {
    b.checked = !!state[b.id];
    b.addEventListener('change', function () {
      state[b.id] = b.checked;
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* per-browser convenience only */ }
      update();
    });
  });
  update();
})();
</script>
`;

const out = path.join(__dirname, 'setup-guide.html');
fs.writeFileSync(out, html);
console.log('Wrote ' + path.relative(process.cwd(), out));
