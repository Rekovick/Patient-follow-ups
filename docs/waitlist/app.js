(function () {
  'use strict';

  // The list lives on this phone and is synced with the department's Apps Script server.
  // Changes are shown at once and queued, so the app never waits for the network.

  const CONF_KEY = 'waitlist.conf.v1';
  const DATA_KEY = 'waitlist.data.v1';
  const OUTBOX_KEY = 'waitlist.outbox.v1';
  const PREFS_KEY = 'waitlist.prefs.v1';
  const THUMB_CACHE = 'waiting-list-thumbs-v1';
  const POLL_MS = 20000;
  const FULL_SYNC_MS = 10 * 60000;
  const KINDS = { decision: 'Decision', preop: 'Pre-op', postop: 'Post-op' };

  const app = document.getElementById('app');
  const overlayRoot = document.getElementById('overlay-root');

  const S = {
    conf: null,          // {url, key, name, team}
    cases: {},           // id -> case
    lists: { statuses: ['Waiting', 'Done'] },
    lastSync: '',
    lastFull: 0,
    outbox: [],          // [{id, op: 'save'|'remove', fields}]
    uploads: [],         // [{caseId, kind, ph: {dataUrl, thumb}}] — photos waiting to be sent
    uploading: false,
    view: { name: 'list' },
    depth: 0,
    filter: 'active',
    q: '',
    sync: 'ok',          // ok | syncing | offline | error
    syncing: false,
    joinMsg: '',
    installPrompt: null,
    thumbs: {},          // fileId -> dataUrl
    thumbLoading: {},
    full: {},
    draftPhotos: { decision: [], preop: [] },
    viewer: null,
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
      runUploads();
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
    S.cases[id] = Object.assign({}, existing || { id: id, createdAt: now, createdBy: S.conf.name, status: S.lists.statuses[0], photos: emptyPhotos() }, fields,
      { updatedAt: now, updatedBy: S.conf.name });
    queue({ op: 'save', id: id, fields: fields });
  }

  function removeCase(id) {
    delete S.cases[id];
    S.uploads = S.uploads.filter(u => u.caseId !== id);
    queue({ op: 'remove', id: id });
  }

  function newId() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function emptyPhotos() {
    return { decision: [], preop: [], postop: [] };
  }

  function photosOf(c) {
    return Object.assign(emptyPhotos(), (c && c.photos) || {});
  }

  // ---------------------------------------------------------------- photos

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img: img, url: url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read "' + file.name + '". Try a JPG or PNG photo.')); };
      img.src = url;
    });
  }

  function toJpeg(img, max, quality) {
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  /** Resizes photos on the phone before upload, so they go quickly over mobile data. */
  async function processFiles(files) {
    const out = [];
    for (const file of Array.from(files || [])) {
      try {
        const r = await readImage(file);
        out.push({ dataUrl: toJpeg(r.img, 1600, 0.8), thumb: toJpeg(r.img, 320, 0.7) });
        URL.revokeObjectURL(r.url);
      } catch (e) {
        toast(e.message, 'error');
      }
    }
    return out;
  }

  function queueUploads(caseId, kind, items) {
    items.forEach(ph => S.uploads.push({ caseId: caseId, kind: kind, ph: ph }));
    updateUploadBar();
    refreshView();
    runUploads();
  }

  /** Sends waiting photos one at a time, once their case has reached the server. */
  async function runUploads() {
    if (S.uploading || !S.conf) return;
    S.uploading = true;
    let sent = 0;
    try {
      while (S.uploads.length) {
        const u = S.uploads[0];
        if (!S.cases[u.caseId]) { S.uploads.shift(); continue; }
        if (isPending(u.caseId)) break; // the case itself isn't on the server yet; sync() will call us again
        try {
          const c = await api(S.conf, 'uploadPhoto', [u.caseId, u.kind, { dataUrl: u.ph.dataUrl, thumbDataUrl: u.ph.thumb }]);
          const list = photosOf(c)[u.kind];
          const added = list[list.length - 1];
          if (added) rememberThumb(added.thumbId || added.id, u.ph.thumb);
          if (!isPending(c.id)) S.cases[c.id] = c;
          S.uploads.shift();
          sent++;
          saveData();
        } catch (e) {
          if (e.offline) break;
          if (e.denied) { leave('This invite link no longer works. Ask a colleague for the new one.'); return; }
          S.uploads.shift();
          toast('A photo was not saved: ' + e.message, 'error');
        }
        updateUploadBar();
        refreshView();
      }
    } finally {
      S.uploading = false;
      updateUploadBar();
      refreshView();
    }
    if (sent && !S.uploads.length) toast(sent + ' photo' + (sent > 1 ? 's' : '') + ' uploaded');
  }

  function updateUploadBar() {
    let bar = document.getElementById('upload-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'upload-bar';
      bar.setAttribute('role', 'status');
      document.body.appendChild(bar);
    }
    const n = S.uploads.length;
    bar.hidden = !n;
    const waiting = n && (S.sync === 'offline' || !S.uploading);
    bar.innerHTML = n ? '<span class="dot"></span>' + (waiting ? n + ' photo' + (n > 1 ? 's' : '') + ' waiting for signal' : 'Uploading ' + n + ' photo' + (n > 1 ? 's' : '') + '… keep the app open') : '';
  }

  // Thumbnails are kept in the phone's cache storage, so they show instantly next time, even offline.
  function cacheKey(id) {
    return new Request(location.href.split('#')[0] + '__thumb/' + encodeURIComponent(id));
  }

  function rememberThumb(id, dataUrl) {
    S.thumbs[id] = dataUrl;
    try {
      if (window.caches) caches.open(THUMB_CACHE).then(c => c.put(cacheKey(id), new Response(dataUrl))).catch(() => {});
    } catch (e) { /* no cache storage here */ }
  }

  async function cachedThumb(id) {
    try {
      if (!window.caches) return null;
      const hit = await (await caches.open(THUMB_CACHE)).match(cacheKey(id));
      return hit ? await hit.text() : null;
    } catch (e) {
      return null;
    }
  }

  async function hydrateThumbs() {
    const imgs = Array.from(document.querySelectorAll('img[data-fid]'));
    const need = [];
    for (const img of imgs) {
      const id = img.dataset.fid;
      if (S.thumbs[id]) { if (img.getAttribute('src') !== S.thumbs[id]) img.src = S.thumbs[id]; continue; }
      if (S.thumbLoading[id] || need.indexOf(id) >= 0) continue;
      const cached = await cachedThumb(id);
      if (cached) { S.thumbs[id] = cached; img.src = cached; } else need.push(id);
    }
    if (!need.length || !S.conf) return;
    need.forEach(id => { S.thumbLoading[id] = true; });
    for (let i = 0; i < need.length; i += 12) {
      const chunk = need.slice(i, i + 12);
      try {
        const map = await api(S.conf, 'getPhotoData', [chunk]);
        chunk.forEach(id => {
          if (map[id]) rememberThumb(id, map[id]);
          document.querySelectorAll('img[data-fid="' + id + '"]').forEach(img => { if (map[id]) img.src = map[id]; });
        });
      } catch (e) { /* offline: tried again on the next render */ }
      chunk.forEach(id => { delete S.thumbLoading[id]; });
    }
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

  function waitingText(c) {
    const d = daysSince(c.createdAt);
    return d ? d + (d === 1 ? ' day' : ' days') + ' waiting' : 'added today';
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
    back: '<path d="m15 18-6-6 6-6"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
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

  // ---------------------------------------------------------------- navigation

  function go(view) {
    S.view = view;
    try { history.pushState(view, ''); S.depth++; } catch (e) { /* no history */ }
    closeSheets();
    render();
    window.scrollTo(0, 0);
  }

  function back() {
    if (S.depth > 0) history.back();
    else { S.view = { name: 'list' }; render(); }
  }

  window.addEventListener('popstate', e => {
    S.depth = Math.max(0, S.depth - 1);
    S.view = (e.state && e.state.name) ? e.state : { name: 'list' };
    closeSheets();
    closeViewer();
    render();
  });

  // ---------------------------------------------------------------- views

  function render() {
    if (!S.conf) renderJoin();
    else if (S.view.name === 'case') renderCase(S.view.id);
    else renderMain();
    hydrateThumbs();
  }

  /** Redraws the current screen after data changed, keeping the scroll position and the search box. */
  function refreshView() {
    if (!S.conf) return;
    if (S.view.name === 'case') {
      const y = window.scrollY;
      renderCase(S.view.id);
      window.scrollTo(0, y);
      hydrateThumbs();
    } else if (document.getElementById('list')) {
      renderList();
    }
    if (S.viewer) drawViewer();
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

  function queuePositions() {
    const done = doneStatus();
    const pos = {};
    ordered(Object.values(S.cases).filter(c => c.status !== done)).forEach((c, i) => { pos[c.id] = i + 1; });
    return pos;
  }

  function matchesSearch(c, q) {
    if (!q) return true;
    const hay = normText([c.name, c.phone, localPhone(c.phone), c.diagnosis, c.status, c.note, c.createdBy].join(' '));
    const digits = q.replace(/[\s+\-()]/g, '');
    if (/^\d{4,}$/.test(digits) && localPhone(c.phone).indexOf(digits.replace(/^(00)?20/, '').replace(/^0/, '')) >= 0) return true;
    return q.split(/\s+/).every(w => hay.indexOf(w) >= 0);
  }

  function renderList() {
    const all = Object.values(S.cases);
    const done = doneStatus();
    const pos = queuePositions();
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
      chip('active', 'Active') + chip('urgent', 'Urgent') + chip('mine', 'Added by me') +
      S.lists.statuses.map(s => chip('s:' + s, s)).join('');
    document.getElementById('count').textContent = Object.keys(pos).length + ' waiting · you are ' + S.conf.name;

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

  function photoCount(c) {
    const p = photosOf(c);
    return p.decision.length + p.preop.length + p.postop.length + S.uploads.filter(u => u.caseId === c.id).length;
  }

  function contactRow(c) {
    const phone = localPhone(c.phone);
    if (!phone) return '';
    return '<div class="bottom"><a class="phone" href="tel:+' + intlPhone(phone) + '" dir="ltr">' + esc(prettyPhone(phone)) + '</a>' +
      '<a class="round call" href="tel:+' + intlPhone(phone) + '" aria-label="Call">' + icon('phone') + '</a>' +
      '<a class="round wa" href="https://wa.me/' + intlPhone(phone) + '" target="_blank" rel="noopener" aria-label="WhatsApp">' + icon('wa') + '</a></div>';
  }

  function cardHtml(c, position) {
    const n = photoCount(c);
    return '<article class="card' + (c.urgent ? ' urgent' : '') + (isPending(c.id) ? ' pending' : '') + '" data-act="open" data-id="' + esc(c.id) + '">' +
      '<div class="top"><span class="pos">' + (position ? '#' + position : '') + '</span>' +
        '<h3 dir="auto">' + esc(c.name) + '</h3>' +
        (c.urgent ? '<span class="tag-urgent">Urgent</span>' : '') +
        '<button class="badge tone-' + tone(c.status) + '" data-act="status" data-id="' + esc(c.id) + '">' + esc(c.status) + '</button></div>' +
      (c.diagnosis ? '<div class="meta" dir="auto">' + esc(c.diagnosis) + '</div>' : '') +
      (c.note ? '<div class="note" dir="auto">' + esc(c.note) + '</div>' : '') +
      contactRow(c) +
      '<div class="by">' + (n ? '<span class="pics">' + icon('camera') + n + '</span>' : '') +
        'Added by ' + esc(c.createdBy || '?') + ' · ' + waitingText(c) +
        (isPending(c.id) ? ' · <b>not sent yet</b>' : '') + '</div>' +
      '</article>';
  }

  function renderCase(id) {
    const c = S.cases[id];
    if (!c) {
      app.innerHTML = '<header class="head"><div class="head-row"><button class="icon-btn" data-act="back" aria-label="Back">' + icon('back') + '</button><h1>Case</h1></div></header>' +
        '<div class="empty"><p><b>This case is no longer on the list</b></p><p class="small">Someone may have deleted it.</p></div>';
      return;
    }
    const done = c.status === doneStatus();
    const pos = queuePositions()[c.id];
    app.innerHTML =
      '<header class="head"><div class="head-row">' +
        '<button class="icon-btn" data-act="back" aria-label="Back">' + icon('back') + '</button>' +
        '<h1 dir="auto">' + esc(c.name) + '<small>' + (pos ? '#' + pos + ' on the list · ' : '') + waitingText(c) + '</small></h1>' +
        '<button class="icon-btn" data-act="edit" data-id="' + esc(c.id) + '" aria-label="Edit">' + icon('edit') + '</button>' +
      '</div></header>' +
      '<div class="page">' +
        '<section class="panel hero' + (c.urgent ? ' urgent' : '') + '">' +
          '<div class="top"><h2 dir="auto">' + esc(c.name) + '</h2>' + (c.urgent ? '<span class="tag-urgent">Urgent</span>' : '') +
            '<span class="badge tone-' + tone(c.status) + '">' + esc(c.status) + '</span></div>' +
          (c.diagnosis ? '<p class="dx" dir="auto">' + esc(c.diagnosis) + '</p>' : '') +
          (c.note ? '<div class="note" dir="auto">' + esc(c.note) + '</div>' : '') +
          contactRow(c) +
        '</section>' +
        '<section class="panel"><h3>Status</h3><div class="statuses">' + S.lists.statuses.map(s =>
          '<button class="badge tone-' + tone(s) + (s === c.status ? ' on' : '') + '" data-act="set-status" data-id="' + esc(c.id) + '" data-value="' + esc(s) + '">' + esc(s) + '</button>').join('') +
        '</div></section>' +
        photoPanel(c, 'decision') +
        photoPanel(c, 'preop') +
        (done ? photoPanel(c, 'postop')
          : '<section class="panel locked"><h3>' + icon('lock') + 'Post-op photos</h3><p class="small muted">Available once the status is “' + esc(doneStatus()) + '”.</p></section>') +
        '<section class="panel"><p class="small muted">Added by <b>' + esc(c.createdBy || '?') + '</b> ' + esc(ago(c.createdAt)) +
          (c.updatedBy ? ' · last change by <b>' + esc(c.updatedBy) + '</b> ' + esc(ago(c.updatedAt)) : '') + '</p>' +
          '<div class="row"><button class="btn" data-act="edit" data-id="' + esc(c.id) + '">' + icon('edit') + 'Edit details</button>' +
          '<button class="btn danger" data-act="delete" data-id="' + esc(c.id) + '">' + icon('trash') + 'Delete</button></div></section>' +
      '</div>';
  }

  function photoButtons(kind, primary) {
    return '<div class="photo-actions">' +
      '<label class="btn file-btn' + (primary ? ' primary' : '') + '">' + icon('camera') + 'Camera<input type="file" accept="image/*" capture="environment" data-photo-kind="' + kind + '"></label>' +
      '<label class="btn file-btn">' + icon('image') + 'Upload<input type="file" accept="image/*" multiple data-photo-kind="' + kind + '"></label>' +
      '</div>';
  }

  function photoPanel(c, kind) {
    const list = photosOf(c)[kind];
    const waiting = S.uploads.filter(u => u.caseId === c.id && u.kind === kind);
    const tiles = list.map((ph, i) => {
      const fid = ph.thumbId || ph.id;
      return '<button class="photo" data-act="view-photo" data-kind="' + kind + '" data-index="' + i + '" aria-label="Open photo">' +
        '<img data-fid="' + esc(fid) + '"' + (S.thumbs[fid] ? ' src="' + esc(S.thumbs[fid]) + '"' : '') + ' alt=""></button>';
    }).concat(waiting.map(u => '<div class="photo uploading"><img src="' + esc(u.ph.thumb) + '" alt=""><span class="spin"></span></div>'));
    return '<section class="panel"><h3>' + icon(kind === 'decision' ? 'edit' : 'image') + KINDS[kind] + (kind === 'decision' ? ' photo' : ' photos') +
      (list.length ? ' <span class="count">' + list.length + '</span>' : '') + '</h3>' +
      (tiles.length ? '<div class="photos">' + tiles.join('') + '</div>' : '<p class="small muted">No photos yet.</p>') +
      photoButtons(kind, kind === 'decision' && !list.length) + '</section>';
  }

  function setSync(state, message) {
    S.sync = state;
    updateUploadBar();
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
    overlayRoot.querySelectorAll('.scrim').forEach(s => s.remove());
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

  function draftPhotosHtml(kind) {
    const list = S.draftPhotos[kind];
    return (list.length ? '<div class="photos">' + list.map((ph, i) =>
      '<div class="photo"><img src="' + esc(ph.thumb) + '" alt=""><button type="button" class="x" data-remove-draft="' + kind + ':' + i + '" aria-label="Remove">' + icon('x') + '</button></div>').join('') + '</div>' : '') +
      photoButtons(kind, kind === 'decision' && !list.length);
  }

  function openForm(id) {
    const c = id ? S.cases[id] : null;
    const v = c || { status: S.lists.statuses[0], urgent: false };
    if (!c) S.draftPhotos = { decision: [], preop: [] };
    const sheet = openSheet(
      '<h3>' + (c ? 'Edit case' : 'Add case') + '</h3>' +
      '<form data-form="case" data-id="' + esc(id || '') + '">' +
        '<div class="field"><label for="f-name">Patient name</label><input id="f-name" name="name" dir="auto" autocomplete="off" value="' + esc(v.name) + '" required></div>' +
        '<div class="field"><label for="f-phone">Phone</label><input id="f-phone" name="phone" inputmode="tel" dir="ltr" autocomplete="off" placeholder="01xxxxxxxxx" value="' + esc(v.phone) + '"><div id="phone-warn"></div></div>' +
        '<div class="field"><label for="f-dx">Diagnosis / operation</label><input id="f-dx" name="diagnosis" dir="auto" autocomplete="off" value="' + esc(v.diagnosis) + '"></div>' +
        '<div class="field"><label>Status</label><div class="statuses">' + S.lists.statuses.map(s =>
          '<button type="button" class="badge tone-' + tone(s) + (s === v.status ? ' on' : '') + '" data-pick-status="' + esc(s) + '">' + esc(s) + '</button>').join('') +
          '</div><input type="hidden" name="status" value="' + esc(v.status) + '"></div>' +
        '<label class="switch"><input type="checkbox" name="urgent"' + (v.urgent ? ' checked' : '') + '> Urgent</label>' +
        '<div class="field"><label for="f-note">Note</label><textarea id="f-note" name="note" dir="auto">' + esc(v.note) + '</textarea></div>' +
        (c ? '' :
          '<div class="field"><label>Decision photo</label><div id="draft-decision">' + draftPhotosHtml('decision') + '</div></div>' +
          '<div class="field"><label>Pre-op photos (optional)</label><div id="draft-preop">' + draftPhotosHtml('preop') + '</div></div>') +
        '<div class="row"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div>' +
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

  // ---------------------------------------------------------------- photo viewer

  function openViewer(caseId, kind, index) {
    S.viewer = { caseId: caseId, kind: kind, index: index };
    drawViewer();
  }

  function closeViewer() {
    S.viewer = null;
    const v = overlayRoot.querySelector('.viewer');
    if (v) v.remove();
  }

  function drawViewer() {
    const v = S.viewer;
    const list = v && S.cases[v.caseId] ? photosOf(S.cases[v.caseId])[v.kind] : [];
    if (!list.length) { closeViewer(); return; }
    v.index = Math.max(0, Math.min(v.index, list.length - 1));
    const ph = list[v.index];
    const src = S.full[ph.id] || S.thumbs[ph.thumbId || ph.id] || '';
    let el = overlayRoot.querySelector('.viewer');
    if (!el) {
      el = document.createElement('div');
      el.className = 'viewer';
      overlayRoot.appendChild(el);
      let x0 = null;
      el.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
      el.addEventListener('touchend', e => {
        if (x0 === null) return;
        const dx = e.changedTouches[0].clientX - x0;
        x0 = null;
        if (Math.abs(dx) > 50) stepViewer(dx < 0 ? 1 : -1);
      });
    }
    el.innerHTML =
      '<div class="viewer-bar">' +
        '<button class="icon-btn" data-act="viewer-close" aria-label="Close">' + icon('x') + '</button>' +
        '<span class="t"><b>' + KINDS[v.kind] + '</b> · ' + (v.index + 1) + ' / ' + list.length + '<br><span class="small">' + esc(ago(ph.at)) + (ph.by ? ' · ' + esc(ph.by) : '') + '</span></span>' +
        '<a class="icon-btn" href="https://drive.google.com/file/d/' + esc(ph.id) + '/view" target="_blank" rel="noopener" aria-label="Open in Google Drive">' + icon('external') + '</a>' +
        '<button class="icon-btn" data-act="viewer-delete" aria-label="Delete photo">' + icon('trash') + '</button>' +
      '</div>' +
      '<div class="viewer-img">' + (src ? '<img src="' + esc(src) + '" alt="">' : '') +
        (S.full[ph.id] ? '' : '<span class="spin big"></span>') +
        (list.length > 1 ? '<button class="round nav prev" data-act="viewer-prev" aria-label="Previous">' + icon('left') + '</button><button class="round nav next" data-act="viewer-next" aria-label="Next">' + icon('right') + '</button>' : '') +
      '</div>';
    if (!S.full[ph.id]) {
      api(S.conf, 'getPhotoData', [[ph.id]]).then(map => {
        if (map[ph.id]) {
          S.full[ph.id] = map[ph.id];
          if (S.viewer && list[S.viewer.index] && list[S.viewer.index].id === ph.id) drawViewer();
        }
      }).catch(e => toast(e.offline ? 'The full photo needs a signal.' : e.message, 'error'));
    }
  }

  function stepViewer(dir) {
    const v = S.viewer;
    if (!v) return;
    const n = photosOf(S.cases[v.caseId])[v.kind].length;
    if (n < 2) return;
    v.index = (v.index + dir + n) % n;
    drawViewer();
  }

  // ---------------------------------------------------------------- invite & leaving

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
    S.uploads = [];
    S.lastSync = '';
    S.lastFull = 0;
    S.joinMsg = message || '';
    S.view = { name: 'list' };
    store(CONF_KEY, null);
    store(DATA_KEY, null);
    store(OUTBOX_KEY, null);
    try { if (window.caches) caches.delete(THUMB_CACHE); } catch (e) { /* none */ }
    closeSheets();
    closeViewer();
    updateUploadBar();
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
      S.view = { name: 'list' };
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
    open: el => go({ name: 'case', id: el.dataset.id }),
    back: () => back(),
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
      if (!c || !await confirmSheet('Delete ' + c.name + '?', 'The case and its photos are removed for everyone. Photos stay in the Drive trash for 30 days.', 'Delete')) return;
      removeCase(el.dataset.id);
      closeSheets();
      if (S.view.name === 'case') back();
      toast('Case deleted');
    },
    leave: async () => {
      if (await confirmSheet('Leave this list?', 'The list is removed from this phone only. Nothing is deleted for others.', 'Leave')) leave('');
    },
    'view-photo': el => openViewer(S.view.id, el.dataset.kind, Number(el.dataset.index)),
    'viewer-close': () => closeViewer(),
    'viewer-prev': () => stepViewer(-1),
    'viewer-next': () => stepViewer(1),
    'viewer-delete': async () => {
      const v = S.viewer;
      const ph = photosOf(S.cases[v.caseId])[v.kind][v.index];
      if (!await confirmSheet('Delete this photo?', 'It is removed for everyone and moved to the Drive trash.', 'Delete')) return;
      try {
        const c = await api(S.conf, 'deletePhoto', [v.caseId, v.kind, ph.id]);
        if (c && !isPending(c.id)) S.cases[c.id] = c;
        saveData();
        toast('Photo deleted');
        refreshView();
      } catch (e) {
        toast(e.offline ? 'Deleting a photo needs a signal.' : e.message, 'error');
      }
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
    const rm = e.target.closest('[data-remove-draft]');
    if (rm) {
      const parts = rm.dataset.removeDraft.split(':');
      S.draftPhotos[parts[0]].splice(Number(parts[1]), 1);
      document.getElementById('draft-' + parts[0]).innerHTML = draftPhotosHtml(parts[0]);
      return;
    }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const link = e.target.closest('a[href]');
    if (link && !link.dataset.act) return; // call / WhatsApp / Drive links
    e.preventDefault();
    e.stopPropagation();
    if (ACTIONS[el.dataset.act]) ACTIONS[el.dataset.act](el);
  });

  document.addEventListener('change', async e => {
    const input = e.target;
    if (!input.dataset || !input.dataset.photoKind) return;
    const kind = input.dataset.photoKind;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    const items = await processFiles(files);
    if (!items.length) return;
    if (input.closest('form[data-form="case"]')) {
      S.draftPhotos[kind] = S.draftPhotos[kind].concat(items);
      document.getElementById('draft-' + kind).innerHTML = draftPhotosHtml(kind);
    } else if (S.view.name === 'case') {
      queueUploads(S.view.id, kind, items);
    }
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
        closeSheets();
        toast('Saved');
      } else {
        const newCase = newId();
        saveCase(newCase, fields);
        const photos = S.draftPhotos;
        S.draftPhotos = { decision: [], preop: [] };
        closeSheets();
        go({ name: 'case', id: newCase });
        if (photos.decision.length) queueUploads(newCase, 'decision', photos.decision);
        if (photos.preop.length) queueUploads(newCase, 'preop', photos.preop);
        toast('Added to the list');
      }
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

  document.addEventListener('keydown', e => {
    if (!S.viewer) return;
    if (e.key === 'Escape') closeViewer();
    if (e.key === 'ArrowLeft') stepViewer(-1);
    if (e.key === 'ArrowRight') stepViewer(1);
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
    if (S.conf && S.view.name === 'list') render();
  });

  window.addEventListener('beforeunload', e => {
    if (!S.uploads.length) return;
    e.preventDefault();
    e.returnValue = '';
  });

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
  window.addEventListener('online', () => sync());

  // ---------------------------------------------------------------- start

  function init() {
    const inv = parseInvite(location.hash);
    try { history.replaceState({ name: 'list' }, '', location.pathname + location.search); } catch (e) { /* no history */ }
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
