/**
 * Department Waiting List — data server (Google Apps Script).
 *
 * The app (docs/waitlist/, hosted on GitHub Pages) keeps a copy of the list on each phone and
 * syncs with this script. Everyone in the department shares one team key, which is inside the
 * invite link. The list is stored in a Google Sheet in the Drive of the account that deploys this.
 */

const APP_URL = 'https://rekovick.github.io/Patient-follow-ups/waitlist/';
const SHEET_CASES = 'Cases';
const SHEET_LISTS = 'Lists';
const SCHEMA_VERSION = 1;

// Column order in the Cases sheet. Add your own columns after these, never between them.
const COLUMNS = [
  'id', 'name', 'phone', 'diagnosis', 'hospital', 'consultant', 'status', 'urgent', 'note',
  'createdBy', 'createdAt', 'updatedBy', 'updatedAt', 'deleted',
];
const FIELDS = ['name', 'phone', 'diagnosis', 'hospital', 'consultant', 'status', 'urgent', 'note'];

const LIST_DEFS = [
  { key: 'statuses', header: 'Statuses', defaults: ['Waiting', 'Paperwork', 'Labs', 'Ready for surgery', 'Scheduled', 'Done'] },
  { key: 'hospitals', header: 'Hospitals', defaults: ['El Sahel', 'El Mabara', '15th of May'] },
  { key: 'consultants', header: 'Consultants', defaults: ['Dr Ahmed Elghity', 'Dr Alaa Ahmed', 'General'] },
];

/** Name of the person making the current request, as they typed it when joining. */
let USER_ = '';

// ---------------------------------------------------------------------------
// Web app entry points
// ---------------------------------------------------------------------------

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
    const fn = { sync: sync_, save: save_, remove: remove_ }[req.fn];
    if (!fn) throw new Error('Unknown action: ' + req.fn);
    USER_ = String(req.user || '').trim().slice(0, 60) || 'Someone';
    reply = { ok: true, result: fn.apply(null, Array.isArray(req.args) ? req.args : []) };
  } catch (err) {
    reply = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(reply)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('Department Waiting List server is running. Open the app at ' + APP_URL);
}

/** Run once from the editor: creates the Sheet and the team key, and prints what the app needs. */
function setup() {
  const ss = store_();
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('TEAM_KEY');
  if (!key) {
    key = newKey_();
    props.setProperty('TEAM_KEY', key);
  }
  Logger.log('Data sheet: ' + ss.getUrl());
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
  const ss = store_();
  const all = readCases_(ss);
  return {
    now: now,
    full: !since,
    cases: since ? all.filter(c => c.updatedAt >= since) : all.filter(c => !c.deleted),
    lists: readLists_(ss),
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
  const ss = store_();
  return withLock_(() => {
    const sh = ss.getSheetByName(SHEET_CASES);
    const now = new Date().toISOString();
    const row = findRow_(sh, id);
    const c = row ? rowToCase_(sh.getRange(row, 1, 1, COLUMNS.length).getValues()[0]) : blankCase_(id, now);
    Object.assign(c, clean);
    if (!c.name) throw new Error('Patient name is required.');
    c.updatedAt = now;
    c.updatedBy = USER_;
    writeCase_(sh, row, c);
    touch_(now);
    return c;
  });
}

/** Removes a case. It stays in the Sheet marked deleted, so other phones learn to remove it too. */
function remove_(id) {
  const ss = store_();
  return withLock_(() => {
    const sh = ss.getSheetByName(SHEET_CASES);
    const row = findRow_(sh, String(id || ''));
    if (!row) return null;
    const now = new Date().toISOString();
    const c = rowToCase_(sh.getRange(row, 1, 1, COLUMNS.length).getValues()[0]);
    c.deleted = true;
    c.updatedAt = now;
    c.updatedBy = USER_;
    writeCase_(sh, row, c);
    touch_(now);
    return c;
  });
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function store_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SPREADSHEET_ID');
  let fresh = false;
  if (!id) {
    withLock_(() => {
      id = props.getProperty('SPREADSHEET_ID');
      if (id) return;
      id = SpreadsheetApp.create('Department Waiting List — Data').getId();
      props.setProperty('SPREADSHEET_ID', id);
      fresh = true;
    });
  }
  const ss = SpreadsheetApp.openById(id);
  ensureSheets_(ss, fresh);
  return ss;
}

function ensureSheets_(ss, fresh) {
  const cache = CacheService.getScriptCache();
  const key = 'schema:' + SCHEMA_VERSION + ':' + ss.getId();
  if (!fresh && cache.get(key)) return;
  withLock_(() => {
    let sh = ss.getSheetByName(SHEET_CASES);
    if (!sh) sh = ss.insertSheet(SHEET_CASES, 0);
    if (!sh.getLastRow()) {
      sh.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    // Plain text keeps the leading zero of phone numbers and stops dates being converted.
    sh.getRange(1, 1, sh.getMaxRows(), COLUMNS.length).setNumberFormat('@');
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

function readCases_(ss) {
  const sh = ss.getSheetByName(SHEET_CASES);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, COLUMNS.length).getValues()
    .filter(r => String(r[0]).trim())
    .map(rowToCase_);
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
  c.createdAt = now;
  c.createdBy = USER_;
  return c;
}

function rowToCase_(row) {
  const c = {};
  COLUMNS.forEach((k, i) => {
    let v = row[i];
    if (v instanceof Date) v = v.toISOString();
    c[k] = v === null || v === undefined ? '' : String(v);
  });
  c.urgent = /^(true|yes|1)$/i.test(c.urgent);
  c.deleted = /^(true|yes|1)$/i.test(c.deleted);
  return c;
}

function writeCase_(sh, row, c) {
  const values = COLUMNS.map(k => (k === 'urgent' || k === 'deleted') ? (c[k] ? 'yes' : '') : c[k]);
  if (!row) {
    row = sh.getLastRow() + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
  }
  sh.getRange(row, 1, 1, COLUMNS.length).setNumberFormat('@').setValues([values]);
}

function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last < 2 || !id) return 0;
  const hit = sh.getRange(2, 1, last - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

/** Remembers when the list last changed, so a sync with nothing new is answered without opening the Sheet. */
function touch_(now) {
  PropertiesService.getScriptProperties().setProperty('LAST_CHANGE', now);
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
