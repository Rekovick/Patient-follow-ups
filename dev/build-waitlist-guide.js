#!/usr/bin/env node
/*
 * Builds dev/waitlist-guide.html: the step-by-step launch page for the Department Waiting List,
 * with a copy button for waitlist-server/Code.gs. Reuses the look and the copy/checklist script
 * of the main launch page (dev/build-setup-guide.js).
 *   node dev/build-waitlist-guide.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const code = fs.readFileSync(path.join(root, 'waitlist-server', 'Code.gs'), 'utf8');
const APP_URL = /const APP_URL = '([^']+)'/.exec(code)[1];
const base = fs.readFileSync(path.join(__dirname, 'build-setup-guide.js'), 'utf8');
const style = /<style>[\s\S]*?<\/style>/.exec(base)[0]
  .replace(/--accent: #0f766e; --accent-ink: #ffffff; --accent-soft: #e0f1ee;/, '--accent: #1d4ed8; --accent-ink: #ffffff; --accent-soft: #e3ebfd;');
const script = /<script>\n\(function \(\) \{[\s\S]*?<\/script>/.exec(base)[0].replace("'launch-kit-steps'", "'waitlist-kit-steps'");
const data = [{
  editorName: 'Code.gs',
  how: 'Click inside <code>Code.gs</code>, press <b>Ctrl + A</b> and <b>Delete</b> so it is empty, then <b>Ctrl + V</b>.',
  text: code,
  lines: code.split('\n').length,
}];
const json = JSON.stringify(data).replace(/</g, '\\u003c');

const html = `<title>Waiting List Launch Kit</title>
${style}
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&family=Source+Sans+3:wght@400;600&family=JetBrains+Mono:wght@400;600&display=swap">

<main>
  <h1>Launch the Department Waiting List</h1>
  <p class="lede">One shared list for the whole department. Anyone you send the link to installs it on their phone, adds cases with their decision, pre-op and post-op photos, and sees everyone else's changes within seconds. Calls and WhatsApp are one tap away.</p>
  <div class="meta"><span class="pill">About 10 minutes, once</span><span class="pill">Steps 1–5 on a computer</span><span class="pill">Separate from your own follow-up app</span></div>
  <div class="progress"><span id="prog-text">0 of 7 steps done</span><div class="bar"><span id="prog-bar"></span></div></div>

  <ol class="steps">
    <li class="step" data-step="1"><span class="num"></span><h2>Choose the owner account</h2><div class="body">
      <p>The list and its photos are saved in the Google Drive of whoever does steps 2–4. A department Gmail account (for example <i>neurosurgery.dept@gmail.com</i>) is best, because the list then belongs to the department rather than to one doctor. Your own account also works.</p>
      <label class="tick"><input type="checkbox" id="s1"> Signed in with the owner account</label></div></li>

    <li class="step" data-step="2"><span class="num"></span><h2>Create the server</h2><div class="body">
      <p>Open <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com → New project</a> and name it <code>Department Waiting List</code>. Press <b>Copy</b>, then replace everything in <code>Code.gs</code>.</p>
      <div class="files"></div>
      <label class="tick"><input type="checkbox" id="s2"> Pasted and saved (Ctrl + S)</label></div></li>

    <li class="step" data-step="3"><span class="num"></span><h2>Run setup</h2><div class="body">
      <p>Choose <code>setup</code> in the function menu, then click <b>▷ Run</b>. Allow the permissions: <b>Advanced → Go to Department Waiting List (unsafe)</b> → <b>Allow</b>. "Unsafe" only means Google hasn't reviewed your own script.</p>
      <p>The log ends with <i>TEAM KEY (paste it into the app once…): …</i>. Keep this tab open.</p>
      <label class="tick"><input type="checkbox" id="s3"> I can see the team key</label></div></li>

    <li class="step" data-step="4"><span class="num"></span><h2>Deploy</h2><div class="body">
      <p><b>Deploy → New deployment</b> → ⚙ <b>Web app</b>:</p>
      <ul>
        <li>Execute as: <b>Me</b></li>
        <li>Who has access: <b>Anyone</b> (not "Anyone with Google account")</li>
      </ul>
      <p>Click <b>Deploy</b> and copy the link that ends in <code>/exec</code>.</p>
      <label class="tick"><input type="checkbox" id="s4"> Copied the /exec link</label></div></li>

    <li class="step" data-step="5"><span class="num"></span><h2>Create the list in the app</h2><div class="body">
      <p>Open <a href="${APP_URL}" target="_blank" rel="noopener">${APP_URL.replace('https://', '')}</a>, tap <b>Set up a new list (department owner)</b>, and fill in:</p>
      <ul>
        <li><b>List name</b>: what everyone sees at the top, e.g. <i>Neurosurgery</i></li>
        <li><b>Server link</b> from step 4, <b>team key</b> from step 3, and <b>your name</b></li>
      </ul>
      <label class="tick"><input type="checkbox" id="s5"> The empty list opens</label></div></li>

    <li class="step" data-step="6"><span class="num"></span><h2>Invite the department</h2><div class="body">
      <p>Tap <b>⋮</b> (top right) → <b>Share on WhatsApp</b> and send the link to the department group, or let people scan the QR code. Each person taps the link, types their name and taps <b>Join</b>.</p>
      <div class="note">Anyone with this link can see and edit the list, so share it only with the department. If it reaches the wrong people, run <code>resetTeamKey</code> in Apps Script, set up the list again in the app with the new key (step 5), and share the new link. Old links stop working at once.</div>
      <label class="tick"><input type="checkbox" id="s6"> Link shared</label></div></li>

    <li class="step" data-step="7"><span class="num"></span><h2>Everyone installs it</h2><div class="body">
      <ul>
        <li>Android: tap <b>Install</b> at the top of the list, or Chrome <b>⋮ → Install app</b>.</li>
        <li>iPhone: open the link in <b>Safari</b>, then <b>Share → Add to Home Screen</b>.</li>
      </ul>
      <p>It opens from its own blue icon, works with a weak signal, and sends changes as soon as there is one.</p>
      <label class="tick"><input type="checkbox" id="s7"> Installed</label></div></li>
  </ol>

  <section class="later">
    <div><h2>How it works day to day</h2>
      <ul>
        <li>The list is ordered like a real waiting list: <b>urgent</b> cases first, then whoever has waited longest. Each card shows its place (#1, #2…).</li>
        <li>Tap a case to open its page: details, status, and <b>Decision</b>, <b>Pre-op</b> and <b>Post-op</b> photos (Post-op once the case is Done). Take photos with the camera or upload them; they upload in the background. Tap a photo to see it full screen.</li>
        <li>Tap a status badge on the list to change only that. Your name is recorded on everything you add or change.</li>
        <li>Phones sync about every 20 seconds while the app is open, and right after any change. Tap <b>Synced</b> at the top to sync now.</li>
        <li>With no signal you can still add and edit. The top shows <b>"2 to send"</b>, and photos wait with <b>"waiting for signal"</b>, until the phone is back online. Keep the app open until the photos are sent.</li>
      </ul></div>
    <div><h2>Changing the choices</h2>
      <p>The statuses are in the <b>Lists</b> tab of the <i>Department Waiting List — Data</i> sheet, in the owner's Google Drive (<i>Department Waiting List</i> folder). Edit them there; phones pick up the change within 10 minutes. The <b>Cases</b> tab holds every case, and the <b>Photos</b> folder holds a folder of photos per case.</p></div>
  </section>
</main>

<script type="application/json" id="file-data">${json}</script>
${script}
`;

const out = path.join(__dirname, 'waitlist-guide.html');
fs.writeFileSync(out, html);
console.log('Wrote ' + path.relative(process.cwd(), out));
