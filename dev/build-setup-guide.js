#!/usr/bin/env node
/*
 * Builds dev/setup-guide.html: a step-by-step launch page with copy buttons for every
 * Apps Script file, so the app can be installed without opening GitHub.
 *   node dev/build-setup-guide.js
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'apps-script');
const FILES = [
  { name: 'Code.gs', editorName: 'Code.gs', how: 'Already there when the project opens. Select everything in it, delete it, and paste.' },
  { name: 'Index.html', editorName: 'Index', how: 'Click <b>+</b> next to <i>Files</i> → <b>HTML</b>, type <code>Index</code>, press Enter. Delete the starter text and paste.' },
  { name: 'Styles.html', editorName: 'Styles', how: '<b>+</b> → <b>HTML</b>, name it <code>Styles</code>. Delete the starter text and paste.' },
  { name: 'Client.html', editorName: 'Client', how: '<b>+</b> → <b>HTML</b>, name it <code>Client</code>. Delete the starter text and paste.' },
  { name: 'appsscript.json', editorName: 'appsscript.json', how: 'Open <b>Project Settings ⚙</b> (left bar) and tick <b>Show "appsscript.json" manifest file in editor</b>. Go back to the editor ( &lt;&gt; ), open <code>appsscript.json</code>, replace everything and paste.' },
];
const data = FILES.map(f => {
  const text = fs.readFileSync(path.join(dir, f.name), 'utf8');
  return Object.assign({}, f, { text: text, lines: text.split('\n').length });
});
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
  <h1>Launch Surgery Follow-ups</h1>
  <p class="lede">Install the app in your own Google account. Your patients go into a Google Sheet and their photos into a Drive folder that only you can open.</p>
  <div class="meta"><span class="pill">About 10 minutes</span><span class="pill">Use a computer for setup</span><span class="pill">Use the app on your phone after</span></div>
  <div class="progress"><span id="prog-text">0 of 7 steps done</span><div class="bar"><span id="prog-bar"></span></div></div>

  <ol class="steps">
    <li class="step" data-step="1"><span class="num"></span><h2>Create the project</h2><div class="body">
      <p>Open <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com → New project</a>, signed in to the Google account that should own the patient data.</p>
      <p>Click <b>Untitled project</b> at the top and rename it <code>Surgery Follow-ups</code>.</p>
      <div class="note">If your browser is signed in to more than one Google account, use a window signed in only to this one. Apps Script often fails with several accounts.</div>
      <label class="tick"><input type="checkbox" id="s1"> Done</label></div></li>

    <li class="step" data-step="2"><span class="num"></span><h2>Paste the 5 files</h2><div class="body">
      <p>For each file below, press <b>Copy</b>, then paste it into the editor as described. Names must match exactly; the editor adds <code>.html</code> by itself.</p>
      <div class="files" id="files"></div>
      <label class="tick"><input type="checkbox" id="s2"> All 5 pasted</label></div></li>

    <li class="step" data-step="3"><span class="num"></span><h2>Save and run setup</h2><div class="body">
      <p>Press <b>Ctrl + S</b> (<b>⌘ + S</b> on Mac). Open <code>Code.gs</code>, choose <code>setup</code> in the function menu at the top, and click <b>▷ Run</b>.</p>
      <p>Google asks for permission:</p>
      <ul>
        <li><b>Review permissions</b>, then choose your account.</li>
        <li>On "Google hasn't verified this app", click <b>Advanced</b>, then <b>Go to Surgery Follow-ups (unsafe)</b>. The warning shows because the app is yours and Google hasn't reviewed it.</li>
        <li>Click <b>Allow</b>.</li>
      </ul>
      <p>When the log says <i>Execution completed</i>, a <b>Surgery Follow-ups</b> folder with the data Sheet has been created in your Drive.</p>
      <label class="tick"><input type="checkbox" id="s3"> Done</label></div></li>

    <li class="step" data-step="4"><span class="num"></span><h2>Deploy as a web app</h2><div class="body">
      <p>Click <b>Deploy</b> (top right) → <b>New deployment</b> → the gear ⚙ next to <i>Select type</i> → <b>Web app</b>.</p>
      <ul>
        <li>Description: <code>v1</code></li>
        <li>Execute as: <b>Me</b></li>
        <li>Who has access: <b>Only myself</b></li>
      </ul>
      <p>Click <b>Deploy</b> and copy the <b>Web app URL</b>. It ends with <code>/exec</code>.</p>
      <label class="tick"><input type="checkbox" id="s4"> Done</label></div></li>

    <li class="step" data-step="5"><span class="num"></span><h2>Send the link to your phone</h2><div class="body">
      <p>Email or WhatsApp the <code>/exec</code> link to yourself, then open it in <b>Chrome</b> (Android) or <b>Safari</b> (iPhone) while signed in to the same Google account.</p>
      <label class="tick"><input type="checkbox" id="s5"> Opened on my phone</label></div></li>

    <li class="step" data-step="6"><span class="num"></span><h2>Add it to your home screen</h2><div class="body">
      <ul>
        <li>Android, Chrome: <b>⋮</b> → <b>Add to Home screen</b></li>
        <li>iPhone, Safari: <b>Share</b> → <b>Add to Home Screen</b></li>
      </ul>
      <label class="tick"><input type="checkbox" id="s6"> Done</label></div></li>

    <li class="step" data-step="7"><span class="num"></span><h2>Add your first patient</h2><div class="body">
      <p>Tap <b>Add patient</b> and go through the steps. Then open the <b>Surgery Follow-ups — Data</b> sheet in Google Drive: the patient appears there as a row.</p>
      <label class="tick"><input type="checkbox" id="s7"> It works</label></div></li>
  </ol>

  <section class="later">
    <div><h2>Updating the app later</h2>
      <p>Paste the new files, save, then <b>Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy</b>. The link stays the same.</p></div>
    <div><h2>Sharing with a colleague</h2>
      <ul>
        <li>In Google Drive, share the <b>Surgery Follow-ups</b> folder with them as <b>Editor</b>.</li>
        <li>In Apps Script: <b>Deploy → Manage deployments → ✏️ Edit</b>, set <i>Execute as</i> to <b>User accessing the web app</b> and <i>Who has access</i> to <b>Anyone with Google account</b>, then <b>Deploy</b>.</li>
        <li>Send them the same link. People without access to the folder can't see any patients.</li>
      </ul></div>
    <div><h2>If something goes wrong</h2>
      <ul>
        <li><b>"Sorry, unable to open the file at this time"</b>: the browser has several Google accounts signed in. Use a window with only the owner account.</li>
        <li><b>"Script function not found: doGet"</b>: <code>Code.gs</code> wasn't saved. Paste it again and press Save.</li>
        <li><b>A page with raw code or <code>include</code> errors</b>: an HTML file has the wrong name. It must be exactly <code>Index</code>, <code>Styles</code> and <code>Client</code>.</li>
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
