/**
 * Surgery Follow-ups — backend (Google Apps Script).
 *
 * Everything is stored in the Google Drive of the account that deploys the app.
 * It is created automatically the first time the app is opened:
 *
 *   Surgery Follow-ups/                  <- share THIS folder to give someone access
 *     Surgery Follow-ups — Data          <- Google Sheet ("Patients" + "Lists" tabs)
 *     Photos/
 *       <Patient name> (<id>)/           <- full-size photos of each patient
 *       _thumbnails/                     <- small previews used by the app
 */

const APP_TITLE = 'Surgery Follow-ups';
const DONE_STATUS = 'Done';
const PHOTO_KINDS = ['decision', 'preop', 'postop'];
const SHEET_PATIENTS = 'Patients';
const SHEET_LISTS = 'Lists';
const SCHEMA_VERSION = 1;

const PATIENT_COLUMNS = [
  'id', 'name', 'phone', 'hospital', 'consultant', 'classification', 'status',
  'surgeryDate', 'age', 'procedure', 'hint', 'anesthesia', 'photos', 'notes',
  'history', 'archived', 'folderId', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy',
];
const JSON_COLUMNS = ['anesthesia', 'photos', 'notes', 'history'];
const EDITABLE_FIELDS = [
  'name', 'phone', 'hospital', 'consultant', 'classification', 'status',
  'surgeryDate', 'age', 'procedure', 'hint', 'anesthesia', 'archived',
];

const LIST_DEFS = [
  { key: 'hospitals', header: 'Hospitals', defaults: ['El Sahel', 'El Mabara', '15th of May'] },
  { key: 'consultants', header: 'Consultants', defaults: ['Dr Ahmed Elghity', 'Dr Alaa Ahmed', 'General'] },
  { key: 'classifications', header: 'Classifications', defaults: ['Vascular', 'Spine'] },
  { key: 'statuses', header: 'Statuses', defaults: ['Waiting for paperwork', 'Waiting for labs', 'Ready for surgery', DONE_STATUS] },
  {
    key: 'anesthesiaItems',
    header: 'Anesthesia checklist',
    defaults: [
      'CBC', 'Coagulation profile (PT / INR)', 'Kidney functions', 'Liver functions',
      'Random blood sugar / HbA1c', 'Viral markers (HBV / HCV / HIV)', 'ECG', 'Chest X-ray',
      'Echocardiography', 'Anesthesia consultation', 'Consent signed', 'Blood units reserved',
    ],
  },
  {
    key: 'templates',
    header: 'WhatsApp templates',
    defaults: [
      'مرحباً {name}، برجاء إحضار التحاليل المطلوبة في أقرب وقت.',
      'مرحباً {name}، برجاء استكمال الأوراق المطلوبة للعملية.',
      'مرحباً {name}، تم تحديد موعد العملية يوم {date} في مستشفى {hospital}.',
      'مرحباً {name}، برجاء الصيام عن الأكل والشرب من منتصف الليل قبل العملية.',
      'مرحباً {name}، نطمئن عليك بعد العملية، كيف حالك اليوم؟',
    ],
  },
];

// ---------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------

function doGet() {
  // The single-file installer (install/Code.gs) embeds the page as APP_HTML;
  // the multi-file project builds it from Index/Styles/Client instead.
  const page = typeof APP_HTML === 'string'
    ? HtmlService.createHtmlOutput(APP_HTML)
    : HtmlService.createTemplateFromFile('Index').evaluate();
  return page
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-capable', 'yes')
    .addMetaTag('apple-mobile-web-app-title', APP_TITLE);
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Run this once from the editor to create the Sheet + Drive folder and grant permissions. */
function setup() {
  const store = openStore_();
  Logger.log('Data sheet: ' + store.ss.getUrl());
  Logger.log('Drive folder: ' + DriveApp.getFolderById(store.ids.ROOT_FOLDER_ID).getUrl());
}

// ---------------------------------------------------------------------------
// Public API — called from the browser with google.script.run
// ---------------------------------------------------------------------------

function getBootstrap() {
  const store = openStore_();
  return {
    user: currentUser_(),
    lists: readLists_(store.ss),
    patients: readPatients_(store.ss),
    spreadsheetUrl: store.ss.getUrl(),
    folderUrl: DriveApp.getFolderById(store.ids.ROOT_FOLDER_ID).getUrl(),
    doneStatus: DONE_STATUS,
  };
}

function getPatients() {
  return readPatients_(openStore_().ss);
}

function createPatient(data) {
  const store = openStore_();
  return withLock_(() => {
    const sh = store.ss.getSheetByName(SHEET_PATIENTS);
    const headers = headers_(sh);
    const now = nowIso_();
    const user = currentUser_();
    const p = blankPatient_();
    applyEdits_(p, data);
    if (!p.name) throw new Error('Patient name is required.');
    p.id = newId_();
    p.createdAt = p.updatedAt = now;
    p.createdBy = p.updatedBy = user;
    p.history = [{ at: now, by: user, type: 'created', to: p.status }];

    const row = sh.getLastRow() + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
    sh.getRange(row, 1, 1, headers.length)
      .setNumberFormat('@')
      .setValues([patientToRow_(headers, p, null)]);
    return p;
  });
}

function updatePatient(id, fields) {
  const store = openStore_();
  return mutatePatient_(store, id, (p, ctx) => {
    const oldStatus = p.status;
    const oldName = p.name;
    applyEdits_(p, fields);
    if (!p.name) throw new Error('Patient name is required.');
    if (p.status !== oldStatus) {
      p.history.push({ at: ctx.now, by: ctx.user, type: 'status', from: oldStatus, to: p.status });
    }
    if (p.name !== oldName && p.folderId) {
      try { DriveApp.getFolderById(p.folderId).setName(folderName_(p)); } catch (e) { /* folder gone */ }
    }
  });
}

function deletePatient(id) {
  const store = openStore_();
  const removed = withLock_(() => {
    const sh = store.ss.getSheetByName(SHEET_PATIENTS);
    const headers = headers_(sh);
    const row = findRow_(sh, headers, id);
    if (!row) return null;
    const p = rowToPatient_(headers, sh.getRange(row, 1, 1, headers.length).getValues()[0]);
    sh.deleteRow(row);
    return p;
  });
  if (removed) {
    // Files go to the Drive trash, so they can still be recovered for 30 days.
    if (removed.folderId) trash_(() => DriveApp.getFolderById(removed.folderId));
    PHOTO_KINDS.forEach(kind => removed.photos[kind].forEach(ph => {
      if (ph.thumbId) trash_(() => DriveApp.getFileById(ph.thumbId));
    }));
  }
  return true;
}

function uploadPhoto(id, kind, photo) {
  if (PHOTO_KINDS.indexOf(kind) < 0) throw new Error('Unknown photo type: ' + kind);
  const store = openStore_();
  const current = getPatientById_(store, id);
  const folder = patientFolder_(store, current);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmmss');
  const base = kind + ' ' + stamp;
  const file = folder.createFile(dataUrlToBlob_(photo.dataUrl, base + '.jpg'));
  const thumb = photo.thumbDataUrl
    ? DriveApp.getFolderById(store.ids.THUMBS_FOLDER_ID)
      .createFile(dataUrlToBlob_(photo.thumbDataUrl, id + ' ' + base + '.jpg'))
    : null;
  return mutatePatient_(store, id, (p, ctx) => {
    p.folderId = p.folderId || folder.getId();
    p.photos[kind].push({
      id: file.getId(),
      thumbId: thumb ? thumb.getId() : '',
      at: ctx.now,
      by: ctx.user,
    });
  });
}

function deletePhoto(id, kind, fileId) {
  const store = openStore_();
  let removed = null;
  const p = mutatePatient_(store, id, (pt) => {
    const list = pt.photos[kind] || [];
    const idx = list.findIndex(ph => ph.id === fileId);
    if (idx >= 0) removed = list.splice(idx, 1)[0];
  });
  if (removed) {
    trash_(() => DriveApp.getFileById(removed.id));
    if (removed.thumbId) trash_(() => DriveApp.getFileById(removed.thumbId));
  }
  return p;
}

/** Returns {fileId: dataUrl} for the requested Drive images (thumbnails or full size). */
function getPhotoData(fileIds) {
  openStore_();
  const out = {};
  (fileIds || []).slice(0, 40).forEach(fid => {
    try {
      const blob = DriveApp.getFileById(fid).getBlob();
      out[fid] = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
    } catch (e) {
      out[fid] = null;
    }
  });
  return out;
}

function addNote(id, text) {
  const clean = String(text || '').trim().slice(0, 4000);
  if (!clean) throw new Error('Note is empty.');
  const store = openStore_();
  return mutatePatient_(store, id, (p, ctx) => {
    p.notes.push({
      id: newId_(),
      text: clean,
      at: ctx.now,
      by: ctx.user,
      phase: p.status === DONE_STATUS ? 'postop' : 'preop',
    });
  });
}

function deleteNote(id, noteId) {
  const store = openStore_();
  return mutatePatient_(store, id, (p) => {
    p.notes = p.notes.filter(n => n.id !== noteId);
  });
}

function saveLists(lists) {
  const store = openStore_();
  return withLock_(() => {
    const clean = {};
    LIST_DEFS.forEach(d => {
      clean[d.key] = uniq_((lists && lists[d.key]) || []).slice(0, 200);
    });
    if (clean.statuses.indexOf(DONE_STATUS) < 0) clean.statuses.push(DONE_STATUS);
    writeLists_(store.ss.getSheetByName(SHEET_LISTS), clean);
    return readLists_(store.ss);
  });
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function openStore_() {
  const props = PropertiesService.getScriptProperties();
  let ids = props.getProperties();
  if (!ids.SPREADSHEET_ID || !ids.THUMBS_FOLDER_ID) {
    withLock_(() => {
      ids = props.getProperties();
      if (ids.SPREADSHEET_ID && ids.THUMBS_FOLDER_ID) return;
      const root = DriveApp.createFolder(APP_TITLE);
      const ss = SpreadsheetApp.create(APP_TITLE + ' — Data');
      DriveApp.getFileById(ss.getId()).moveTo(root);
      const photos = root.createFolder('Photos');
      const thumbs = photos.createFolder('_thumbnails');
      props.setProperties({
        ROOT_FOLDER_ID: root.getId(),
        SPREADSHEET_ID: ss.getId(),
        PHOTOS_FOLDER_ID: photos.getId(),
        THUMBS_FOLDER_ID: thumbs.getId(),
      });
      ensureSchema_(ss, true);
    });
    ids = props.getProperties();
  }
  const ss = SpreadsheetApp.openById(ids.SPREADSHEET_ID);
  ensureSchema_(ss, false);
  return { ss: ss, ids: ids };
}

function ensureSchema_(ss, force) {
  const cache = CacheService.getScriptCache();
  const key = 'schema:' + SCHEMA_VERSION + ':' + ss.getId();
  if (!force && cache.get(key)) return;

  let sh = ss.getSheetByName(SHEET_PATIENTS);
  if (!sh) sh = ss.insertSheet(SHEET_PATIENTS, 0);
  const headers = headers_(sh);
  const missing = PATIENT_COLUMNS.filter(c => headers.indexOf(c) < 0);
  if (missing.length) {
    sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
    sh.getRange(1, 1, 1, headers.length + missing.length).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  // Plain-text format keeps leading zeros in phone numbers and stops dates being converted.
  sh.getRange(1, 1, sh.getMaxRows(), sh.getLastColumn()).setNumberFormat('@');

  if (!ss.getSheetByName(SHEET_LISTS)) {
    const defaults = {};
    LIST_DEFS.forEach(d => { defaults[d.key] = d.defaults.slice(); });
    writeLists_(ss.insertSheet(SHEET_LISTS), defaults);
  }
  if (force) {
    // Remove the empty default tab of a brand-new spreadsheet ("Sheet1" or its translation).
    ss.getSheets().forEach(s => {
      const name = s.getName();
      if (name !== SHEET_PATIENTS && name !== SHEET_LISTS && s.getLastRow() === 0) ss.deleteSheet(s);
    });
  }

  cache.put(key, '1', 21600);
}

function readLists_(ss) {
  const values = ss.getSheetByName(SHEET_LISTS).getDataRange().getValues();
  const headers = (values[0] || []).map(v => String(v).trim());
  const out = {};
  LIST_DEFS.forEach(d => {
    const c = headers.indexOf(d.header);
    out[d.key] = c < 0 ? d.defaults.slice() : uniq_(values.slice(1).map(r => r[c]));
  });
  if (out.statuses.indexOf(DONE_STATUS) < 0) out.statuses.push(DONE_STATUS);
  return out;
}

function writeLists_(sh, lists) {
  const cols = LIST_DEFS.map(d => [d.header].concat(lists[d.key] || []));
  const height = Math.max.apply(null, cols.map(c => c.length));
  const grid = [];
  for (let r = 0; r < height; r++) grid.push(cols.map(c => (r < c.length ? c[r] : '')));
  sh.clearContents();
  if (height > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), height - sh.getMaxRows());
  sh.getRange(1, 1, height, cols.length).setNumberFormat('@').setValues(grid);
  sh.getRange(1, 1, 1, cols.length).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function readPatients_(ss) {
  const values = ss.getSheetByName(SHEET_PATIENTS).getDataRange().getValues();
  const headers = (values.shift() || []).map(String);
  const idCol = headers.indexOf('id');
  return values
    .filter(r => idCol >= 0 && String(r[idCol]).trim())
    .map(r => rowToPatient_(headers, r));
}

function getPatientById_(store, id) {
  const sh = store.ss.getSheetByName(SHEET_PATIENTS);
  const headers = headers_(sh);
  const row = findRow_(sh, headers, id);
  if (!row) throw new Error('Patient not found — it may have been deleted on another device.');
  return rowToPatient_(headers, sh.getRange(row, 1, 1, headers.length).getValues()[0]);
}

/** Read-modify-write of one patient row under a lock, so edits from several devices merge safely. */
function mutatePatient_(store, id, fn) {
  return withLock_(() => {
    const sh = store.ss.getSheetByName(SHEET_PATIENTS);
    const headers = headers_(sh);
    const row = findRow_(sh, headers, id);
    if (!row) throw new Error('Patient not found — it may have been deleted on another device.');
    const range = sh.getRange(row, 1, 1, headers.length);
    const existing = range.getValues()[0];
    const p = rowToPatient_(headers, existing);
    const ctx = { now: nowIso_(), user: currentUser_() };
    fn(p, ctx);
    p.updatedAt = ctx.now;
    p.updatedBy = ctx.user;
    range.setValues([patientToRow_(headers, p, existing)]);
    return p;
  });
}

function headers_(sh) {
  const lastCol = sh.getLastColumn();
  return lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v).trim()) : [];
}

function findRow_(sh, headers, id) {
  const col = headers.indexOf('id') + 1;
  const last = sh.getLastRow();
  if (!col || last < 2 || !id) return 0;
  const hit = sh.getRange(2, col, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function blankPatient_() {
  const p = {};
  PATIENT_COLUMNS.forEach(c => { p[c] = ''; });
  p.anesthesia = normalizeAnesthesia_(null);
  p.photos = normalizePhotos_(null);
  p.notes = [];
  p.history = [];
  p.archived = false;
  return p;
}

function rowToPatient_(headers, row) {
  const p = blankPatient_();
  headers.forEach((h, i) => {
    if (!Object.prototype.hasOwnProperty.call(p, h)) return;
    let v = row[i];
    if (v instanceof Date) {
      v = h === 'surgeryDate'
        ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : v.toISOString();
    }
    if (JSON_COLUMNS.indexOf(h) >= 0) p[h] = parseJson_(v, p[h]);
    else if (h === 'archived') p[h] = v === true || /^(true|yes|1)$/i.test(String(v).trim());
    else p[h] = v === null || v === undefined ? '' : String(v);
  });
  p.anesthesia = normalizeAnesthesia_(p.anesthesia);
  p.photos = normalizePhotos_(p.photos);
  if (!Array.isArray(p.notes)) p.notes = [];
  if (!Array.isArray(p.history)) p.history = [];
  return p;
}

function patientToRow_(headers, p, existing) {
  return headers.map((h, i) => {
    if (!Object.prototype.hasOwnProperty.call(p, h)) return existing ? existing[i] : '';
    if (JSON_COLUMNS.indexOf(h) >= 0) return JSON.stringify(p[h]);
    if (h === 'archived') return p.archived ? 'yes' : '';
    return p[h];
  });
}

function applyEdits_(p, fields) {
  fields = fields || {};
  EDITABLE_FIELDS.forEach(k => {
    if (!Object.prototype.hasOwnProperty.call(fields, k)) return;
    const v = fields[k];
    if (k === 'anesthesia') p.anesthesia = normalizeAnesthesia_(v);
    else if (k === 'archived') p.archived = !!v;
    else p[k] = String(v === null || v === undefined ? '' : v).trim().slice(0, k === 'hint' ? 2000 : 200);
  });
}

function normalizeAnesthesia_(a) {
  a = a || {};
  const items = {};
  Object.keys(a.items || {}).forEach(k => { if (a.items[k]) items[String(k)] = true; });
  return {
    items: items,
    asa: String(a.asa || ''),
    fitness: String(a.fitness || 'Pending'),
    notes: String(a.notes || '').slice(0, 2000),
  };
}

function normalizePhotos_(ph) {
  const out = {};
  PHOTO_KINDS.forEach(k => { out[k] = ph && Array.isArray(ph[k]) ? ph[k] : []; });
  return out;
}

function patientFolder_(store, p) {
  if (p.folderId) {
    try { return DriveApp.getFolderById(p.folderId); } catch (e) { /* recreate below */ }
  }
  return DriveApp.getFolderById(store.ids.PHOTOS_FOLDER_ID).createFolder(folderName_(p));
}

function folderName_(p) {
  return (p.name || 'Patient') + ' (' + p.id + ')';
}

function dataUrlToBlob_(dataUrl, name) {
  const m = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Invalid image data.');
  return Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name);
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function trash_(getter) {
  try { getter().setTrashed(true); } catch (e) { /* already gone */ }
}

function currentUser_() {
  return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '';
}

function nowIso_() {
  return new Date().toISOString();
}

function newId_() {
  const date = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd');
  const rand = Utilities.getUuid().replace(/-/g, '').slice(0, 5).toUpperCase();
  return 'P' + date + '-' + rand;
}

function parseJson_(v, fallback) {
  if (v === '' || v === null || v === undefined) return fallback;
  try { return JSON.parse(String(v)); } catch (e) { return fallback; }
}

function uniq_(values) {
  const seen = {};
  const out = [];
  values.forEach(v => {
    const s = String(v === null || v === undefined ? '' : v).trim();
    if (s && !seen[s.toLowerCase()]) {
      seen[s.toLowerCase()] = true;
      out.push(s);
    }
  });
  return out;
}
