(function () {
  'use strict';

  // The list lives on this phone and is synced with the department's Apps Script server.
  // Changes are shown at once and queued, so the app never waits for the network.

  const CONF_KEY = 'waitlist.conf.v1';
  const DATA_KEY = 'waitlist.data.v1';
  const OUTBOX_KEY = 'waitlist.outbox.v1';
  const PREFS_KEY = 'waitlist.prefs.v1';
  const POLL_MS = 20000;
  const FULL_SYNC_MS = 10 * 60000;

  const app = document.getElementById('app');
  const overlayRoot = document.getElementById('overlay-root');

  const S = {
    conf: null,          // {url, key, name, team}
    cases: {},           // id -> case
    lists: { statuses: ['Waiting', 'Done'], hospitals: [], consultants: [] },
    lastSync: '',
    lastFull: 0,
    outbox: [],          // [{id, op: 'save'|'remove', fields}]
    filter: 'active',
    q: '',
    sync: 'ok',          // ok | syncing | offline | error
    syncing: false,
    joinMsg: '',
    installPrompt: null,
  };

  // ---------------------------------------------------------------- storage

  function load(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || 'null');
      return v === null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function store(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage full or blocked: the app still works until it is closed */ }
  }

  function saveData() {
    store(DATA_KEY, { cases: S.cases, lists: S.lists, lastSync: S.lastSync, lastFull: S.lastFull });
    store(OUTBOX_KEY, S.outbox);
  }

  // ---------------------------------------------------------------- server

  async function api(conf, fn, args) {
    let res;
    try {
      // A text/plain body keeps this a "simple" request, which Apps Script accepts from another site.
      res = await fetch(conf.url, { method: 'POST', body: JSON.stringify({ key: conf.key, user: conf.name, fn: fn, args: args || [] }) });
    } catch (e) {
      const err = new Error(navigator.onLine === false ? 'No internet connection.' : 'Could not reach the server.');
      err.offline = true;
      throw err;
    }
    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error('The server link doesn’t look right. It should be the Apps Script link that ends in /exec.');
    }
    if (!data.ok) {
      const err = new Error(data.error === 'ACCESS_DENIED' ? 'This invite link no longer works.' : data.error);
      err.denied = data.error === 'ACCESS_DENIED';
      throw err;
    }
    return data.result;
  }

  /** Sends queued changes, then fetches what others changed. Safe to call any time. */
  async function sync(opts) {
    opts = opts || {};
    if (!S.conf) return;
    if (S.syncing) { S.syncAgain = true; return; }
    S.syncing = true;
    setSync('syncing');
    try {
      await flushOutbox();
      const full = opts.full || !S.lastSync || Date.now() - S.lastFull > FULL_SYNC_MS;
      // Ask again for the last two minutes, so a change saved while we were reading is never missed.
      const since = full ? '' : new Date(Date.parse(S.lastSync) - 120000).toISOString();
      const r = await api(S.conf, 'sync', [since]);
      if (r.full) {
        const fresh = {};
        r.cases.forEach(c => { fresh[c.id] = c; });
        keepPending(fresh);
        S.cases = fresh;
        S.lastFull = Date.now();
      } else {
        r.cases.forEach(c => {
          if (isPending(c.id)) return;
          if (c.deleted) delete S.cases[c.id];
          else if (!S.cases[c.id] || String(c.updatedAt) >= String(S.cases[c.id].updatedAt)) S.cases[c.id] = c;
        });
      }
      if (r.lists) S.lists = r.lists;
      S.lastSync = r.now;
      saveData();
      setSync(S.outbox.length ? 'offline' : 'ok');
      refreshView();
    } catch (e) {
      if (e.denied) { leave('This invite link no longer works. Ask a colleague for the new one.'); return; }
      setSync(e.offline ? 'offline' : 'error', e.message);
    } finally {
      S.syncing = false;
      if (S.syncAgain) { S.syncAgain = false; sync(); }
    }
  }

  async function flushOutbox() {
    while (S.outbox.length) {
      const job = S.outbox[0];
      try {
        const saved = job.op === 'remove' ? await api(S.conf, 'remove', [job.id]) : await api(S.conf, 'save', [job.id, job.fields]);
        S.outbox.shift();
        if (job.op === 'remove' || !saved) {
          delete S.cases[job.id];
        } else if (!isPending(job.id)) {
          S.cases[job.id] = saved;
        }
        saveData();
      } catch (e) {
        if (e.offline || e.denied) throw e;
        // The server refused this change (e.g. a missing name): drop it so the queue keeps moving.
        S.outbox.shift();
        saveData();
        toast('A change was not saved: ' + e.message, 'error');
      }
    }
  }

  function isPending(id) {
    return S.outbox.some(j => j.id === id);
  }

  function keepPending(fresh) {
    Object.keys(S.cases).forEach(id => { if (isPending(id)) fresh[id] = S.cases[id]; });
    S.outbox.forEach(j => { if (j.op === 'remove') delete fresh[j.id]; });
  }

  function queue(job) {
    S.outbox.push(job);
    saveData();
    refreshView();
    sync();
  }

  function saveCase(id, fields) {
    const existing = S.cases[id];
    const now = new Date().toISOString();
    S.cases[id] = Object.assign({}, existing || { id: id, createdAt: now, createdBy: S.conf.name, status: S.lists.statuses[0] }, fields,
      { updatedAt: now, updatedBy: S.conf.name });
    queue({ op: 'save', id: id, fields: fields });
  }

  function removeCase(id) {
    delete S.cases[id];
    queue({ op: 'remove', id: id });
  }

  function newId() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ---------------------------------------------------------------- helpers

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function latinDigits(s) {
    return String(s || '').replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));
  }

  function normText(s) {
    return latinDigits(s).toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
  }

  /** Any way of writing an Egyptian number → local form, e.g. +20 10… → 010… */
  function localPhone(p) {
    let d = latinDigits(p).replace(/\D/g, '');
    if (d.indexOf('00') === 0) d = d.slice(2);
    if (d.indexOf('20') === 0 && d.length === 12) d = '0' + d.slice(2);
    if (d.length === 10 && d.charAt(0) === '1') d = '0' + d;
    return d;
  }

  /** "2" + local number, so 010… → +20 10… for calls and WhatsApp. */
  function intlPhone(p) {
    const d = localPhone(p);
    return d ? (d.charAt(0) === '0' ? '2' + d : '20' + d) : '';
  }

  function prettyPhone(p) {
    const d = localPhone(p);
    return /^0\d{10}$/.test(d) ? d.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1 $2 $3') : d;
  }

  function daysSince(iso) {
    const t = Date.parse(iso);
    return isNaN(t) ? 0 : Math.floor((Date.now() - t) / 864e5);
  }

  function ago(iso) {
    const s = (Date.now() - Date.parse(iso)) / 1000;
    if (isNaN(s)) return '';
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    const d = Math.floor(s / 86400);
    return d === 1 ? 'yesterday' : d + ' days ago';
  }

  const TONES = ['amber', 'blue', 'violet', 'teal', 'orange', 'slate'];
  function doneStatus() {
    const st = S.lists.statuses;
    return st.find(s => /^done$/i.test(s)) || st[st.length - 1];
  }
  function tone(status) {
    if (status === doneStatus()) return 'green';
    const i = S.lists.statuses.indexOf(status);
    return TONES[(i < 0 ? 0 : i) % TONES.length];
  }

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    menu: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.5"/><circle cx="4.5" cy="12" r="1.5"/><circle cx="4.5" cy="18" r="1.5"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  };
  const WA = 'M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm5.8 14.03c-.25.69-1.44 1.32-1.98 1.4-.51.08-1.15.11-1.86-.12-.43-.14-.98-.32-1.68-.62-2.96-1.28-4.89-4.26-5.04-4.46-.15-.2-1.2-1.6-1.2-3.05s.76-2.16 1.03-2.46c.27-.3.59-.37.79-.37h.57c.18 0 .43-.07.67.51.25.59.84 2.05.91 2.2.07.15.12.32.02.52-.1.2-.15.32-.3.49-.15.17-.31.39-.45.52-.15.15-.3.31-.13.61.17.3.77 1.27 1.65 2.06 1.13 1.01 2.09 1.32 2.39 1.47.3.15.47.12.64-.07.17-.2.74-.86.94-1.16.2-.3.39-.25.66-.15.27.1 1.72.81 2.02.96.3.15.49.22.57.35.07.12.07.71-.18 1.4z';
  function icon(name) {
    if (name === 'wa') return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="' + WA + '"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  let toastTimer = null;
  function toast(text, kind) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.className = 'show' + (kind === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, kind === 'error' ? 4500 : 2000);
  }

  // ---------------------------------------------------------------- views

  function render() {
    if (!S.conf) renderJoin();
    else renderMain();
  }

  function refreshView() {
    if (S.conf && document.getElementById('list')) renderList();
  }

  function renderJoin() {
    const invite = S.invite;
    app.innerHTML =
      '<div class="join">' +
        '<div class="logo">' + icon('list') + '</div>' +
        (invite
          ? '<h2>Join ' + esc(invite.t || 'the waiting list') + '</h2><p>Type your name once. It’s shown on the cases you add or change.</p>'
          : '<h2>Waiting List</h2><p>Open the invite link a colleague sent you, or paste it here.</p>') +
        (S.joinMsg ? '<p class="warn" style="margin-top:12px">' + esc(S.joinMsg) + '</p>' : '') +
        '<form data-form="join">' +
          (invite ? '' : '<div class="field"><label for="j-link">Invite link</label><input id="j-link" name="link" autocomplete="off" spellcheck="false" placeholder="https://…#join=…"></div>') +
          '<div class="field"><label for="j-name">Your name</label><input id="j-name" name="name" autocomplete="name" dir="auto" placeholder="e.g. Dr Sara Mohamed" value="' + esc((S.lastConf && S.lastConf.name) || '') + '"></div>' +
          '<button class="btn primary block" style="margin-top:16px" type="submit">Join</button>' +
        '</form>' +
        '<details><summary>Set up a new list (department owner)</summary>' +
          '<form data-form="owner">' +
            '<div class="field"><label for="o-team">List name</label><input id="o-team" name="team" placeholder="e.g. Neurosurgery Department"></div>' +
            '<div class="field"><label for="o-url">Server link (ends in /exec)</label><input id="o-url" name="url" autocomplete="off" spellcheck="false" placeholder="https://script.google.com/macros/s/…/exec"></div>' +
            '<div class="field"><label for="o-key">Team key (from setup)</label><input id="o-key" name="key" autocomplete="off" spellcheck="false"></div>' +
            '<div class="field"><label for="o-name">Your name</label><input id="o-name" name="name" dir="auto"></div>' +
            '<button class="btn block" style="margin-top:14px" type="submit">Create</button>' +
          '</form></details>' +
      '</div>';
  }

  function renderMain() {
    app.innerHTML =
      '<header class="head">' +
        '<div class="head-row">' +
          '<h1>' + esc(S.conf.team || 'Waiting List') + '<small id="count"></small></h1>' +
          (S.installPrompt ? '<button class="btn primary" style="min-height:34px;padding:0 12px" data-act="install">Install</button>' : '') +
          '<button class="sync" id="sync" data-act="sync" aria-label="Sync now"><i></i><span></span></button>' +
          '<button class="icon-btn" data-act="menu" aria-label="Menu">' + icon('menu') + '</button>' +
        '</div>' +
        '<div class="search">' + icon('search') + '<input id="q" type="search" placeholder="Search name, phone, diagnosis…" autocomplete="off" dir="auto" value="' + esc(S.q) + '"></div>' +
        '<div class="chips" id="chips"></div>' +
      '</header>' +
      '<div class="list" id="list"></div>' +
      '<button class="fab" data-act="add">' + icon('plus') + 'Add case</button>';
    renderList();
    setSync(S.sync);
  }

  /** Waiting-list order: urgent first, then whoever has waited longest. */
  function ordered(list) {
    return list.slice().sort((a, b) => (b.urgent - a.urgent) || String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  function matchesSearch(c, q) {
    if (!q) return true;
    const hay = normText([c.name, c.phone, localPhone(c.phone), c.diagnosis, c.hospital, c.consultant, c.status, c.note, c.createdBy].join(' '));
    const digits = q.replace(/[\s+\-()]/g, '');
    if (/^\d{4,}$/.test(digits) && localPhone(c.phone).indexOf(digits.replace(/^(00)?20/, '').replace(/^0/, '')) >= 0) return true;
    return q.split(/\s+/).every(w => hay.indexOf(w) >= 0);
  }

  function renderList() {
    const all = Object.values(S.cases);
    const done = doneStatus();
    const active = ordered(all.filter(c => c.status !== done));
    const pos = {};
    active.forEach((c, i) => { pos[c.id] = i + 1; });
    const q = normText(S.q).trim();
    const searched = all.filter(c => matchesSearch(c, q));
    const groups = {
      active: c => c.status !== done,
      urgent: c => c.urgent && c.status !== done,
      mine: c => c.createdBy === S.conf.name && c.status !== done,
    };
    S.lists.statuses.forEach(s => { groups['s:' + s] = c => c.status === s; });
    const test = groups[S.filter] || groups.active;
    const shown = ordered(searched.filter(test));

    const chip = (key, label) => '<button class="chip' + (S.filter === key ? ' on' : '') + '" data-act="filter" data-key="' + esc(key) + '">' +
      esc(label) + ' <b>' + searched.filter(groups[key]).length + '</b></button>';
    document.getElementById('chips').innerHTML =
      chip('active', 'All') + chip('urgent', 'Urgent') + chip('mine', 'Added by me') +
      S.lists.statuses.map(s => chip('s:' + s, s)).join('');
    document.getElementById('count').textContent = active.length + ' waiting' + (S.conf.name ? ' · you are ' + S.conf.name : '');

    const list = document.getElementById('list');
    if (!all.length) {
      list.innerHTML = '<div class="empty"><p><b>The list is empty</b></p><p class="small">Tap “Add case” to add the first patient. Everyone with the link sees it.</p></div>';
      return;
    }
    if (!shown.length) {
      list.innerHTML = '<div class="empty"><p><b>No cases here</b></p><p class="small">Try another filter or search.</p></div>';
      return;
    }
    list.innerHTML = shown.map(c => cardHtml(c, pos[c.id])).join('');
  }

  function cardHtml(c, position) {
    const meta = [c.diagnosis, c.hospital, c.consultant].filter(Boolean).map(esc).join(' · ');
    const waited = daysSince(c.createdAt);
    const phone = localPhone(c.phone);
    return '<article class="card' + (c.urgent ? ' urgent' : '') + (isPending(c.id) ? ' pending' : '') + '" data-act="edit" data-id="' + esc(c.id) + '">' +
      '<div class="top"><span class="pos">' + (position ? '#' + position : '') + '</span>' +
        '<h3 dir="auto">' + esc(c.name) + '</h3>' +
        (c.urgent ? '<span class="tag-urgent">Urgent</span>' : '') +
        '<button class="badge tone-' + tone(c.status) + '" data-act="status" data-id="' + esc(c.id) + '">' + esc(c.status) + '</button></div>' +
      (meta ? '<div class="meta" dir="auto">' + meta + '</div>' : '') +
      (c.note ? '<div class="note" dir="auto">' + esc(c.note) + '</div>' : '') +
      (phone
        ? '<div class="bottom"><a class="phone" href="tel:+' + intlPhone(phone) + '" dir="ltr">' + esc(prettyPhone(phone)) + '</a>' +
          '<a class="round call" href="tel:+' + intlPhone(phone) + '" aria-label="Call">' + icon('phone') + '</a>' +
          '<a class="round wa" href="https://wa.me/' + intlPhone(phone) + '" target="_blank" rel="noopener" aria-label="WhatsApp">' + icon('wa') + '</a></div>'
        : '') +
      '<div class="by">Added by ' + esc(c.createdBy || '?') + ' · ' + (waited ? waited + (waited === 1 ? ' day' : ' days') + ' waiting' : 'today') +
        (isPending(c.id) ? ' · <b>not sent yet</b>' : '') + '</div>' +
      '</article>';
  }

  function setSync(state, message) {
    S.sync = state;
    const el = document.getElementById('sync');
    if (!el) return;
    el.className = 'sync ' + state;
    const n = S.outbox.length;
    el.querySelector('span').textContent =
      state === 'syncing' ? 'Syncing…' :
      state === 'offline' ? (n ? n + ' to send' : 'Offline') :
      state === 'error' ? 'Sync problem' : 'Synced';
    el.title = message || '';
  }

  // ---------------------------------------------------------------- sheets

  function openSheet(html) {
    const scrim = document.createElement('div');
    scrim.className = 'scrim';
    scrim.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>' + html + '</div>';
    scrim.addEventListener('click', e => {
      if (e.target === scrim || e.target.closest('[data-close]')) closeSheets();
    });
    overlayRoot.appendChild(scrim);
    return scrim;
  }

  function closeSheets() {
    overlayRoot.innerHTML = '';
  }

  function confirmSheet(title, text, ok) {
    return new Promise(resolve => {
      const sheet = openSheet('<h3 dir="auto">' + esc(title) + '</h3><p class="muted" style="margin-top:6px">' + esc(text) + '</p>' +
        '<div class="row"><button class="btn" data-no>Cancel</button><button class="btn primary" data-yes style="background:var(--danger);border-color:var(--danger);color:#fff">' + esc(ok) + '</button></div>');
      sheet.addEventListener('click', e => {
        if (e.target.closest('[data-yes]')) { sheet.remove(); resolve(true); }
        else if (e.target.closest('[data-no]') || e.target === sheet) { sheet.remove(); resolve(false); }
      });
    });
  }

  function options(values, current, empty) {
    const list = values.slice();
    if (current && list.indexOf(current) < 0) list.push(current);
    return (empty ? '<option value="">' + esc(empty) + '</option>' : '') +
      list.map(v => '<option' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
  }

  function openForm(id) {
    const c = id ? S.cases[id] : null;
    const v = c || { status: S.lists.statuses[0], urgent: false };
    const sheet = openSheet(
      '<h3>' + (c ? 'Edit case' : 'Add case') + '</h3>' +
      '<form data-form="case" data-id="' + esc(id || '') + '">' +
        '<div class="field"><label for="f-name">Patient name</label><input id="f-name" name="name" dir="auto" autocomplete="off" value="' + esc(v.name) + '" required></div>' +
        '<div class="field"><label for="f-phone">Phone</label><input id="f-phone" name="phone" inputmode="tel" dir="ltr" autocomplete="off" placeholder="01xxxxxxxxx" value="' + esc(v.phone) + '"><div id="phone-warn"></div></div>' +
        '<div class="field"><label for="f-dx">Diagnosis / operation</label><input id="f-dx" name="diagnosis" dir="auto" autocomplete="off" value="' + esc(v.diagnosis) + '"></div>' +
        '<div class="pair">' +
          '<div class="field"><label for="f-hosp">Hospital</label><select id="f-hosp" name="hospital">' + options(S.lists.hospitals, v.hospital, '—') + '</select></div>' +
          '<div class="field"><label for="f-cons">Consultant</label><select id="f-cons" name="consultant">' + options(S.lists.consultants, v.consultant, '—') + '</select></div>' +
        '</div>' +
        '<div class="field"><label>Status</label><div class="statuses">' + S.lists.statuses.map(s =>
          '<button type="button" class="badge tone-' + tone(s) + (s === v.status ? ' on' : '') + '" data-pick-status="' + esc(s) + '">' + esc(s) + '</button>').join('') +
          '</div><input type="hidden" name="status" value="' + esc(v.status) + '"></div>' +
        '<label class="switch"><input type="checkbox" name="urgent"' + (v.urgent ? ' checked' : '') + '> Urgent</label>' +
        '<div class="field"><label for="f-note">Note</label><textarea id="f-note" name="note" dir="auto">' + esc(v.note) + '</textarea></div>' +
        (c ? '<p class="small muted" style="margin-top:10px">Added by ' + esc(c.createdBy) + ' ' + esc(ago(c.createdAt)) +
          (c.updatedBy ? ' · last change by ' + esc(c.updatedBy) + ' ' + esc(ago(c.updatedAt)) : '') + '</p>' : '') +
        '<div class="row"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div>' +
        (c ? '<div class="row"><button type="button" class="btn danger" data-act="delete" data-id="' + esc(id) + '">Delete case</button></div>' : '') +
      '</form>');
    phoneWarning(sheet, v.phone, id);
    if (!c) setTimeout(() => sheet.querySelector('#f-name').focus(), 60);
  }

  function phoneWarning(sheet, phone, id) {
    const box = sheet.querySelector('#phone-warn');
    if (!box) return;
    const local = localPhone(phone);
    let msg = '';
    if (local && !/^01[0125]\d{8}$/.test(local)) msg = 'This doesn’t look like an Egyptian mobile number.';
    const dup = local && Object.values(S.cases).find(c => c.id !== id && localPhone(c.phone) === local);
    if (dup) msg = 'Already on the list: ' + dup.name + ' (' + dup.status + ').';
    box.innerHTML = msg ? '<div class="warn" style="margin-top:6px">' + esc(msg) + '</div>' : '';
  }

  function openStatus(id) {
    const c = S.cases[id];
    if (!c) return;
    openSheet('<h3 dir="auto">' + esc(c.name) + '</h3><p class="muted small">Change status</p>' +
      '<div class="statuses" style="margin-top:12px">' + S.lists.statuses.map(s =>
        '<button class="badge tone-' + tone(s) + (s === c.status ? ' on' : '') + '" data-act="set-status" data-id="' + esc(id) + '" data-value="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</div>' +
      '<div class="row"><button class="btn" data-close>Close</button></div>');
  }

  function inviteLink() {
    const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ u: S.conf.url, k: S.conf.key, t: S.conf.team }))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return location.href.split('#')[0] + '#join=' + payload;
  }

  function parseInvite(text) {
    const m = /#join=([\w-]+)/.exec(String(text || ''));
    if (!m) return null;
    try {
      const j = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))));
      return j.u && j.k ? j : null;
    } catch (e) {
      return null;
    }
  }

  function loadQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '../vendor/qrcode.js';
      s.onload = () => resolve(window.qrcode);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function openMenu() {
    const link = inviteLink();
    let qr = '';
    try {
      const q = (await loadQr())(0, 'M');
      q.addData(link);
      q.make();
      qr = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    } catch (e) { qr = ''; }
    const message = 'Join the ' + (S.conf.team || 'department') + ' waiting list: ' + link;
    const sheet = openSheet(
      '<h3>Invite colleagues</h3><p class="muted small">Anyone with this link can see and edit the list. Share it only in the department group.</p>' +
      (qr ? '<div class="qr">' + qr + '</div>' : '') +
      '<div class="row"><a class="btn wa" href="' + esc('https://wa.me/?text=' + encodeURIComponent(message)) + '" target="_blank" rel="noopener">' + icon('wa') + 'Share on WhatsApp</a></div>' +
      '<div class="row"><button class="btn" data-copy>' + icon('share') + 'Copy link</button></div>' +
      '<h3 style="margin-top:22px">You</h3>' +
      '<form data-form="rename"><div class="field"><label for="m-name">Your name</label><input id="m-name" name="name" dir="auto" value="' + esc(S.conf.name) + '"></div>' +
        '<div class="row"><button class="btn" type="submit">Save name</button></div></form>' +
      (S.installPrompt ? '<div class="row"><button class="btn primary" data-act="install">Install app</button></div>'
        : '<p class="small muted" style="margin-top:14px">To install: Android Chrome <b>⋮ → Install app</b>. iPhone Safari <b>Share → Add to Home Screen</b>.</p>') +
      '<div class="row"><button class="btn danger" data-act="leave">Leave this list on this phone</button></div>' +
      '<div class="row"><button class="btn" data-close>Close</button></div>');
    sheet.querySelector('[data-copy]').addEventListener('click', () => {
      try {
        navigator.clipboard.writeText(link).then(() => toast('Link copied'), () => toast('Could not copy — use WhatsApp share instead', 'error'));
      } catch (e) {
        toast('Could not copy — use WhatsApp share instead', 'error');
      }
    });
  }

  function leave(message) {
    S.lastConf = S.conf;
    S.conf = null;
    S.cases = {};
    S.outbox = [];
    S.lastSync = '';
    S.lastFull = 0;
    S.joinMsg = message || '';
    store(CONF_KEY, null);
    store(DATA_KEY, null);
    store(OUTBOX_KEY, null);
    closeSheets();
    render();
  }

  async function join(conf) {
    const btn = app.querySelector('form button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Joining…'; }
    try {
      const r = await api(conf, 'sync', ['']);
      S.conf = conf;
      S.cases = {};
      r.cases.forEach(c => { S.cases[c.id] = c; });
      S.lists = r.lists || S.lists;
      S.lastSync = r.now;
      S.lastFull = Date.now();
      S.outbox = [];
      S.invite = null;
      S.joinMsg = '';
      store(CONF_KEY, conf);
      saveData();
      render();
      toast('Welcome, ' + conf.name);
    } catch (e) {
      S.joinMsg = e.message;
      S.lastConf = conf;
      render();
    }
  }

  // ---------------------------------------------------------------- events

  const ACTIONS = {
    add: () => openForm(null),
    edit: el => openForm(el.dataset.id),
    status: el => openStatus(el.dataset.id),
    'set-status': el => {
      saveCase(el.dataset.id, { status: el.dataset.value });
      closeSheets();
      toast(el.dataset.value);
    },
    filter: el => { S.filter = el.dataset.key; store(PREFS_KEY, { filter: S.filter }); renderList(); },
    sync: () => sync({ full: true }),
    menu: () => openMenu(),
    install: () => {
      const ev = S.installPrompt;
      if (!ev) return;
      ev.prompt();
      ev.userChoice.then(() => { S.installPrompt = null; closeSheets(); render(); });
    },
    delete: async el => {
      const c = S.cases[el.dataset.id];
      if (!c || !await confirmSheet('Delete ' + c.name + '?', 'The case is removed from the list for everyone.', 'Delete')) return;
      removeCase(el.dataset.id);
      closeSheets();
      toast('Case deleted');
    },
    leave: async () => {
      if (await confirmSheet('Leave this list?', 'The list is removed from this phone only. Nothing is deleted for others.', 'Leave')) leave('');
    },
  };

  document.addEventListener('click', e => {
    const pick = e.target.closest('[data-pick-status]');
    if (pick) {
      const form = pick.closest('form');
      form.elements.status.value = pick.dataset.pickStatus;
      form.querySelectorAll('[data-pick-status]').forEach(b => b.classList.toggle('on', b === pick));
      return;
    }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const link = e.target.closest('a[href]');
    if (link && !link.dataset.act) return; // call / WhatsApp links inside a card
    e.preventDefault();
    e.stopPropagation();
    if (ACTIONS[el.dataset.act]) ACTIONS[el.dataset.act](el);
  });

  document.addEventListener('input', e => {
    if (e.target.id === 'q') { S.q = e.target.value; renderList(); }
    if (e.target.id === 'f-phone') phoneWarning(e.target.closest('.sheet'), e.target.value, e.target.form.dataset.id);
  });

  document.addEventListener('submit', e => {
    const form = e.target;
    e.preventDefault();
    const f = form.elements;
    if (form.dataset.form === 'case') {
      const name = f.name.value.trim();
      if (!name) { f.name.focus(); return; }
      const fields = {
        name: name,
        phone: f.phone.value.trim() ? localPhone(f.phone.value) : '',
        diagnosis: f.diagnosis.value.trim(),
        hospital: f.hospital.value,
        consultant: f.consultant.value,
        status: f.status.value,
        urgent: f.urgent.checked,
        note: f.note.value.trim(),
      };
      const id = form.dataset.id;
      if (id) {
        // Send only what changed, so two people editing different fields of a case don't undo each other.
        const old = S.cases[id] || {};
        Object.keys(fields).forEach(k => { if (fields[k] === old[k] || (!fields[k] && !old[k])) delete fields[k]; });
        if (Object.keys(fields).length) saveCase(id, fields);
      } else {
        saveCase(newId(), fields);
      }
      closeSheets();
      toast(id ? 'Saved' : 'Added to the list');
    } else if (form.dataset.form === 'join') {
      const invite = S.invite || parseInvite(f.link && f.link.value);
      const name = f.name.value.trim();
      if (!invite) { S.joinMsg = 'That doesn’t look like an invite link. Ask for the link again.'; render(); return; }
      if (!name) { f.name.focus(); return; }
      join({ url: invite.u, key: invite.k, team: invite.t || '', name: name });
    } else if (form.dataset.form === 'owner') {
      const conf = { url: f.url.value.trim(), key: f.key.value.trim(), team: f.team.value.trim(), name: f.name.value.trim() };
      if (!/\/exec$/.test(conf.url) || !conf.key || !conf.name) { S.joinMsg = 'Fill in the list name, server link (ending in /exec), team key and your name.'; render(); return; }
      join(conf);
    } else if (form.dataset.form === 'rename') {
      const name = f.name.value.trim();
      if (!name) return;
      S.conf.name = name;
      store(CONF_KEY, S.conf);
      closeSheets();
      render();
      toast('Name saved');
    }
  });

  window.addEventListener('hashchange', () => {
    const inv = parseInvite(location.hash);
    if (!inv) return;
    history.replaceState(null, '', location.pathname + location.search);
    if (S.conf && S.conf.key === inv.k && S.conf.url === inv.u) return;
    S.invite = inv;
    S.conf = null;
    render();
  });

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    S.installPrompt = e;
    if (S.conf) render();
  });

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  window.addEventListener('online', () => sync());

  // ---------------------------------------------------------------- start

  function init() {
    const inv = parseInvite(location.hash);
    if (inv) history.replaceState(null, '', location.pathname + location.search);
    S.conf = load(CONF_KEY, null);
    const data = load(DATA_KEY, null);
    if (data) Object.assign(S, { cases: data.cases || {}, lists: data.lists || S.lists, lastSync: data.lastSync || '', lastFull: data.lastFull || 0 });
    S.outbox = load(OUTBOX_KEY, []);
    S.filter = (load(PREFS_KEY, {}) || {}).filter || 'active';
    if (inv && !(S.conf && S.conf.key === inv.k && S.conf.url === inv.u)) {
      S.invite = inv;
      S.lastConf = S.conf;
      S.conf = null;
    }
    render();
    if (S.conf) sync();
    setInterval(() => { if (document.visibilityState === 'visible') sync(); }, POLL_MS);
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('sw.js').catch(() => { /* works without offline support */ });
    }
  }

  init();
})();
