'use strict';
/**
 * Persistent app state (settings, per-account data, migration).
 * @module shared/store
 */
// Doimiy ma'lumotlar — account bo'yicha ajratilgan (Chrome profil uslubi)
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const GLOBAL_SETTINGS = {
  theme: 'system', language: 'uz', startup: 'restore',
  bookmarksBar: false, tile: true, tileBorder: true, suggest: true, httpsUpgrade: true, shields: true,
};

const ACCOUNT_DEFAULTS = () => ({
  history: [], bookmarks: [], shortcuts: [],
  zoom: {}, permissions: {}, lastSession: null,
  homepage: '', engine: 'google', shieldsOff: [],
});

const DEFAULTS = {
  settings: { ...GLOBAL_SETTINGS },
  // eski global maydonlar migratsiya uchun (load dan keyin tozalanadi)
  bookmarks: [], history: [], shortcuts: [], zoom: {}, permissions: {}, lastSession: null,
  totalBlocked: 0, win: { width: 1240, height: 800 },
  accounts: [{ id: 'default', name: 'Asosiy', color: '#9fd8ff', ...ACCOUNT_DEFAULTS() }],
  lastAccountId: 'default',
};

let data = null;
let timer = null;
const file = () => path.join(app.getPath('userData'), 'mrbrowser-data.json');

function shapeAccount(a) {
  if (!a || typeof a !== 'object') a = { id: 'default', name: 'Asosiy', color: '#9fd8ff' };
  const d = ACCOUNT_DEFAULTS();
  if (!Array.isArray(a.history)) a.history = d.history;
  if (!Array.isArray(a.bookmarks)) a.bookmarks = d.bookmarks;
  if (!Array.isArray(a.shortcuts)) a.shortcuts = d.shortcuts;
  if (!a.zoom || typeof a.zoom !== 'object') a.zoom = {};
  if (!a.permissions || typeof a.permissions !== 'object') a.permissions = {};
  if (!('lastSession' in a)) a.lastSession = null;
  if (typeof a.homepage !== 'string') a.homepage = '';
  if (typeof a.engine !== 'string') a.engine = 'google';
  if (!Array.isArray(a.shieldsOff)) a.shieldsOff = [];
  if (!a.color) a.color = '#9fd8ff';
  if (!a.name) a.name = 'Asosiy';
  return a;
}

function migrate(data) {
  // Eski global maydonlarni default accountga ko'chirish (bir marta)
  const def = data.accounts.find((x) => x.id === 'default') || data.accounts[0];
  if (!def) return;
  shapeAccount(def);

  const take = (key, empty) => {
    if (data[key] == null) return;
    const hasAcc = key === 'zoom' || key === 'permissions'
      ? Object.keys(def[key] || {}).length > 0
      : Array.isArray(def[key]) ? def[key].length > 0 : !!def[key];
    const hasGlobal = key === 'zoom' || key === 'permissions'
      ? Object.keys(data[key] || {}).length > 0
      : Array.isArray(data[key]) ? data[key].length > 0 : !!data[key];
    if (!hasAcc && hasGlobal) {
      def[key] = data[key];
    }
    // globalni tozalash (qayta migrate bo'lmasin)
    data[key] = empty;
  };

  take('history', []);
  take('bookmarks', []);
  take('shortcuts', []);
  take('zoom', {});
  take('permissions', {});
  take('lastSession', null);

  // homepage / engine / shieldsOff settings dan accountga
  if (data.settings) {
    if (!def.homepage && data.settings.homepage) def.homepage = data.settings.homepage;
    if (data.settings.engine) def.engine = data.settings.engine;
    if (Array.isArray(data.settings.shieldsOff) && data.settings.shieldsOff.length && !def.shieldsOff.length) {
      def.shieldsOff = data.settings.shieldsOff;
    }
    // global settings dan account-only maydonlarni olib tashlash (saqlashda chalkashmasin)
    // lekin o'qishda backward compat uchun settings da qoldirish mumkin — eng() account ishlatadi
  }

  for (const a of data.accounts) shapeAccount(a);
}

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(file(), 'utf8'));
    data = { ...structuredClone(DEFAULTS), ...j };
    data.settings = { ...GLOBAL_SETTINGS, ...(j.settings || {}) };
  } catch { data = structuredClone(DEFAULTS); }

  if (!Array.isArray(data.accounts) || !data.accounts.length) {
    data.accounts = structuredClone(DEFAULTS.accounts);
  }
  if (!data.accounts.some((a) => a.id === 'default')) {
    data.accounts.unshift({ id: 'default', name: 'Asosiy', color: '#9fd8ff', ...ACCOUNT_DEFAULTS() });
  }
  for (const a of data.accounts) shapeAccount(a);
  migrate(data);

  if (!data.lastAccountId || !data.accounts.some((a) => a.id === data.lastAccountId)) {
    data.lastAccountId = 'default';
  }
  return data;
}

const get = () => data || load();

/** Account ma'lumotlar sumkasi (history, bookmarks, ...) */
function acc(id) {
  const d = get();
  let a = d.accounts.find((x) => x.id === (id || d.lastAccountId || 'default'));
  if (!a) a = d.accounts.find((x) => x.id === 'default') || d.accounts[0];
  return shapeAccount(a);
}

function flush() {
  clearTimeout(timer); timer = null;
  if (!data) return;
  try {
    const f = file();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f + '.tmp', JSON.stringify(data));
    fs.renameSync(f + '.tmp', f);
  } catch (e) { console.error('[store]', e.message); }
}
function save() { clearTimeout(timer); timer = setTimeout(flush, 500); }

module.exports = { load, get, save, flush, acc, shapeAccount, ACCOUNT_DEFAULTS, GLOBAL_SETTINGS };
