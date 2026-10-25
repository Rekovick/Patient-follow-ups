/*
 * In-browser fake of the Google Apps Script services used by Code.gs.
 * Lets the real backend + frontend run together locally (dev/build-preview.js)
 * without a Google account. Data is kept in localStorage.
 */
(function (global) {
  'use strict';

  const STORE_KEY = 'fake-gas-store.v1';
  let db = { props: {}, sheets: {}, files: {}, seq: 1 };
  try {
    const saved = global.localStorage && localStorage.getItem(STORE_KEY);
    if (saved) db = JSON.parse(saved);
  } catch (e) { /* fresh store */ }

  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { /* quota: keep in memory */ }
  }

  function newId(prefix) {
    db.seq += 1;
    return prefix + db.seq.toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------------------------------------------------------------- Sheets

  function Range(sheet, row, col, nr, nc) {
    this.sheet = sheet; this.row = row; this.col = col; this.nr = nr; this.nc = nc;
  }
  Range.prototype.getValues = function () {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) {
        const rowArr = this.sheet.data.rows[this.row - 1 + r] || [];
        const v = rowArr[this.col - 1 + c];
        line.push(v === undefined || v === null ? '' : v);
      }
      out.push(line);
    }
    return out;
  };
  Range.prototype.setValues = function (values) {
    if (values.length !== this.nr || values[0].length !== this.nc) throw new Error('setValues: dimensions mismatch');
    if (this.row - 1 + this.nr > this.sheet.data.maxRows) throw new Error('Range out of bounds');
    for (let r = 0; r < this.nr; r++) {
      const idx = this.row - 1 + r;
      const rowArr = this.sheet.data.rows[idx] || (this.sheet.data.rows[idx] = []);
      for (let c = 0; c < this.nc; c++) {
        let v = values[r][c];
        if (typeof v === 'boolean' || typeof v === 'number') v = String(v);
        rowArr[this.col - 1 + c] = v;
      }
    }
    persist();
    return this;
  };
  Range.prototype.setNumberFormat = function () { return this; };
  Range.prototype.setFontWeight = function () { return this; };
  Range.prototype.getRow = function () { return this.row; };
  Range.prototype.createTextFinder = function (text) {
    const range = this;
    let entire = false;
    return {
      matchEntireCell: function (b) { entire = b; return this; },
      findNext: function () {
        const vals = range.getValues();
        for (let r = 0; r < vals.length; r++) {
          for (let c = 0; c < vals[r].length; c++) {
            const v = String(vals[r][c]);
            if (entire ? v === text : v.indexOf(text) >= 0) return new Range(range.sheet, range.row + r, range.col + c, 1, 1);
          }
        }
        return null;
      },
    };
  };

  function Sheet(ss, data) { this.ss = ss; this.data = data; }
  Sheet.prototype.getName = function () { return this.data.name; };
  Sheet.prototype.getLastRow = function () {
    for (let i = this.data.rows.length - 1; i >= 0; i--) {
      if ((this.data.rows[i] || []).some(v => v !== '' && v !== undefined && v !== null)) return i + 1;
    }
    return 0;
  };
  Sheet.prototype.getLastColumn = function () {
    let max = 0;
    this.data.rows.forEach(r => (r || []).forEach((v, i) => { if (v !== '' && v !== undefined && v !== null) max = Math.max(max, i + 1); }));
    return max;
  };
  Sheet.prototype.getMaxRows = function () { return this.data.maxRows; };
  Sheet.prototype.getRange = function (row, col, nr, nc) {
    if (row < 1 || col < 1 || (nr || 1) < 1 || (nc || 1) < 1) throw new Error('Invalid range');
    return new Range(this, row, col, nr || 1, nc || 1);
  };
  Sheet.prototype.getDataRange = function () {
    return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  };
  Sheet.prototype.setFrozenRows = function () { return this; };
  Sheet.prototype.insertRowsAfter = function (after, n) { this.data.maxRows += n; persist(); return this; };
  Sheet.prototype.deleteRow = function (row) { this.data.rows.splice(row - 1, 1); this.data.maxRows -= 1; persist(); return this; };
  Sheet.prototype.clearContents = function () { this.data.rows = []; persist(); return this; };

  function Spreadsheet(id) { this.id = id; this.data = db.sheets[id]; }
  Spreadsheet.prototype.getId = function () { return this.id; };
  Spreadsheet.prototype.getUrl = function () { return 'https://docs.google.com/spreadsheets/d/' + this.id; };
  Spreadsheet.prototype.getSheets = function () { return this.data.tabs.map(t => new Sheet(this, t)); };
  Spreadsheet.prototype.getSheetByName = function (name) {
    const t = this.data.tabs.find(x => x.name === name);
    return t ? new Sheet(this, t) : null;
  };
  Spreadsheet.prototype.insertSheet = function (name, index) {
    const t = { name: name, rows: [], maxRows: 1000 };
    if (index === undefined) this.data.tabs.push(t); else this.data.tabs.splice(index, 0, t);
    persist();
    return new Sheet(this, t);
  };
  Spreadsheet.prototype.deleteSheet = function (sheet) {
    this.data.tabs = this.data.tabs.filter(t => t.name !== sheet.getName());
    persist();
  };

  global.SpreadsheetApp = {
    create: function (name) {
      const id = newId('ss');
      db.sheets[id] = { name: name, tabs: [{ name: 'Sheet1', rows: [], maxRows: 1000 }] };
      db.files[id] = { id: id, name: name, folder: false, parent: null, kind: 'sheet' };
      persist();
      return new Spreadsheet(id);
    },
    openById: function (id) {
      if (!db.sheets[id]) throw new Error('Spreadsheet not found: ' + id);
      return new Spreadsheet(id);
    },
  };

  // ---------------------------------------------------------------- Drive

  function Blob(b64, type, name) { this.b64 = b64; this.type = type; this.name = name; }
  Blob.prototype.getBytes = function () { return { __b64: this.b64 }; };
  Blob.prototype.getContentType = function () { return this.type; };
  Blob.prototype.getName = function () { return this.name; };

  function File(id) { this.id = id; }
  File.prototype.getId = function () { return this.id; };
  File.prototype.getUrl = function () { return 'https://drive.google.com/file/d/' + this.id + '/view'; };
  File.prototype.getName = function () { return db.files[this.id].name; };
  File.prototype.getBlob = function () {
    const f = db.files[this.id];
    return new Blob(f.b64, f.type, f.name);
  };
  File.prototype.moveTo = function (folder) { db.files[this.id].parent = folder.getId(); persist(); return this; };
  File.prototype.setTrashed = function (b) { db.files[this.id].trashed = b; persist(); return this; };

  function Folder(id) { this.id = id; }
  Folder.prototype.getId = function () { return this.id; };
  Folder.prototype.getUrl = function () { return 'https://drive.google.com/drive/folders/' + this.id; };
  Folder.prototype.getName = function () { return db.files[this.id].name; };
  Folder.prototype.setName = function (n) { db.files[this.id].name = n; persist(); return this; };
  Folder.prototype.setTrashed = function (b) { db.files[this.id].trashed = b; persist(); return this; };
  Folder.prototype.createFolder = function (name) {
    const id = newId('fo');
    db.files[id] = { id: id, name: name, folder: true, parent: this.id };
    persist();
    return new Folder(id);
  };
  Folder.prototype.createFile = function (blob) {
    const id = newId('fi');
    db.files[id] = { id: id, name: blob.name, type: blob.type, b64: blob.b64, parent: this.id };
    persist();
    return new File(id);
  };

  function lookup(id, wantFolder) {
    const f = db.files[id];
    if (!f || f.trashed || !!f.folder !== wantFolder) throw new Error('No item with the given ID could be found: ' + id);
    return wantFolder ? new Folder(id) : new File(id);
  }

  global.DriveApp = {
    createFolder: function (name) {
      const id = newId('fo');
      db.files[id] = { id: id, name: name, folder: true, parent: null };
      persist();
      return new Folder(id);
    },
    getFolderById: function (id) { return lookup(id, true); },
    getFileById: function (id) { return lookup(id, false); },
  };

  // ---------------------------------------------------------------- Misc services

  function formatDate(d, tz, fmt) {
    const p = n => (n < 10 ? '0' : '') + n;
    return fmt
      .replace('yyyy', d.getFullYear()).replace('yy', String(d.getFullYear()).slice(2))
      .replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate()))
      .replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes())).replace('ss', p(d.getSeconds()));
  }

  global.Utilities = {
    formatDate: formatDate,
    getUuid: function () {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
    },
    base64Decode: function (s) { return { __b64: s }; },
    base64Encode: function (bytes) { return bytes.__b64; },
    newBlob: function (bytes, type, name) { return new Blob(bytes.__b64, type, name); },
  };

  global.Session = {
    getActiveUser: function () { return { getEmail: function () { return global.FAKE_USER || 'doctor@example.com'; } }; },
    getEffectiveUser: function () { return { getEmail: function () { return 'doctor@example.com'; } }; },
    getScriptTimeZone: function () { return 'Africa/Cairo'; },
  };

  global.LockService = {
    getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; },
  };

  global.PropertiesService = {
    getScriptProperties: function () {
      return {
        getProperties: function () { return Object.assign({}, db.props); },
        getProperty: function (k) { return db.props[k] || null; },
        setProperty: function (k, v) { db.props[k] = String(v); persist(); return this; },
        setProperties: function (o) { Object.keys(o).forEach(k => { db.props[k] = String(o[k]); }); persist(); return this; },
      };
    },
  };

  const cache = {};
  global.CacheService = {
    getScriptCache: function () {
      return { get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; } };
    },
  };

  global.Logger = { log: function () { console.log.apply(console, arguments); } };

  // ---------------------------------------------------------------- google.script.*

  const LATENCY = global.FAKE_LATENCY === undefined ? 250 : global.FAKE_LATENCY;

  function makeRunner(success, failure) {
    return new Proxy({}, {
      get: function (_, name) {
        if (name === 'withSuccessHandler') return fn => makeRunner(fn, failure);
        if (name === 'withFailureHandler') return fn => makeRunner(success, fn);
        return function () {
          const args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)));
          setTimeout(() => {
            try {
              const fn = global[name];
              if (typeof fn !== 'function' || /_$/.test(name)) throw new Error('Script function not found: ' + name);
              const res = fn.apply(null, args);
              if (success) success(res === undefined ? null : JSON.parse(JSON.stringify(res)));
            } catch (e) {
              console.error(e);
              if (failure) failure(e);
            }
          }, LATENCY);
        };
      },
    });
  }

  let changeHandler = null;
  global.addEventListener('popstate', e => { if (changeHandler) changeHandler({ state: e.state }); });

  global.google = {
    script: {
      get run() { return makeRunner(null, null); },
      history: {
        push: function (state) { history.pushState(state, ''); },
        replace: function (state) { history.replaceState(state, ''); },
        setChangeHandler: function (fn) { changeHandler = fn; },
      },
    },
  };

  global.fakeGas = {
    reset: function () { db = { props: {}, sheets: {}, files: {}, seq: 1 }; persist(); },
    db: function () { return db; },
  };
})(window);
