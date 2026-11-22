/**
 * Department Waiting List — data server (Google Apps Script).
 *
 * The app (docs/waitlist/, hosted on GitHub Pages) keeps a copy of the list on each phone and
 * syncs with this script. Everyone in the department shares one team key, which is inside the
 * invite link. Everything is stored in the Drive of the account that deploys this script:
 *
 *   Department Waiting List/
 *     Department Waiting List — Data     <- Google Sheet ("Cases" + "Lists" tabs)
 *     Photos/
 *       <Patient name> (<id>)/           <- each case's photos
 *       _thumbnails/                     <- small previews used by the app
 */

const APP_TITLE = 'Department Waiting List';
const APP_URL = 'https://rekovick.github.io/Patient-follow-ups/waitlist/';
const SHEET_CASES = 'Cases';
const SHEET_LISTS = 'Lists';
const SCHEMA_VERSION = 2;
const PHOTO_KINDS = ['decision', 'preop', 'postop'];

// Columns of the Cases sheet, found by their header, so extra columns of your own are kept.
const COLUMNS = [
  'id', 'name', 'phone', 'diagnosis', 'status', 'urgent', 'note', 'photos', 'folderId',
  'createdBy', 'createdAt', 'updatedBy', 'updatedAt', 'deleted',
];
const FIELDS = ['name', 'phone', 'diagnosis', 'status', 'urgent', 'note'];

const LIST_DEFS = [
  { key: 'statuses', header: 'Statuses', defaults: ['Waiting', 'Paperwork', 'Labs', 'Ready for surgery', 'Scheduled', 'Done'] },
];

/** Name of the person making the current request, as they typed it when joining. */
let USER_ = '';

// ---------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------

const API = {
  sync: sync_,
  save: save_,
  remove: remove_,
  uploadPhoto: uploadPhoto_,
  deletePhoto: deletePhoto_,
  getPhotoData: getPhotoData_,
};

/** The app sends POST requests: {key, user, fn, args}. The reply is JSON: {ok, result} or {ok: false, error}. */
function doPost(e) {
  let reply;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const props = PropertiesService.getScriptProperties().getProperties();
    if (!props.TEAM_KEY || req.key !== props.TEAM_KEY) {
      Utilities.sleep(400); // slows down anyone guessing keys
      throw new Error('ACCESS_DENIED');
    }
    if (!Object.prototype.hasOwnProperty.call(API, req.fn)) throw new Error('Unknown action: ' + req.fn);
    USER_ = String(req.user || '').trim().slice(0, 60) || 'Someone';
    reply = { ok: true, result: API[req.fn].apply(null, Array.isArray(req.args) ? req.args : []) };
  } catch (err) {
    reply = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(reply)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(APP_TITLE + ' server is running. Open the app at ' + APP_URL);
}

/** Run once from the editor: creates the Sheet, the Drive folders and the team key, and prints what the app needs. */
function setup() {
  const store = store_();
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('TEAM_KEY');
  if (!key) {
    key = newKey_();
    props.setProperty('TEAM_KEY', key);
  }
  Logger.log('Data sheet: ' + store.ss.getUrl());
  Logger.log('Drive folder: ' + DriveApp.getFolderById(store.ids.ROOT_FOLDER_ID).getUrl());
  Logger.log('Open the app: ' + APP_URL);
  Logger.log('TEAM KEY (paste it into the app once, keep it private): ' + key);
}

/** Run from the editor if the invite link reached the wrong people: everyone must join again with a new link. */
function resetTeamKey() {
  const key = newKey_();
  PropertiesService.getScriptProperties().setProperty('TEAM_KEY', key);
  Logger.log('Old invite links no longer work. NEW TEAM KEY: ' + key);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Returns the cases changed since `since` (an ISO time from a previous reply), or the whole list
 * when `since` is empty. Answers straight away, without opening the Sheet, when nothing changed.
 */
function sync_(since) {
  const now = new Date().toISOString();
  const last = PropertiesService.getScriptProperties().getProperty('LAST_CHANGE') || '';
  if (since && last && last < since) return { now: now, full: false, cases: [] };
  const store = store_();
  const all = readCases_(store.ss);
  return {
    now: now,
    full: !since,
    cases: since ? all.filter(c => c.updatedAt >= since) : all.filter(c => !c.deleted),
    lists: readLists_(store.ss),
  };
}

/** Creates the case (the app picks the id, so it can add cases offline) or updates only the given fields. */
function save_(id, fields) {
  id = String(id || '');
  if (!/^[\w-]{4,40}$/.test(id)) throw new Error('Invalid case id.');
  const clean = {};
  FIELDS.forEach(f => {
    if (!fields || !Object.prototype.hasOwnProperty.call(fields, f)) return;
    const v = fields[f];
    clean[f] = f === 'urgent' ? !!v : String(v === null || v === undefined ? '' : v).trim().slice(0, f === 'note' ? 1000 : 200);
  });
  const store = store_();
  return mutateCase_(store, id, true, c => {
    const oldName = c.name;
    Object.assign(c, clean);
    if (!c.name) throw new Error('Patient name is required.');
    if (oldName && c.name !== oldName && c.folderId) {
      try { DriveApp.getFolderById(c.folderId).setName(folderName_(c)); } catch (e) { /* folder gone */ }
    }
  });
}

/** Removes a case. It stays in the Sheet marked deleted, so other phones learn to remove it too. */
function remove_(id) {
  const store = store_();
  const c = mutateCase_(store, String(id || ''), false, cs => { cs.deleted = true; });
  if (c) {
    // Photos go to the Drive trash, so they can still be recovered for 30 days.
    if (c.folderId) trash_(() => DriveApp.getFolderById(c.folderId));
    PHOTO_KINDS.forEach(k => c.photos[k].forEach(ph => { if (ph.thumbId) trash_(() => DriveApp.getFileById(ph.thumbId)); }));
  }
  return c;
}

function uploadPhoto_(id, kind, photo) {
  if (PHOTO_KINDS.indexOf(kind) < 0) throw new Error('Unknown photo type: ' + kind);
  const store = store_();
  const current = readCase_(store, id);
  if (!current || current.deleted) throw new Error('This case was deleted.');
  const folder = caseFolder_(store, current);
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmmss');
  const base = kind + ' ' + stamp + ' ' + Utilities.getUuid().slice(0, 4);
  const file = folder.createFile(dataUrlToBlob_(photo.dataUrl, base + '.jpg'));
  const thumb = photo.thumbDataUrl
    ? DriveApp.getFolderById(store.ids.THUMBS_FOLDER_ID).createFile(dataUrlToBlob_(photo.thumbDataUrl, id + ' ' + base + '.jpg'))
    : null;
  return mutateCase_(store, id, false, c => {
    c.folderId = c.folderId || folder.getId();
    c.photos[kind].push({ id: file.getId(), thumbId: thumb ? thumb.getId() : '', at: new Date().toISOString(), by: USER_ });
  });
}

function deletePhoto_(id, kind, fileId) {
  const store = store_();
  let removed = null;
  const c = mutateCase_(store, id, false, cs => {
    const list = cs.photos[kind] || [];
    const i = list.findIndex(ph => ph.id === fileId);
    if (i >= 0) removed = list.splice(i, 1)[0];
  });
  if (removed) {
    trash_(() => DriveApp.getFileById(removed.id));
    if (removed.thumbId) trash_(() => DriveApp.getFileById(removed.thumbId));
  }
  return c;
}

/** Returns {fileId: dataUrl} for the requested photos (thumbnails or full size). */
function getPhotoData_(fileIds) {
  store_();
  const out = {};
  (fileIds || []).slice(0, 30).forEach(fid => {
    try {
      const blob = DriveApp.getFileById(fid).getBlob();
      out[fid] = 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
    } catch (e) {
      out[fid] = null;
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function store_() {
  const props = PropertiesService.getScriptProperties();
  let ids = props.getProperties();
  let fresh = false;
  if (!ids.SPREADSHEET_ID || !ids.THUMBS_FOLDER_ID) {
    withLock_(() => {
      ids = props.getProperties();
      if (ids.SPREADSHEET_ID && ids.THUMBS_FOLDER_ID) return;
      const root = DriveApp.createFolder(APP_TITLE);
      let ssId = ids.SPREADSHEET_ID;
      if (!ssId) {
        ssId = SpreadsheetApp.create(APP_TITLE + ' — Data').getId();
        fresh = true;
      }
      DriveApp.getFileById(ssId).moveTo(root);
      const photos = root.createFolder('Photos');
      const thumbs = photos.createFolder('_thumbnails');
      props.setProperties({
        SPREADSHEET_ID: ssId,
        ROOT_FOLDER_ID: root.getId(),
        PHOTOS_FOLDER_ID: photos.getId(),
        THUMBS_FOLDER_ID: thumbs.getId(),
      });
    });
    ids = props.getProperties();
  }
  const ss = SpreadsheetApp.openById(ids.SPREADSHEET_ID);
  ensureSheets_(ss, fresh);
  return { ss: ss, ids: ids };
}

function ensureSheets_(ss, fresh) {
  const cache = CacheService.getScriptCache();
  const key = 'schema:' + SCHEMA_VERSION + ':' + ss.getId();
  if (!fresh && cache.get(key)) return;
  withLock_(() => {
    let sh = ss.getSheetByName(SHEET_CASES);
    if (!sh) sh = ss.insertSheet(SHEET_CASES, 0);
    const headers = headers_(sh);
    const missing = COLUMNS.filter(c => headers.indexOf(c) < 0);
    if (missing.length) {
      sh.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
      sh.getRange(1, 1, 1, headers.length + missing.length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    // Plain text keeps the leading zero of phone numbers and stops dates being converted.
    sh.getRange(1, 1, sh.getMaxRows(), sh.getLastColumn()).setNumberFormat('@');
    if (!ss.getSheetByName(SHEET_LISTS)) {
      const lists = ss.insertSheet(SHEET_LISTS);
      const height = Math.max.apply(null, LIST_DEFS.map(d => d.defaults.length)) + 1;
      const grid = [];
      for (let r = 0; r < height; r++) {
        grid.push(LIST_DEFS.map(d => (r === 0 ? d.header : d.defaults[r - 1] || '')));
      }
      lists.getRange(1, 1, height, LIST_DEFS.length).setNumberFormat('@').setValues(grid);
      lists.getRange(1, 1, 1, LIST_DEFS.length).setFontWeight('bold');
      lists.setFrozenRows(1);
    }
    if (fresh) {
      ss.getSheets().forEach(s => {
        if (s.getName() !== SHEET_CASES && s.getName() !== SHEET_LISTS && s.getLastRow() === 0) ss.deleteSheet(s);
      });
    }
  });
  cache.put(key, '1', 21600);
}

function headers_(sh) {
  const lastCol = sh.getLastColumn();
  return lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v).trim()) : [];
}

function readCases_(ss) {
  const sh = ss.getSheetByName(SHEET_CASES);
  const headers = headers_(sh);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const idCol = headers.indexOf('id');
  return sh.getRange(2, 1, last - 1, headers.length).getValues()
    .filter(r => String(r[idCol]).trim())
    .map(r => rowToCase_(headers, r));
}

function readCase_(store, id) {
  const sh = store.ss.getSheetByName(SHEET_CASES);
  const headers = headers_(sh);
  const row = findRow_(sh, headers, id);
  return row ? rowToCase_(headers, sh.getRange(row, 1, 1, headers.length).getValues()[0]) : null;
}

/**
 * Read-modify-write of one case under a lock. `create` makes the case when it doesn't exist yet;
 * otherwise a missing case returns null.
 */
function mutateCase_(store, id, create, fn) {
  return withLock_(() => {
    const sh = store.ss.getSheetByName(SHEET_CASES);
    const headers = headers_(sh);
    let row = findRow_(sh, headers, id);
    const now = new Date().toISOString();
    let existing = null;
    let c;
    if (row) {
      existing = sh.getRange(row, 1, 1, headers.length).getValues()[0];
      c = rowToCase_(headers, existing);
    } else if (create) {
      c = blankCase_(id, now);
      row = sh.getLastRow() + 1;
      if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
    } else {
      return null;
    }
    fn(c);
    c.updatedAt = now;
    c.updatedBy = USER_;
    sh.getRange(row, 1, 1, headers.length).setNumberFormat('@').setValues([caseToRow_(headers, c, existing)]);
    touch_(now);
    return c;
  });
}

function readLists_(ss) {
  const values = ss.getSheetByName(SHEET_LISTS).getDataRange().getValues();
  const headers = (values[0] || []).map(v => String(v).trim());
  const out = {};
  LIST_DEFS.forEach(d => {
    const c = headers.indexOf(d.header);
    const seen = {};
    out[d.key] = c < 0 ? d.defaults.slice() : values.slice(1).map(r => String(r[c]).trim())
      .filter(v => v && !seen[v.toLowerCase()] && (seen[v.toLowerCase()] = true));
  });
  return out;
}

function blankCase_(id, now) {
  const c = {};
  COLUMNS.forEach(k => { c[k] = ''; });
  c.id = id;
  c.urgent = false;
  c.deleted = false;
  c.photos = emptyPhotos_();
  c.createdAt = now;
  c.createdBy = USER_;
  return c;
}

function rowToCase_(headers, row) {
  const c = {};
  COLUMNS.forEach(k => {
    const i = headers.indexOf(k);
    let v = i < 0 ? '' : row[i];
    if (v instanceof Date) v = v.toISOString();
    c[k] = v === null || v === undefined ? '' : String(v);
  });
  c.urgent = /^(true|yes|1)$/i.test(c.urgent);
  c.deleted = /^(true|yes|1)$/i.test(c.deleted);
  let photos = null;
  try { photos = c.photos ? JSON.parse(c.photos) : null; } catch (e) { photos = null; }
  c.photos = emptyPhotos_();
  PHOTO_KINDS.forEach(k => { if (photos && Array.isArray(photos[k])) c.photos[k] = photos[k]; });
  return c;
}

function caseToRow_(headers, c, existing) {
  return headers.map((h, i) => {
    if (COLUMNS.indexOf(h) < 0) return existing ? existing[i] : '';
    if (h === 'urgent' || h === 'deleted') return c[h] ? 'yes' : '';
    if (h === 'photos') return JSON.stringify(c.photos);
    return c[h];
  });
}

function emptyPhotos_() {
  const p = {};
  PHOTO_KINDS.forEach(k => { p[k] = []; });
  return p;
}

function findRow_(sh, headers, id) {
  const col = headers.indexOf('id') + 1;
  const last = sh.getLastRow();
  if (!col || last < 2 || !id) return 0;
  const hit = sh.getRange(2, col, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function caseFolder_(store, c) {
  if (c.folderId) {
    try { return DriveApp.getFolderById(c.folderId); } catch (e) { /* recreate below */ }
  }
  return DriveApp.getFolderById(store.ids.PHOTOS_FOLDER_ID).createFolder(folderName_(c));
}

function folderName_(c) {
  return (c.name || 'Patient') + ' (' + c.id + ')';
}

function dataUrlToBlob_(dataUrl, name) {
  const m = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Invalid image data.');
  return Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], name);
}

/** Remembers when the list last changed, so a sync with nothing new is answered without opening the Sheet. */
function touch_(now) {
  PropertiesService.getScriptProperties().setProperty('LAST_CHANGE', now);
}

function trash_(getter) {
  try { getter().setTrashed(true); } catch (e) { /* already gone */ }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    // Sheets holds writes back until the script ends: save them before the next request reads the row.
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}

function newKey_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}
