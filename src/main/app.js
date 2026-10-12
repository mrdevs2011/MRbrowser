'use strict';
/**
 * MR Browser — main process application core.
 * Orchestrates windows, tabs, sessions, IPC, and layout.
 * @module main/app
 */
const { app, BrowserWindow, WebContentsView, ipcMain, Menu, session, shell, protocol, nativeTheme, clipboard, net } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('../shared/store');

const chromeCookies = require('./chromeCookies');
const i18n = require('../shared/i18n');
const shields = require('../shared/shields');
const logger = require('../shared/logger');
const paths = require('./paths');
const VERSION = require(paths.packageJson).version;

protocol.registerSchemesAsPrivileged([{ scheme: 'mrb', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

/* ── Chrome kabi identifikatsiya (Google OAuth / "not secure" uchun) ── */
function chromeMajor() {
  const v = process.versions.chrome || '131.0.0.0';
  return (v.split('.')[0] || '131');
}
function chromeFull() {
  return process.versions.chrome || '131.0.0.0';
}
function buildChromeUA() {
  // Linux Chrome UA — Electron so'zi yo'q. Versiya runtime Chromium bilan bir xil.
  return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + chromeMajor() + '.0.0.0 Safari/537.36';
}
// Chromium GREASE brend ro'yxati (native navigator.userAgentData bilan bir xil). "Google Chrome" brendi YO'Q — Chromium/Brave kabi.
function brandList(full) {
  const seed = Number(chromeMajor());
  const chars = [' ', '(', ':', '-', '.', '/', ')', ';', '=', '?', '_'];
  const vers = ['8', '99', '24'];
  const grease = 'Not' + chars[seed % 11] + 'A' + chars[(seed + 1) % 11] + 'Brand';
  const gv = vers[seed % 3];
  const list = [
    { brand: grease, version: full ? gv + '.0.0.0' : gv },
    { brand: 'Chromium', version: full ? chromeFull() : String(seed) },
  ];
  if (seed % 2 === 1) list.reverse();
  return list;
}
function fmtBrands(l) { return l.map((b) => '"' + b.brand + '";v="' + b.version + '"').join(', '); }
function secChUa() { return fmtBrands(brandList(false)); }
function secChUaFull() { return fmtBrands(brandList(true)); }
const CHROME_UA = buildChromeUA();
app.userAgentFallback = CHROME_UA;
// Mahsulot nomi MRBrowser — userData ~/.config/mrbrowser (Chrome profiliga aralashmasin)
try {
  app.setName('MRBrowser');
  app.setPath('userData', require('path').join(app.getPath('appData'), 'mrbrowser'));
} catch {}
// Avtomatlashtirish belgisini o'chirish (Google OAuth)
try {
  app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
  app.commandLine.appendSwitch('disable-features', 'IsolateOrigins,site-per-process,TranslateUI,AutomationControlled');
  app.commandLine.appendSwitch('exclude-switches', 'enable-automation');
  app.commandLine.appendSwitch('renderer-process-limit', '10');
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=384');
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization,NetworkServiceInProcess2');
} catch {}


/* ───────────── umumiy yordamchilar ───────────── */
const ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', sug: 'https://duckduckgo.com/ac/?type=list&q=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s', sug: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s', sug: null },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s', sug: 'https://api.bing.com/osjson.aspx?query=%s' },
  yandex: { name: 'Yandex', url: 'https://yandex.com/search/?text=%s', sug: null },
};
const eng = (accountId) => {
  const a = store.acc(accountId);
  return ENGINES[a.engine] || ENGINES[store.get().settings.engine] || ENGINES.google;
};
/** Faol context account id */
function aid(c, tab) {
  if (c && c.priv) return 'default';
  return (tab && tab.accountId) || (c && c.accountId) || store.get().lastAccountId || 'default';
}
function accFromWc(wc) {
  if (!wc || wc.isDestroyed()) return store.get().lastAccountId || 'default';
  const r = tabByWc.get(wc.id);
  if (r && !r.ctx.priv) return aid(r.ctx, r.tab);
  return store.get().lastAccountId || 'default';
}
const searchUrl = (q, accountId) => eng(accountId).url.replace('%s', encodeURIComponent(q));
const ROUTES = new Set(['newtab', 'dashboard', 'history', 'bookmarks', 'downloads', 'settings', 'error']);

function isLocalHost(h) {
  return h === 'localhost' || h === '0.0.0.0' || h === '[::1]' || /^127\./.test(h) || /^10\./.test(h) ||
    /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.local');
}
// Kiritilgan matn: URLmi yoki qidiruvmi
function isGoogleAuth(url) {
  try {
    const h = new URL(url).hostname;
    return /(^|\.)accounts\.google\.com$|(^|\.)google\.com$/.test(h) && /accounts|oauth|signin|ServiceLogin/i.test(url);
  } catch { return /accounts\.google\.com/i.test(String(url || '')); }
}
/** Har doim to'liq Chrome UA — bare "Chrome" Google login loadingda qotishiga olib keladi */
function uaForUrl(_url) {
  return CHROME_UA;
}
function loadWithUA(wc, url) {
  if (!wc || wc.isDestroyed() || !url) return Promise.resolve();
  const ua = uaForUrl(url);
  try { wc.setUserAgent(ua); } catch {}
  return wc.loadURL(url, { userAgent: ua }).catch(() => {});
}
function resolveInput(s) {
  s = (s || '').trim();
  if (!s) return null;
  if (/^javascript:/i.test(s)) return null;
  if (/^(view-source:|about:|data:)/i.test(s) || /^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return { url: s, kind: 'url' };
  if (/^(localhost|(\d{1,3}\.){3}\d{1,3}|[\w-]+(\.[\w-]+)+)(:\d+)?([/?#].*)?$/i.test(s)) {
    const host = s.split(/[/?#:]/)[0];
    return { url: (isLocalHost(host) ? 'http://' : 'https://') + s, kind: 'url' };
  }
  return { url: searchUrl(s), kind: 'search' };
}
function defaultPageUrl(accountId) {
  const h = (store.acc(accountId).homepage || '').trim();
  if (!h) return 'mrb://dashboard/';
  const r = resolveInput(h);
  if (r && r.kind === 'url') return r.url;
  return 'mrb://dashboard/';
}
/** Homepage: faqat haqiqiy URL (domain). Bo'sh = dashboard. "gg" rad. */
function normalizeHomepage(v) {
  v = String(v || '').trim().slice(0, 500);
  if (!v) return '';
  const r = resolveInput(v);
  if (!r || r.kind !== 'url') return null; // invalid
  return v;
}
function display(url) {
  if (!url) return '';
  if (/^mrb:\/\/(newtab|dashboard)\/?([?#].*)?$/.test(url)) return '';
  if (url.startsWith('mrb://error')) { try { return new URL(url).searchParams.get('url') || ''; } catch { return ''; } }
  return url;
}
const blankRaw = (u) => !u || /^mrb:\/\/newtab\/?$/.test(u);
function secLevel(u) {
  if (u.startsWith('https:')) return 'secure';
  if (u.startsWith('http:')) return 'insecure';
  if (u.startsWith('mrb:') || u.startsWith('about:') || u.startsWith('view-source:')) return 'internal';
  if (u.startsWith('file:')) return 'file';
  return u ? 'none' : 'internal';
}
const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

/* ───────────── holat ───────────── */
const ctxs = new Set();
const ctxByUi = new Map();
const tabByWc = new Map();
let lastCtx = null;
let privateSeq = 0;
const ACC_COLORS = ['#A8D5E5', '#C5B4E3', '#B8E0D2', '#F5D0C5', '#D4E5B8', '#E8C4E0', '#C9D6E8', '#E5D5B5'];
function softColor(c) {
  const harsh = { '#e81123': '#F5D0C5', '#ff0000': '#F5D0C5', '#f472b6': '#E8C4E0', '#a3e635': '#D4E5B8', '#ffb347': '#E5D5B5', '#5bc0de': '#A8D5E5' };
  const k = String(c || '').toLowerCase();
  return harsh[k] || c || ACC_COLORS[0];
}
function listAccounts() {
  return store.get().accounts.map((a) => ({ id: a.id, name: a.name, color: softColor(a.color) }));
}
function getAccount(id) {
  const d = store.get();
  const a = d.accounts.find((x) => x.id === id);
  return a || d.accounts.find((x) => x.id === 'default') || d.accounts[0];
}
function makeAccountId() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function createAccount(name, color) {
  const d = store.get();
  const n = String(name || '').trim().slice(0, 40) || (tt('account_colon') + ' ' + (d.accounts.length + 1));
  const used = new Set(d.accounts.map((a) => (a.color || '').toLowerCase()));
  let col = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : ACC_COLORS.find((c) => !used.has(c.toLowerCase())) || ACC_COLORS[d.accounts.length % ACC_COLORS.length];
  const acc = { id: makeAccountId(), name: n, color: col, ...store.ACCOUNT_DEFAULTS() };
  d.accounts.push(acc);
  store.save();
  return acc;
}
function renameAccount(id, name) {
  const a = getAccount(id);
  if (!a || a.id === 'default' && id !== 'default') return null;
  const acc = store.get().accounts.find((x) => x.id === id);
  if (!acc) return null;
  const n = String(name || '').trim().slice(0, 40);
  if (!n) return acc;
  acc.name = n;
  store.save();
  return acc;
}
function setAccountColor(id, color) {
  const acc = store.get().accounts.find((x) => x.id === id);
  if (!acc || !/^#[0-9a-fA-F]{6}$/.test(color || '')) return null;
  acc.color = color;
  store.save();
  return acc;
}
async function deleteAccount(id) {
  if (!id || id === 'default') return false;
  const d = store.get();
  const i = d.accounts.findIndex((x) => x.id === id);
  if (i < 0) return false;
  d.accounts.splice(i, 1);
  if (d.lastAccountId === id) d.lastAccountId = 'default';
  store.save();
  // Oynani YOPMAYMIZ — faqat shu account tablarini olib tashlaymiz
  for (const c of [...ctxs]) {
    if (c.priv || c.win.isDestroyed()) continue;
    if (c.accountId === id) {
      c.accountId = 'default';
      c.account = getAccount('default');
    }
    const doomed = c.tabs.filter((t) => t.accountId === id);
    for (const t of doomed) {
      const ti = c.tabs.indexOf(t);
      if (ti < 0) continue;
      for (const p of [...perms.values()]) if (p.tab === t) { try { p.cb(false); } catch {} perms.delete(p.id); }
      try { c.win.contentView.removeChildView(t.view); } catch {}
      tabByWc.delete(t.wc.id);
      c.tabs.splice(ti, 1);
      try { t.wc.close(); } catch {}
    }
    if (!c.tabs.length) {
      c.activeId = null;
      createTab(c, null, { accountId: 'default' });
    } else if (!c.tabs.some((t) => t.id === c.activeId)) {
      c.activeId = null;
      switchTab(c, c.tabs[0].id);
    } else {
      layout(c); pushState(c);
    }
  }
  try {
    const ses = session.fromPartition('persist:mrb-acc-' + id);
    await ses.clearStorageData();
    await ses.clearCache();
  } catch {}
  return true;
}
function sesForAccountId(accountId, priv) {
  if (priv) return session.fromPartition('mrb-private-' + (++privateSeq));
  const acc = getAccount(accountId || 'default');
  return acc.id === 'default' ? session.defaultSession : session.fromPartition('persist:mrb-acc-' + acc.id);
}
function sessionForOpts(opts) {
  if (opts.private) return { ses: session.fromPartition('mrb-private-' + (++privateSeq)), priv: true, accountId: null, account: null };
  const acc = getAccount(opts.accountId || store.get().lastAccountId || 'default');
  const ses = sesForAccountId(acc.id, false);
  return { ses, priv: false, accountId: acc.id, account: acc };
}
const upgrades = new Map();   // https url -> http url (fallback uchun)
const noUpgrade = new Set();  // https ishlamagan hostlar
const perms = new Map();
let permSeq = 0;
const dls = [];
const dlItems = new Map();
let dlSeq = 0;
let dlTimer = null;
let internalHtml = null;

const activeTab = (c) => c.tabs.find((t) => t.id === c.activeId);
const getTab = (c, id) => c.tabs.find((t) => t.id === id);
const sendUi = (c, ch, ...a) => { try { if (!c.ui.webContents.isDestroyed()) c.ui.webContents.send('ui-ev:' + ch, ...a); } catch {} };
function broadcastPages(ch, ...a) {
  for (const { tab } of tabByWc.values()) {
    try {
      if (tab.wc.isDestroyed()) continue;
      const u = tab.wc.getURL() || '';
      if (u.startsWith('mrb:') || u.startsWith('mrb://')) tab.wc.send('page-ev:' + ch, ...a);
    } catch {}
  }
}

/* ───────────── tarix / xatcho'plar ───────────── */

function recordVisit(url, accountId) {
  const h = store.acc(accountId).history;
  let e = h.find((x) => x.url === url);
  if (e) { e.count++; e.ts = Date.now(); } else {
    h.push({ url, title: '', icon: '', ts: Date.now(), count: 1 });
    if (h.length > 3000) { h.sort((a, b) => b.ts - a.ts); h.length = 2500; }
  }
  store.save();
}
function histUpdate(url, patch, accountId) {
  const list = store.acc(accountId).history;
  let e = list.find((x) => x.url === url);
  if (!e && patch && patch.icon) {
    // favicon navigatsiyadan oldin kelishi mumkin — yozuv yaratamiz
    e = { url, title: '', icon: '', ts: Date.now(), count: 0 };
    list.push(e);
  }
  if (e) { Object.assign(e, patch); store.save(); }
}
/** Hostni normalizatsiya (www. ni olib tashlash). */
function normHost(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}
/** Domen uchun ishonchli favicon (Google S2 — har doim ishlaydi). */
function faviconForHost(host) {
  host = String(host || '').replace(/^www\./, '').toLowerCase();
  if (!host) return '';
  return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=64';
}
function faviconForUrl(url) {
  const h = normHost(url);
  return h ? faviconForHost(h) : '';
}
/** Tezkor kirish faviconini yangilash — host / base domain bo'yicha. */
function syncShortcutIcon(url, icon, accountId) {
  if (!icon || !url) return;
  const host = normHost(url);
  if (!host) return;
  const base = host.split('.').slice(-2).join('.');
  const d = store.acc(accountId);
  const list = d.shortcuts || [];
  let changed = false;
  for (const s of list) {
    const sh = normHost(s.url);
    if (!sh) continue;
    const sb = sh.split('.').slice(-2).join('.');
    if ((sh === host || sb === base) && s.icon !== icon) {
      s.icon = icon;
      changed = true;
    }
  }
  if (changed) { store.save(); broadcastPages('settings'); }
}
/** Shortcut / topsites uchun eng yaxshi icon: tarix → fallback service. */
function iconFromHistory(url, accountId) {
  const host = normHost(url);
  if (!host) return '';
  const base = host.split('.').slice(-2).join('.');
  const h = store.acc(accountId).history || [];
  let best = '';
  let bestTs = 0;
  for (const e of h) {
    if (!e.icon) continue;
    const eh = normHost(e.url);
    if (!eh) continue;
    const eb = eh.split('.').slice(-2).join('.');
    if ((eh === host || eb === base) && (e.ts || 0) >= bestTs) {
      best = e.icon; bestTs = e.ts || 0;
    }
  }
  return best || faviconForHost(host);
}

/** So'nggi bloklangan treker/reklama domenlari (dashboard uchun). */
const RECENT_BLOCKED_MAX = 40;
function noteBlocked(host) {
  if (!host) return;
  host = String(host).replace(/^www\./, '').toLowerCase();
  const d = store.get();
  if (!Array.isArray(d.recentBlocked)) d.recentBlocked = [];
  let e = d.recentBlocked.find((x) => x.host === host);
  if (e) { e.count = (e.count || 1) + 1; e.ts = Date.now(); }
  else d.recentBlocked.unshift({ host, count: 1, ts: Date.now() });
  // eng yangilar tepada
  d.recentBlocked.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  if (d.recentBlocked.length > RECENT_BLOCKED_MAX) d.recentBlocked.length = RECENT_BLOCKED_MAX;
  store.save();
}
function recentBlockedList(limit) {
  const list = (store.get().recentBlocked || []).slice();
  return list.slice(0, limit || 20);
}

// ── Aqlli omnibox: tarix + xatcho'p + ochiq tab + web ──
function scoreRecency(ts, now) {
  const days = Math.max(0, (now - (ts || 0)) / 864e5);
  return 1 / (1 + days / 7); // 7 kunda yarim ta'sir
}
function stripUrl(u) {
  return String(u || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '');
}
function autoComplete(text, accountId) {
  const typed = String(text || '');
  if (!typed || typed.length > 200 || /\s/.test(typed)) return '';
  const hasProto = /^https?:\/\//i.test(typed);
  const ts = typed.replace(/^https?:\/\//i, '');
  if (!ts || ts.length < 1) return '';
  const low = ts.toLowerCase();
  const wantPath = ts.includes('/') || ts.includes('?');
  const now = Date.now();
  const forms = new Map(); // form -> score
  const add = (form, sc) => {
    if (!form) return;
    const prev = forms.get(form) || 0;
    if (sc > prev) forms.set(form, sc);
  };
  const A = store.acc(accountId);
  const feed = (urlStr, base) => {
    let u; try { u = new URL(urlStr); } catch { return; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    const host = u.hostname.replace(/^www\./, '');
    const path = (u.pathname || '/').replace(/\/$/, '') || '';
    const full = host + (path === '/' ? '' : path) + (u.search || '');
    // host
    add(host, base * 2);
    add('www.' + host, base * 0.8);
    // path variants
    if (path && path !== '/') {
      add(host + path, base * 1.5);
      // intermediate segments: example.com/a, example.com/a/b
      const parts = path.split('/').filter(Boolean);
      let acc = '';
      for (const p of parts) {
        acc += '/' + p;
        add(host + acc, base);
      }
    }
    add(full, base);
  };
  for (const e of A.history) {
    const sc = (Math.log2((e.count || 1) + 1) + 1) * scoreRecency(e.ts, now);
    feed(e.url, sc);
  }
  for (const b of A.bookmarks) feed(b.url, 8);
  // ochiq tablar — eng kuchli signal
  for (const c of ctxs) {
    if (c.priv) continue;
    for (const t of c.tabs) {
      try {
        const u = t.wc.isDestroyed() ? '' : t.wc.getURL();
        if (u && /^https?:/i.test(u)) feed(u, 12);
      } catch {}
    }
  }
  let best = '', bs = 0;
  for (const [f, sc] of forms) {
    const fl = f.toLowerCase();
    if (fl.length <= low.length) continue;
    if (!fl.startsWith(low)) continue;
    // path yozilmasa — path taklifini pastroq bahola
    let s = sc;
    if (!wantPath && f.includes('/')) s *= 0.35;
    // qisqa host afzal (google.com > google.com/foo)
    if (!wantPath && !f.includes('/')) s *= 1.4;
    // to'g'ri TLD tugashi bonus
    if (/\.[a-z]{2,}$/i.test(f) && !f.includes('/')) s *= 1.15;
    if (s > bs) { best = f; bs = s; }
  }
  if (!best) return '';
  // typed registrini saqlab, faqat qo'shimchani yozamiz
  const suffix = best.slice(ts.length);
  return typed + suffix;
}
function topSites(n = 8, accountId) {
  const a = store.acc(accountId);
  const custom = (a.shortcuts || []).slice(0, n).map((s) => ({
    id: s.id, title: s.title || hostOf(s.url).replace(/^www\./, ''), url: s.url, icon: s.icon || faviconForUrl(s.url) || '', custom: true,
  }));
  if (custom.length >= n) return custom;
  const used = new Set(custom.map((s) => { try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { return ''; } }));
  const map = new Map();
  for (const h of a.history) {
    const host = hostOf(h.url).replace(/^www\./, '');
    if (!host || used.has(host)) continue;
    let e = map.get(host);
    if (!e) { e = { host, count: 0, best: h, ts: h.ts || 0 }; map.set(host, e); }
    e.count += h.count || 1;
    e.ts = Math.max(e.ts, h.ts || 0);
    if ((h.count || 0) > (e.best.count || 0)) e.best = h;
  }
  const auto = [...map.values()].sort((x, y) => (y.count * scoreRecency(y.ts, Date.now())) - (x.count * scoreRecency(x.ts, Date.now()))).slice(0, n - custom.length).map((e) => {
    let origin = '';
    try { origin = new URL(e.best.url).origin + '/'; } catch {}
    return { title: e.host, url: origin, icon: e.best.icon || faviconForHost(e.host) || '', custom: false };
  });
  return custom.concat(auto);
}
function localSuggest(text, accountId) {
  const raw = String(text || '').trim();
  const q = raw.toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  if (!q) return [];
  const d = store.get();
  const A = store.acc(accountId);
  const now = Date.now();
  const scored = [];
  const seen = new Set();
  const push = (item, score) => {
    const key = item.url || item.text;
    if (!key || seen.has(key)) return;
    seen.add(key);
    scored.push({ item, score });
  };
  // 1) ochiq tablar
  for (const c of ctxs) {
    if (c.priv) continue;
    for (const t of c.tabs) {
      try {
        if (t.wc.isDestroyed()) continue;
        const url = t.wc.getURL();
        if (!url || !/^https?:/i.test(url)) continue;
        const title = (t.title || '').toLowerCase();
        const host = stripUrl(url).toLowerCase();
        let s = 0;
        if (host.startsWith(q)) s = 100;
        else if (host.includes(q)) s = 70;
        else if (title.includes(q)) s = 50;
        else continue;
        push({ type: 'tab', title: t.title || url, url, icon: t.favicon }, s + 20);
      } catch {}
    }
  }
  // 2) xatcho'plar
  for (const b of A.bookmarks) {
    const title = (b.title || '').toLowerCase();
    const host = stripUrl(b.url).toLowerCase();
    let s = 0;
    if (host.startsWith(q)) s = 90;
    else if (title.startsWith(q)) s = 80;
    else if (host.includes(q)) s = 60;
    else if (title.includes(q)) s = 45;
    else continue;
    push({ type: 'bookmark', title: b.title || b.url, url: b.url, icon: b.icon }, s);
  }
  // 3) tarix — domain + title + path
  for (const h of A.history) {
    const title = (h.title || '').toLowerCase();
    const host = stripUrl(h.url).toLowerCase();
    const bare = hostOf(h.url).replace(/^www\./, '').toLowerCase();
    let s = 0;
    if (bare.startsWith(q) || host.startsWith(q)) s = 75;
    else if (bare.split('.')[0] === q) s = 72; // "you" → youtube.com
    else if (bare.includes(q) || host.includes(q)) s = 40;
    else if (title.startsWith(q)) s = 35;
    else if (title.includes(q)) s = 22;
    else continue;
    const freq = Math.log2((h.count || 1) + 1);
    const rec = scoreRecency(h.ts, now);
    // qisqa URL (root) afzalroq qisqa so'rovda
    const pathBonus = (!q.includes('/') && /^https?:\/\/[^/]+\/?$/i.test(h.url)) ? 8 : 0;
    push({ type: 'history', title: h.title || h.url, url: h.url, icon: h.icon }, s + freq * 6 + rec * 15 + pathBonus);
  }
  // 4) domain-only taklif: eng yaxshi host uchun origin
  if (q.length >= 2 && !q.includes('/') && !q.includes(' ')) {
    const hosts = new Map();
    for (const h of A.history) {
      const host = hostOf(h.url).replace(/^www\./, '').toLowerCase();
      if (!host.startsWith(q) && !host.includes('.' + q) && host.split('.')[0] !== q) continue;
      const sc = (Math.log2((h.count || 1) + 1) + 1) * scoreRecency(h.ts, now);
      const prev = hosts.get(host);
      if (!prev || sc > prev.sc) hosts.set(host, { sc, url: (() => { try { return new URL(h.url).origin + '/'; } catch { return h.url; } })(), icon: h.icon, title: host });
    }
    for (const [, v] of hosts) {
      push({ type: 'history', title: v.title, url: v.url, icon: v.icon }, 55 + v.sc * 5);
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8).map((x) => x.item);
}
async function webSuggest(q) {
  const s = store.get().settings;
  if (!s.suggest) return [];
  const query = String(q || '').trim();
  if (!query || query.length < 2) return [];
  const urls = [];
  const primary = eng().sug || ENGINES.google.sug; // last account engine
  if (primary) urls.push(primary.replace('%s', encodeURIComponent(query)));
  if (eng().sug !== ENGINES.duckduckgo.sug) urls.push(ENGINES.duckduckgo.sug.replace('%s', encodeURIComponent(query)));
  for (const url of urls) {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 1200);
      const r = await net.fetch(url, { signal: ctl.signal });
      clearTimeout(to);
      const j = await r.json();
      const list = (Array.isArray(j[1]) ? j[1] : []).filter((x) => typeof x === 'string' && x.trim());
      if (list.length) return list.slice(0, 6);
    } catch {}
  }
  return [];
}

/* ───────────── yuklamalar ───────────── */
function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p);
  const base = p.slice(0, p.length - ext.length);
  for (let i = 1; ; i++) { const q = `${base} (${i})${ext}`; if (!fs.existsSync(q)) return q; }
}
const dlList = () => dls.slice(0, 40).map(({ id, name, path: p, url, total, received, state, paused, ts }) => ({ id, name, path: p, url, total, received, state, paused, ts }));
function dlBroadcast(now) {
  if (dlTimer && !now) return;
  clearTimeout(dlTimer);
  dlTimer = setTimeout(() => {
    dlTimer = null;
    const list = dlList();
    for (const c of ctxs) { sendUi(c, 'downloads', list); pushState(c); }
    broadcastPages('downloads', list);
  }, now ? 0 : 200);
}
function onDownload(item, wc) {
  const dir = app.getPath('downloads');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const target = uniquePath(path.join(dir, item.getFilename() || 'download'));
  item.setSavePath(target);
  const rec = { id: ++dlSeq, name: path.basename(target), path: target, url: item.getURL(), total: item.getTotalBytes(), received: 0, state: 'progressing', paused: false, ts: Date.now() };
  dls.unshift(rec);
  dlItems.set(rec.id, item);
  const r = wc && tabByWc.get(wc.id);
  if (r) sendUi(r.ctx, 'dl-start');
  dlBroadcast(true);
  item.on('updated', (_e, state) => {
    rec.received = item.getReceivedBytes(); rec.total = item.getTotalBytes();
    rec.state = state === 'interrupted' ? 'interrupted' : 'progressing'; rec.paused = item.isPaused();
    dlBroadcast();
  });
  item.once('done', (_e, state) => {
    rec.received = item.getReceivedBytes(); rec.state = state; rec.paused = false;
    dlItems.delete(rec.id);
    dlBroadcast(true);
  });
}
function dlAction(id, act) {
  const rec = dls.find((x) => x.id === id);
  if (!rec) return;
  const it = dlItems.get(id);
  if (act === 'open') shell.openPath(rec.path);
  else if (act === 'show') shell.showItemInFolder(rec.path);
  else if (act === 'cancel' && it) it.cancel();
  else if (act === 'pause' && it) it.pause();
  else if (act === 'resume' && it && it.canResume()) it.resume();
  else if (act === 'remove' && !it) dls.splice(dls.indexOf(rec), 1);
  dlBroadcast(true);
}

/* ───────────── ruxsatlar ───────────── */
const SAFE_PERMS = new Set(['clipboard-sanitized-write', 'fullscreen', 'pointerLock', 'keyboardLock', 'speaker-selection']);
function permLabel(perm, details) {
  if (perm === 'media') {
    const m = (details && details.mediaTypes) || [];
    if (m.includes('video') && m.includes('audio')) return tt('perm_media_both');
    return m.includes('video') ? tt('perm_media_video') : tt('perm_media_audio');
  }
  const map = {
    geolocation: 'perm_geo', notifications: 'perm_notify', 'clipboard-read': 'perm_clipboard',
    midi: 'perm_midi', midiSysex: 'perm_midi', 'display-capture': 'perm_display',
    openExternal: 'perm_external', 'idle-detection': 'perm_idle',
  };
  if (map[perm]) return tt(map[perm]);
  return tt('perm_generic').replace('%s', perm);
}
function normOrigin(o) { return String(o || '').replace(/\/$/, ''); }

/* ───────────── sessiya sozlash ───────────── */
const sessionsDone = new WeakSet();
function handleMrb(req) {
  const u = new URL(req.url);
  if (!ROUTES.has(u.hostname)) return new Response('Not found', { status: 404 });
  try {
    internalHtml = fs.readFileSync(paths.internalHtml);
  } catch (e) {
    return new Response('Internal page missing', { status: 500 });
  }
  return new Response(internalHtml, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
function setupSession(ses, priv, accountId) {
  if (sessionsDone.has(ses)) return;
  sessionsDone.add(ses);
  try { ses.setUserAgent(CHROME_UA); } catch {}
  ses.protocol.handle('mrb', handleMrb);
  shields.setup(ses, {
    settings: () => {
      const s = store.get().settings;
      const A = store.acc(priv ? null : accountId);
      return { ...s, shieldsOff: A.shieldsOff || [] };
    },
    isLocal: isLocalHost,
    noUpgrade: (h) => noUpgrade.has(h),
    onUpgrade: (https, http) => upgrades.set(https, http),
    onBlocked: (wc, host) => {
      store.get().totalBlocked++;
      noteBlocked(host);
      store.save();
      const r = wc && !wc.isDestroyed() && tabByWc.get(wc.id);
      if (r) { r.tab.blocked++; pushState(r.ctx); }
    },
    chromeUA: CHROME_UA,
    secChUa: secChUa,
    secChUaFull: secChUaFull,
  });
  ses.setPermissionRequestHandler((wc, perm, cb, details) => {
    if (SAFE_PERMS.has(perm)) return cb(true);
    let origin = '';
    try { origin = new URL((details && details.requestingUrl) || (wc && !wc.isDestroyed() && wc.getURL()) || '').origin; } catch {}
    origin = normOrigin(origin);
    if (!origin || origin === 'null' || origin.startsWith('mrb:')) return cb(false);
    // media: audio/video alohida ham saqlangan bo'lishi mumkin
    const permsMap = store.acc(accFromWc(wc)).permissions[origin] || {};
    let known = permsMap[perm];
    if (known === undefined && perm === 'media') {
      const types = (details && details.mediaTypes) || [];
      if (types.includes('audio') && permsMap.media === true) known = true;
      if (types.includes('video') && permsMap.media === true) known = true;
    }
    if (known !== undefined) return cb(!!known);
    let r = (wc && !wc.isDestroyed()) ? tabByWc.get(wc.id) : null;
    if (!r) {
      // Popup / iframe — faol tab contextini ishlat
      for (const c of ctxs) {
        const t = activeTab(c);
        if (t && !t.wc.isDestroyed()) { r = { ctx: c, tab: t }; break; }
      }
    }
    if (!r) return cb(false);
    const id = ++permSeq;
    perms.set(id, { id, cb, origin, perm, label: permLabel(perm, details), ctx: r.ctx, tab: r.tab, priv: !!(r.ctx && r.ctx.priv), mediaTypes: (details && details.mediaTypes) || [] });
    pushState(r.ctx);
  });
  ses.setPermissionCheckHandler((_wc, perm, requestingOrigin) => {
    if (SAFE_PERMS.has(perm)) return true;
    const origin = normOrigin(requestingOrigin);
    const p = store.acc(accFromWc(_wc)).permissions[origin];
    if (!p) return false;
    if (p[perm] === true) return true;
    // media ruxsati kamera/mikrofon checklarini ham qamrab oladi
    if ((perm === 'media' || perm === 'microphone' || perm === 'camera') && p.media === true) return true;
    return false;
  });
  // Electron 30+: getUserMedia qurilma ruxsati — asosiy gate setPermissionRequestHandler
  try {
    ses.setDevicePermissionHandler((details) => {
      const origin = normOrigin(details && details.origin);
      if (!origin) return false;
      // device handlerda wc yo'q — lastAccount yoki origin bo'yicha barcha accountlarni tekshirish
      let p = null;
      for (const a of store.get().accounts) {
        if (a.permissions && a.permissions[origin]) { p = a.permissions[origin]; break; }
      }
      if (!p) p = store.acc().permissions[origin];
      // Aniq rad etilgan bo'lsa — yo'q
      if (p && p.media === false) return false;
      // Ruxsat berilgan yoki bir martalik allow (request handler) — qurilmani ochamiz
      return true;
    });
  } catch {}
  ses.on('will-download', (_e, item, wc) => onDownload(item, wc));
}

/* ───────────── holatni UI ga yuborish ───────────── */
function buildState(c) {
  const t = activeTab(c);
  const wc = t && !t.wc.isDestroyed() ? t.wc : null;
  const d = store.get();
  const s = d.settings;
  const A = store.acc(aid(c, t));
  const raw = wc ? wc.getURL() : '';
  const homeBlank = !!(t && t.homeBlank);
  const url = homeBlank ? '' : display(raw);
  const host = homeBlank ? '' : hostOf(raw);
  const nav = wc ? wc.navigationHistory : null;
  const visSet = new Set(visibleTabs(c).map((x) => x.id));
  return {
    tabs: c.tabs.map((x) => {
      const alive = !x.wc.isDestroyed();
      const acc = (!c.priv && x.accountId) ? getAccount(x.accountId) : null;
      return { id: x.id, title: x.title || display(alive ? x.wc.getURL() : '') || tt('tab_new'), favicon: x.favicon, loading: x.loading, pinned: x.pinned, audible: x.audible, muted: alive && x.wc.isAudioMuted(), vis: visSet.has(x.id), accountId: x.accountId || null, accountColor: acc ? acc.color : null, accountName: acc ? acc.name : null };
    }),
    active: c.activeId, url, sec: secLevel(url || raw),
    canBack: nav ? nav.canGoBack() : false, canFwd: nav ? nav.canGoForward() : false,
    loading: !!(t && t.loading), bookmarked: !!url && A.bookmarks.some((b) => b.url === url),
    zoom: wc ? Math.round(100 * Math.pow(1.2, wc.getZoomLevel())) : 100,
    blocked: t ? t.blocked : 0, host, shieldsGlobal: s.shields, shieldsOn: s.shields && !A.shieldsOff.includes(host),
    totalBlocked: d.totalBlocked, priv: c.priv, bar: s.bookmarksBar,
    account: (() => {
      if (c.priv) return null;
      const a = getAccount(c.accountId || 'default');
      c.account = a; c.accountId = a.id;
      return { id: a.id, name: a.name, color: a.color };
    })(),
    accounts: c.priv ? [] : listAccounts(),
    bookmarks: A.bookmarks.map((b) => ({ id: b.id, title: b.title, url: b.url, icon: b.icon })),
    dl: { active: dls.filter((x) => x.state === 'progressing').length, total: dls.length },
    perms: [...perms.values()].filter((p) => p.ctx === c && t && p.tab === t).map((p) => ({ id: p.id, origin: p.origin, label: p.label })),
    maximized: c.win.isMaximized(), fullscreen: c.win.isFullScreen(),
    engine: eng(aid(c, t)).name, version: VERSION, internal: !homeBlank && raw.startsWith('mrb:'), blank: homeBlank || url === '', tile: !!s.tile,
    lang: i18n.norm(s.language), strings: i18n.dict(s.language), theme: resolvedTheme(), themePref: s.theme || 'system',
    authRequired: false, cloudEmail: null,
  };
}
function pushState(c) {
  if (!c.ready || c.pushT) return;
  c.pushT = setTimeout(() => {
    c.pushT = null;
    if (c.win.isDestroyed()) return;
    sendUi(c, 'state', buildState(c));
  }, 30);
}
const pushAll = () => { for (const c of ctxs) pushState(c); };

/* ───────────── joylashuv ───────────── */
function chromeH(c) {
  if (c.htmlFs) return 0;
  return 66 + (store.get().settings.bookmarksBar ? 28 : 0) + (c.findOpen ? 36 : 0);
}
const GAP = 10, RING = 2, MINW = 340, MINP = 200;
const winSize = (c) => (c.size ? [c.size.w, c.size.h] : c.win.getContentSize());
function tileGeom(c) {
  const [W] = winSize(c);
  const n = c.tabs.length;
  const custom = c.tabs.some((t) => t.tw);
  const defW = Math.max(MINP, Math.min(Math.max(MINW, Math.round(W / 2)), W - GAP * 2));
  const rects = [];
  let total;
  if (custom) {
    let x = GAP;
    for (const t of c.tabs) {
      const tw = Math.max(MINP, Math.min(t.tw || defW, Math.max(MINP, W - GAP * 2)));
      rects.push({ x, w: tw }); x += tw + GAP;
    }
    total = x;
  } else if (GAP + n * (MINW + GAP) <= W) {
    const areaW = Math.max(0, W - GAP * 2);
    for (let i = 0; i < n; i++) {
      const x0 = Math.round(GAP + (areaW + GAP) * i / n);
      const x1 = Math.round(GAP + (areaW + GAP) * (i + 1) / n - GAP);
      rects.push({ x: x0, w: x1 - x0 });
    }
    total = W;
  } else {
    for (let i = 0; i < n; i++) rects.push({ x: GAP + i * (MINW + GAP), w: MINW });
    total = GAP + n * (MINW + GAP);
  }
  const overflow = n > 0 && total > W;
  return { w: W, n, rects, total, overflow, max: overflow ? total - W : 0, custom };
}
function revealActive(c) {
  const g = tileGeom(c);
  if (!g.overflow) { c.scrollX = 0; return; }
  const ai = c.tabs.findIndex((t) => t.id === c.activeId);
  if (ai < 0) return;
  const left = g.rects[ai].x - GAP, right = g.rects[ai].x + g.rects[ai].w + GAP;
  if (left < c.scrollX) c.scrollX = left;
  else if (right > c.scrollX + g.w) c.scrollX = right - g.w;
}
function resizeTab(c, id, w) {
  if (!(typeof w === 'number' && isFinite(w))) return;
  if (!store.get().settings.tile || c.htmlFs) return;
  const t = getTab(c, id);
  if (!t) return;
  if (!c.tabs.some((x) => x.tw)) { const g = tileGeom(c); c.tabs.forEach((x, i) => { x.tw = g.rects[i].w; }); }
  const W = winSize(c)[0];
  t.tw = Math.max(MINP, Math.min(Math.round(w), Math.max(MINP, W - GAP * 2)));
  layout(c); pushState(c);
}
function resetWidths(c) {
  for (const t of c.tabs) delete t.tw;
  c.scrollX = 0; c.reveal = true;
  layout(c); pushState(c);
}
// Gorizontal surish: hodisalar yig'iladi, layout ~8ms oynada bir marta ishlaydi (birinchi hodisa darhol)
function hscrollApply(c) {
  const p = c.hsPend; c.hsPend = null;
  if (!p || c.win.isDestroyed()) return;
  if (!store.get().settings.tile || c.htmlFs) return;
  const g = tileGeom(c);
  if (!g.overflow) return;
  if (p.ratio != null) c.scrollX = Math.max(0, Math.min(1, p.ratio)) * g.max;
  c.scrollX = (c.scrollX || 0) + p.dx;
  const before = c.visKey;
  layout(c);
  if (c.visKey !== before) pushState(c); // UI faqat ko'rinadigan tablar o'zgarganda kerak
}
function hscroll(c, kind, v) {
  if (!(typeof v === 'number' && isFinite(v))) return;
  if (!store.get().settings.tile || c.htmlFs) return;
  const p = c.hsPend || (c.hsPend = { dx: 0, ratio: null });
  if (kind === 'ratio') { p.ratio = v; p.dx = 0; } else p.dx += v;
  if (c.hsTimer) return;
  hscrollApply(c);
  const tick = () => { c.hsTimer = null; if (c.hsPend) { hscrollApply(c); c.hsTimer = setTimeout(tick, 8); } };
  c.hsTimer = setTimeout(tick, 8);
}
// Chekkada qayta-qayta addChildView/removeChildView bo'lmasligi uchun: gisterezis (biriktirish M, ajratish 2M)
function attachSet(c, vis) {
  const g = tileGeom(c);
  const M = MINW + GAP * 2;
  const s = new Set();
  c.tabs.forEach((t, i) => {
    const x0 = g.rects[i].x - c.scrollX, x1 = x0 + g.rects[i].w;
    const dist = Math.max(0, -x1, x0 - g.w);
    if (vis.includes(t) || dist <= (t.attached ? M * 2 : M)) s.add(t);
  });
  return s;
}
function visibleTabs(c) {
  const n = c.tabs.length;
  if (!n) return [];
  const tiled = store.get().settings.tile && !c.htmlFs;
  if (!tiled) { const t = activeTab(c); return t ? [t] : []; }
  const g = tileGeom(c);
  c.scrollX = g.overflow ? Math.max(0, Math.min(c.scrollX || 0, g.max)) : 0;
  return c.tabs.filter((t, i) => { const x0 = g.rects[i].x - c.scrollX; return x0 + g.rects[i].w > 0 && x0 < g.w; });
}
function paintFrame(c, rects) {
  c.frameRects = rects;
  if (!c.frameReady || c.win.isDestroyed()) return;
  const borders = store.get().settings.tileBorder !== false;
  const payload = JSON.stringify({ rects, priv: c.priv, bar: c.frameBar, borders });
  if (c.frameKey === payload) return;
  c.frameKey = payload;
  try { c.win.webContents.executeJavaScript('window.__panes&&window.__panes(' + payload + ')').catch(() => {}); } catch {}
}
// Bounds o'zgarmagan bo'lsa native chaqiruvlar o'tkazib yuboriladi (scroll paytida ortiqcha IPC/layout bo'lmasin)
function setViewBounds(t, b) {
  const k = b.x + ',' + b.y + ',' + b.width + ',' + b.height;
  if (t.bk !== k) { t.bk = k; t.view.setBounds(b); }
  if (!t.brSet) { t.brSet = true; try { t.view.setBorderRadius(0); } catch {} }
}
function cloudAuthed() {
  return true;
}
function layout(c) {
  if (c.win.isDestroyed()) return;
  const [w, h] = winSize(c);
  const ch = chromeH(c);
  const gate = !cloudAuthed();
  c.authGate = gate;
  c.ui.setVisible(!c.htmlFs || gate);
  c.ui.setBounds((gate || c.overlay) ? { x: 0, y: 0, width: w, height: h } : { x: 0, y: 0, width: w, height: ch });
  if (gate) {
    // Tablarni yashirish — faqat root login
    for (const t of c.tabs) {
      if (t.attached) { try { c.win.contentView.removeChildView(t.view); } catch {} t.attached = false; }
    }
    try { c.win.contentView.addChildView(c.ui); } catch {}
    paintFrame(c, []);
    return;
  }
  if (c.reveal) { c.reveal = false; revealActive(c); }
  const vis = visibleTabs(c);
  c.visKey = vis.map((t) => t.id).join(',');
  const tiled = !!store.get().settings.tile && !c.htmlFs;
  const keep = tiled ? attachSet(c, vis) : new Set(vis);
  let added = false;
  for (const t of c.tabs) {
    if (keep.has(t)) {
      if (!t.attached) { c.win.contentView.addChildView(t.view); t.attached = true; added = true; }
    } else if (t.attached) { try { c.win.contentView.removeChildView(t.view); } catch {} t.attached = false; }
  }
  const rects = [];
  if (!tiled) {
    const t = vis[0];
    if (t) { setViewBounds(t, { x: 0, y: ch, width: w, height: Math.max(0, h - ch) }); }
  } else {
    const g = tileGeom(c);
    const areaH = Math.max(0, h - ch - GAP);
    c.tabs.forEach((t) => {
      if (!keep.has(t)) return;
      const q = g.rects[c.tabs.indexOf(t)];
      const r = { x: q.x - c.scrollX, y: ch, w: q.w, h: areaH, a: t.id === c.activeId, id: t.id, color: (!c.priv && t.accountId) ? (getAccount(t.accountId).color || null) : null };
      if (vis.includes(t)) rects.push(r);
      const ring = store.get().settings.tileBorder !== false ? RING : 0;
      setViewBounds(t, { x: r.x + ring, y: r.y + ring, width: Math.max(0, r.w - ring * 2), height: Math.max(0, r.h - ring * 2) });
    });
  }
  c.frameBar = null;
  if (tiled) {
    const g = tileGeom(c);
    if (g.overflow) {
      const bw = Math.max(36, Math.round(g.w * g.w / g.total));
      c.frameBar = { x: Math.round(g.max ? (c.scrollX / g.max) * (g.w - bw) : 0), w: bw };
    }
  }
  const ovNow = !!(tiled && tileGeom(c).overflow);
  for (const t of c.tabs) if (t.ov !== ovNow) { t.ov = ovNow; try { t.wc.send('tile-ov', ovNow); } catch {} }
  if (added) c.win.contentView.addChildView(c.ui); // UI doim tepada
  paintFrame(c, rects);
  applyMemoryPolicy(c);
}

/* ───────────── tablar ───────────── */
function applyZoom(tab) {
  try {
    const z = store.acc(aid(c, tab)).zoom[hostOf(tab.wc.getURL())] || 0;
    if (tab.wc.getZoomLevel() !== z) tab.wc.setZoomLevel(z);
  } catch {}
}
function setZoom(c, tab, level) {
  level = Math.max(-3, Math.min(5, level));
  tab.wc.setZoomLevel(level);
  const h = hostOf(tab.wc.getURL());
  if (h && !c.priv) { const z = store.acc(aid(c, tab)).zoom; if (level === 0) delete z[h]; else z[h] = level; store.save(); }
  pushState(c);
}
function stopFind(c) {
  const t = activeTab(c);
  if (t && !t.wc.isDestroyed()) { try { t.wc.stopFindInPage('clearSelection'); } catch {} }
}
function closeFindUi(c) {
  if (!c.findOpen) return;
  stopFind(c);
  c.findOpen = false;
  sendUi(c, 'find-hide');
  layout(c);
}
function focusAddress(c) {
  c.ui.webContents.focus();
  sendUi(c, 'focus-address');
}
function switchTab(c, id) {
  const t = getTab(c, id);
  if (!t) return;
  const old = activeTab(c);
  if (old && old !== t) closeFindUi(c);
  c.activeId = id;
  c.reveal = true;
  layout(c);
  if (t.homeBlank || display(t.wc.getURL()) === '') focusAddress(c); else t.wc.focus();
  pushState(c);
}
function createTab(c, url, o = {}) {
  // Har tab o'z account sessionida — bir oynada bir nechta Claude login
  const accId = c.priv ? null : (o.accountId || c.accountId || 'default');
  const acc = c.priv ? null : getAccount(accId);
  const ses = c.priv ? c.ses : sesForAccountId(acc.id, false);
  if (!c.priv) setupSession(ses, false, acc ? acc.id : "default");
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, session: ses, preload: paths.pagePreload, spellcheck: true, backgroundThrottling: true, v8CacheOptions: 'code', offscreen: false } });
  view.setBackgroundColor('#000000');
  const wc = view.webContents;
  try { wc.setUserAgent(CHROME_UA); } catch {}
  // url berilmasa — bosh sahifa yuklanadi, lekin omnibox BO'SH va fokusda (Chrome newtab uslubi)
  const isHomeStart = !url;
  const tab = { id: c.nextId++, view, wc, title: '', favicon: '', loading: false, pinned: !!o.pinned, audible: false, blocked: 0, accountId: acc ? acc.id : null, userMuted: typeof o.muted === 'boolean' ? o.muted : false, homeBlank: isHomeStart };
  let idx = c.tabs.length;
  if (o.after != null) { const i = c.tabs.findIndex((t) => t.id === o.after); if (i >= 0) idx = i + 1; }
  if (!tab.pinned) idx = Math.max(idx, c.tabs.filter((t) => t.pinned).length);
  c.tabs.splice(idx, 0, tab);
  tabByWc.set(wc.id, { ctx: c, tab });
  bindTab(c, tab);
  const r = url ? resolveInput(url) : null;
  loadWithUA(wc, r ? r.url : defaultPageUrl(acc ? acc.id : null));
  if (tab.userMuted) { try { wc.setAudioMuted(true); } catch {} }
  if (!o.background) switchTab(c, tab.id); else { layout(c); pushState(c); }
  return tab;
}
/** Tabni boshqa accountga ko'chirish (session o'zgarmasligi uchun qayta yaratiladi) */
function moveTabAccount(c, tabId, accountId) {
  if (c.priv) return;
  const t = getTab(c, tabId);
  if (!t) return;
  const acc = getAccount(accountId);
  if (t.accountId === acc.id) return;
  const url = display(t.wc.getURL()) || t.wc.getURL() || null;
  const pinned = t.pinned;
  const i = c.tabs.indexOf(t);
  const wasActive = t.id === c.activeId;
  // yopish (oxirgi tab bo'lsa yopmaslik)
  for (const p of [...perms.values()]) if (p.tab === t) { try { p.cb(false); } catch {} perms.delete(p.id); }
  try { c.win.contentView.removeChildView(t.view); } catch {}
  tabByWc.delete(t.wc.id);
  c.tabs.splice(i, 1);
  try { t.wc.close(); } catch {}
  c.accountId = acc.id;
  store.get().lastAccountId = acc.id;
  store.save();
  const nt = createTab(c, url && !String(url).startsWith('mrb://') ? url : null, { accountId: acc.id, pinned, background: !wasActive });
  // o'rniga qo'yish
  const ni = c.tabs.indexOf(nt);
  if (ni >= 0 && ni !== i) { c.tabs.splice(ni, 1); c.tabs.splice(Math.min(i, c.tabs.length), 0, nt); }
  if (wasActive) switchTab(c, nt.id); else { layout(c); pushState(c); }
}
function bindTab(c, tab) {
  const wc = tab.wc;
  const push = () => pushState(c);
  wc.on('will-navigate', (_e, url) => {
    try { wc.setUserAgent(uaForUrl(url)); } catch {}
  });
  wc.on('did-start-navigation', (_e, url, isInPlace, isMainFrame) => {
    if (isMainFrame) { try { wc.setUserAgent(uaForUrl(url)); } catch {} }
  });
  wc.setWindowOpenHandler(({ url, disposition }) => {
    const u = String(url || '');
    // Yangi tab / background tab
    if (disposition === 'foreground-tab' || disposition === 'background-tab' || disposition === 'default') {
      createTab(c, u || null, {
        after: tab.id,
        background: disposition === 'background-tab',
        accountId: tab.accountId || c.accountId,
      });
      return { action: 'deny' };
    }
    // Popup (Google account picker, OAuth, window.open) — PARENT SESSION shart
    // aks holda cookie yo'q, accounts menu loadingda qotadi
    let ses = null;
    try { ses = wc.session; } catch {}
    return {
      action: 'allow',
      outlivesOpener: true,
      overrideBrowserWindowOptions: {
        width: 520,
        height: 720,
        autoHideMenuBar: true,
        show: true,
        webPreferences: {
          session: ses || undefined,
          sandbox: true,
          contextIsolation: true,
          spellcheck: true,
          preload: paths.pagePreload,
        },
      },
    };
  });
  wc.on('did-create-window', (child, details) => {
    try {
      const cwc = child.webContents;
      cwc.setUserAgent(CHROME_UA);
      // OAuth popup navigatsiyasida ham to'liq Chrome UA
      cwc.on('will-navigate', (_e, navUrl) => {
        try { cwc.setUserAgent(CHROME_UA); } catch {}
      });
      cwc.on('did-start-navigation', (_e, navUrl, _ip, isMain) => {
        if (isMain) { try { cwc.setUserAgent(CHROME_UA); } catch {} }
      });
      // about:blank dan keyin accounts.google.com ga o'tganda ham
      if (details && details.url) {
        try { cwc.setUserAgent(CHROME_UA); } catch {}
      }
    } catch {}
  });
  wc.on('page-title-updated', (_e, t) => { tab.title = t; if (!c.priv) histUpdate(wc.getURL(), { title: t }, aid(c, tab)); push(); });
  wc.on('page-favicon-updated', (_e, f) => { tab.favicon = f[0] || ''; if (!c.priv) { const u = wc.getURL(); const aid_ = aid(c, tab); histUpdate(u, { icon: tab.favicon }, aid_); syncShortcutIcon(u, tab.favicon, aid_); } push(); });
  wc.on('did-start-loading', () => { tab.loading = true; push(); });
  wc.on('did-stop-loading', () => { tab.loading = false; push(); });
  wc.on('did-start-navigation', (d) => { if (d.isMainFrame && !d.isSameDocument) tab.blocked = 0; if (d.isMainFrame) push(); });
  wc.on('did-redirect-navigation', (d) => { if (d.isMainFrame) push(); });
  const refocusBlank = () => { if (tab.id === c.activeId && !wc.isDestroyed() && !c.win.isDestroyed() && (tab.homeBlank || display(wc.getURL()) === '')) { c.ui.webContents.focus(); sendUi(c, 'focus-address-soft'); } };
  wc.on('dom-ready', refocusBlank);
  wc.on('did-finish-load', () => { push(); refocusBlank(); });
  wc.on('did-frame-navigate', (_e, _u, _c, _s, _p, isMain) => { if (isMain) push(); });
  wc.on('did-navigate', (_e, url) => {
    if (!c.priv && /^https?:/i.test(url)) recordVisit(url, aid(c, tab));
    // Faqat foydalanuvchi boshqa sahifaga o'tganda (tarixda orqaga borish mumkin) omnibox URL ko'rsatiladi
    // Redirect (google.com → www.google.com) tarix qo'shmaydi — homeBlank saqlanadi
    if (tab.homeBlank) {
      try {
        if (wc.navigationHistory && wc.navigationHistory.canGoBack()) tab.homeBlank = false;
      } catch {
        try { if (wc.canGoBack && wc.canGoBack()) tab.homeBlank = false; } catch {}
      }
    }
    // Google "browser not secure" rejected → soddalashtirilgan kirishga qayta urinish
    if (/accounts\.google\.com\/.*(signin\/rejected|v3\/signin\/rejected)/i.test(url) && !tab._gRetry) {
      tab._gRetry = true;
      const next = 'https://accounts.google.com/AddSession?hl=en&continue=https%3A%2F%2Fmyaccount.google.com%2F&ec=asw-chrome&flowName=GlifWebSignIn&flowEntry=AddSession';
      setTimeout(() => loadWithUA(wc, next), 350);
    }
    applyZoom(tab); push();
  });
  wc.on('did-navigate-in-page', (_e, url, isMain) => {
    if (isMain && !c.priv && /^https?:/i.test(url)) recordVisit(url, aid(c, tab));
    push();
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    const up = upgrades.get(url);
    if (up) { upgrades.delete(url); noUpgrade.add(hostOf(up)); wc.loadURL(up).catch(() => {}); return; }
    if (code === -310 && url.startsWith('http:')) { noUpgrade.add(hostOf(url)); wc.loadURL(url).catch(() => {}); return; }
    wc.loadURL('mrb://error/?code=' + code + '&desc=' + encodeURIComponent(desc) + '&url=' + encodeURIComponent(url)).catch(() => {});
  });
  wc.on('found-in-page', (_e, r) => { if (tab.id === c.activeId) sendUi(c, 'find-result', { active: r.activeMatchOrdinal, matches: r.matches }); });
  const aud = () => { tab.audible = !wc.isDestroyed() && wc.isCurrentlyAudible(); push(); };
  wc.on('audio-state-changed', aud); wc.on('media-started-playing', aud); wc.on('media-paused', aud);
  wc.on('zoom-changed', (_e, dir) => setZoom(c, tab, wc.getZoomLevel() + (dir === 'in' ? 0.5 : -0.5)));
  wc.on('enter-html-full-screen', () => { if (tab.id === c.activeId && !c.tabFs) { c.htmlFs = true; c.win.setFullScreen(true); layout(c); } });
  wc.on('leave-html-full-screen', () => { if (c.htmlFs && !c.tabFs) { c.htmlFs = false; c.win.setFullScreen(false); layout(c); } });
  wc.on('before-input-event', (e, i) => handleKey(c, e, i));
  wc.on('context-menu', (_e, p) => pageMenu(c, tab, p));
  wc.on('destroyed', () => { tabByWc.delete(wc.id); });
}

/** Faol bo'lmagan tablarni throttle — RAM/CPU tejamkor (ovozga tegmaydi) */
function applyMemoryPolicy(c) {
  if (!c || c.win.isDestroyed()) return;
  for (const t of c.tabs) {
    if (!t.wc || t.wc.isDestroyed()) continue;
    const active = t.id === c.activeId;
    try { t.wc.setBackgroundThrottling(!active); } catch {}
    // Foydalanuvchi mute holatini hurmat qilish — avtomatik mute YO'Q
    if (typeof t.userMuted === 'boolean') {
      try { t.wc.setAudioMuted(t.userMuted); } catch {}
    }
  }
}
function closeTab(c, id) {
  const i = c.tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const t = c.tabs[i];
  const raw = (!t.wc.isDestroyed() && t.wc.getURL()) || '';
  // Oxirgi tab → oyna yopiladi; oxirgi oyna bo'lsa ilova ham (window-all-closed)
  if (c.tabs.length === 1) {
    if (raw && !/^mrb:\/\/(newtab|dashboard)/.test(raw)) {
      c.closed.push({ url: display(raw) || raw, pinned: t.pinned });
      if (c.closed.length > 25) c.closed.shift();
    }
    for (const p of [...perms.values()]) if (p.tab === t) { try { p.cb(false); } catch {} perms.delete(p.id); }
    try { c.win.contentView.removeChildView(t.view); } catch {}
    tabByWc.delete(t.wc.id);
    c.tabs.splice(i, 1); // bo'sh — onWinClose lastSession=null qiladi
    try { t.wc.close(); } catch {}
    c.activeId = null;
    try { c.win.close(); } catch {}
    return;
  }
  if (raw && !/^mrb:\/\/(newtab|dashboard)/.test(raw)) {
    c.closed.push({ url: display(raw) || raw, pinned: t.pinned });
    if (c.closed.length > 25) c.closed.shift();
  }
  const wasActive = t.id === c.activeId;
  for (const p of [...perms.values()]) if (p.tab === t) { try { p.cb(false); } catch {} perms.delete(p.id); }
  try { c.win.contentView.removeChildView(t.view); } catch {}
  tabByWc.delete(t.wc.id);
  c.tabs.splice(i, 1);
  try { t.wc.close(); } catch {}
  if (wasActive) { c.activeId = null; switchTab(c, c.tabs[Math.min(i, c.tabs.length - 1)].id); } else { layout(c); pushState(c); }
}
function reopenTab(c) {
  const r = c.closed.pop();
  if (r) createTab(c, r.url, { pinned: r.pinned });
}
function moveTab(c, id, to) {
  const i = c.tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  const t = c.tabs[i];
  const np = c.tabs.filter((x) => x.pinned).length;
  to = Math.max(0, Math.min(c.tabs.length - 1, to));
  to = t.pinned ? Math.min(to, np - 1) : Math.max(to, np);
  c.tabs.splice(i, 1);
  c.tabs.splice(to, 0, t);
  layout(c);
  pushState(c);
}
function pinTab(c, id) {
  const t = getTab(c, id);
  if (!t) return;
  t.pinned = !t.pinned;
  const np = c.tabs.filter((x) => x.pinned).length;
  moveTab(c, id, t.pinned ? np - 1 : np);
  pushState(c);
}
function muteTab(c, id) {
  const t = getTab(c, id);
  if (!t || t.wc.isDestroyed()) return;
  const next = !t.wc.isAudioMuted();
  t.userMuted = next; // foydalanuvchi tanlovi — avtomatik o'zgarmaydi
  try { t.wc.setAudioMuted(next); } catch {}
  pushState(c);
}
function cycleTab(c, dir) {
  if (c.tabs.length < 2) return;
  const i = c.tabs.findIndex((t) => t.id === c.activeId);
  switchTab(c, c.tabs[(i + dir + c.tabs.length) % c.tabs.length].id);
}
function openInternal(c, name, hash) {
  const base = 'mrb://' + name + '/';
  const ex = c.tabs.find((t) => t.wc.getURL().startsWith(base));
  const url = base + (hash ? '#' + hash : '');
  if (ex) { if (hash) ex.wc.loadURL(url).catch(() => {}); switchTab(c, ex.id); return; }
  const t = activeTab(c);
  if (t && blankRaw(t.wc.getURL())) { t.wc.loadURL(url).catch(() => {}); t.wc.focus(); } else createTab(c, url, { after: c.activeId });
}

/* ───────────── buyruqlar ───────────── */
function toggleBookmark(c) {
  const t = activeTab(c);
  if (!t) return;
  const url = display(t.wc.getURL());
  if (!url || url.startsWith('mrb:')) return;
  const A = store.acc(aid(c, t));
  const i = A.bookmarks.findIndex((b) => b.url === url);
  if (i >= 0) A.bookmarks.splice(i, 1);
  else A.bookmarks.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title: t.title || hostOf(url) || url, url, icon: t.favicon, ts: Date.now() });
  store.save(); pushAll(); broadcastPages('bookmarks');
}
function toggleFullscreen(c) { c.win.setFullScreen(!c.win.isFullScreen()); }
// Win+Shift+F: faol tab oyna ichida to'liq maydonni egallaydi (panel va boshqa tablar yashiriladi).
// Oynaning o'zi (ekran/oyna o'lchami) o'zgarmaydi.
function toggleTabFullscreen(c) {
  const t = activeTab(c);
  if (!t || c.win.isDestroyed()) return;
  c.tabFs = !c.tabFs;
  c.htmlFs = c.tabFs;
  layout(c); pushState(c);
  if (c.tabFs) t.wc.focus();
}
function runCmd(c, name, arg) {
  const t = activeTab(c);
  const wc = t && t.wc;
  switch (name) {
    case 'newtab': return createTab(c, null);
    case 'newwindow': return createWindow({ accountId: c.accountId || 'default' });
    case 'private': return createWindow({ private: true });
    case 'account-open': {
      // Bir oynada account almashish — yangi oyna ochilmaydi
      if (c.priv) return;
      const id = arg || 'default';
      const acc = getAccount(id);
      c.accountId = acc.id;
      c.account = acc;
      store.get().lastAccountId = acc.id;
      store.save();
      // Faol tab boshqa account bo'lsa — yangi tab ochamiz (eski loginlar saqlanadi)
      const t = activeTab(c);
      if (!t || t.accountId !== acc.id) createTab(c, null, { accountId: acc.id });
      else pushState(c);
      return;
    }
    case 'account-new': {
      if (c.priv) return;
      const acc = createAccount(arg);
      c.accountId = acc.id;
      c.account = acc;
      store.get().lastAccountId = acc.id;
      store.save();
      createTab(c, null, { accountId: acc.id });
      return;
    }
    case 'account-tab': {
      // Faqat faol accountni o'zgartirish (yangi tab ochmasdan)
      if (c.priv) return;
      const acc = getAccount(arg || 'default');
      c.accountId = acc.id;
      c.account = acc;
      store.get().lastAccountId = acc.id;
      store.save();
      pushState(c);
      return;
    }
    case 'reopen': return reopenTab(c);
    case 'dashboard': return openInternal(c, 'dashboard');
    case 'history': return openInternal(c, 'history');
    case 'downloads': return openInternal(c, 'downloads');
    case 'bookmarks': return openInternal(c, 'bookmarks');
    case 'settings': return openInternal(c, 'settings', arg);
    case 'bookmark-toggle': return toggleBookmark(c);
    case 'bar-toggle': return applySettings({ bookmarksBar: !store.get().settings.bookmarksBar });
    case 'tile-toggle': return applySettings({ tile: !store.get().settings.tile });
    case 'print': {
      if (!wc || wc.isDestroyed()) return;
      // Electron Linux: wc.print() dialog ko'pincha chiqmaydi — window.print() ishonchliroq
      try {
        wc.focus();
        wc.executeJavaScript('window.print()', true).catch(() => {
          try { wc.print({ silent: false, printBackground: true }); } catch {}
        });
      } catch {
        try { wc.print({ silent: false, printBackground: true }); } catch {}
      }
      return;
    }
    case 'viewsource': { const u = wc && wc.getURL(); return u && /^https?:/.test(u) && createTab(c, 'view-source:' + u, { after: t.id }); }
    case 'devtools': return wc && wc.toggleDevTools();
    case 'fullscreen': return toggleFullscreen(c);
    case 'zoomin': return t && setZoom(c, t, wc.getZoomLevel() + 0.5);
    case 'zoomout': return t && setZoom(c, t, wc.getZoomLevel() - 0.5);
    case 'zoomreset': return t && setZoom(c, t, 0);
    case 'find': return sendUi(c, 'find-open');
    case 'closewin': return c.win.close();
    case 'quit': return app.quit();
    case 'home': {
      if (!wc || !t) return;
      t.homeBlank = true;
      loadWithUA(wc, defaultPageUrl(aid(c, t)));
      focusAddress(c);
      pushState(c);
      return;
    }
  }
}
function handleKey(c, e, i) {
  if (i.type !== 'keyDown') return;
  // Ushlab turish (key repeat) — shortcutlar loop bo'lmasin; faqat alohida bosish
  if (i.isAutoRepeat) return;
  const ctrl = i.control || i.meta;
  const shift = i.shift;
  const alt = i.alt;
  const k = i.key.toLowerCase();
  const t = activeTab(c);
  const wc = t && t.wc;
  const go = (f) => { e.preventDefault(); f(); };
  if (i.meta && !i.control && !alt && shift && k === 'f') return go(() => toggleTabFullscreen(c));
  if (c.tabFs && k === 'escape' && !ctrl && !alt) toggleTabFullscreen(c);
  if (ctrl && !alt) {
    if (k === 't') return go(() => (shift ? reopenTab(c) : createTab(c, null)));
    if (k === 'w' && !shift) return go(() => t && closeTab(c, t.id));
    if (k === 'w' && shift) return go(() => c.win.close());
    if (k === 'f4') return go(() => t && closeTab(c, t.id));
    if (k === 'n') return go(() => createWindow({ private: shift }));
    if (k === 'q') return go(() => c.win.close());
    if (k === '\\') return go(() => runCmd(c, 'tile-toggle'));
    if (k === 'l') return go(() => focusAddress(c));
    if (k === 'r') return go(() => wc && (shift ? wc.reloadIgnoringCache() : wc.reload()));
    if (k === 'tab') return go(() => cycleTab(c, shift ? -1 : 1));
    if (k === 'pagedown') return go(() => (shift && t ? moveTab(c, t.id, c.tabs.indexOf(t) + 1) : cycleTab(c, 1)));
    if (k === 'pageup') return go(() => (shift && t ? moveTab(c, t.id, c.tabs.indexOf(t) - 1) : cycleTab(c, -1)));
    if (!shift && /^[1-9]$/.test(k)) return go(() => { const n = Number(k); const x = n === 9 ? c.tabs[c.tabs.length - 1] : c.tabs[n - 1]; if (x) switchTab(c, x.id); });
    if (k === '=' || k === '+') return go(() => runCmd(c, 'zoomin'));
    if (k === '-' || k === '_') return go(() => runCmd(c, 'zoomout'));
    if (k === '0') return go(() => runCmd(c, 'zoomreset'));
    if (k === 'd' && !shift) return go(() => toggleBookmark(c));
    if (k === 'f' && !shift) return go(() => runCmd(c, 'find'));
    if (k === 'g') return go(() => sendUi(c, 'find-next', shift ? -1 : 1));
    if (k === 'h' && !shift) return go(() => runCmd(c, 'history'));
    if (k === 'j' && !shift) return go(() => runCmd(c, 'downloads'));
    if (k === 'o' && shift) return go(() => runCmd(c, 'bookmarks'));
    if (k === 'b' && shift) return go(() => runCmd(c, 'bar-toggle'));
    if (k === 'p' && !shift) return go(() => runCmd(c, 'print'));
    if (k === 'u' && !shift) return go(() => runCmd(c, 'viewsource'));
    if (k === 'i' && shift) return go(() => runCmd(c, 'devtools'));
    if (k === 'delete' && shift) return go(() => runCmd(c, 'settings', 'clear'));
    // Chrome: Ctrl+, — settings
    if (k === ',' && !shift) return go(() => runCmd(c, 'settings'));
    // Chrome: Ctrl+E / Ctrl+K — focus omnibox (search)
    if ((k === 'e' || k === 'k') && !shift) return go(() => focusAddress(c));
    // Chrome: Ctrl+S — save page
    if (k === 's' && !shift) return go(() => { try { wc && wc.downloadURL(wc.getURL()); } catch {} });
    // MR: Ctrl+Shift+A — accounts popup
    if (k === 'a' && shift) return go(() => sendUi(c, 'open-overlay', 'account'));
    // MR: Ctrl+Shift+S — shields popup
    if (k === 's' && shift) return go(() => sendUi(c, 'open-overlay', 'shield'));
  }
  if (alt && !ctrl) {
    if (k === 'arrowleft') return go(() => wc && wc.navigationHistory.goBack());
    if (k === 'arrowright') return go(() => wc && wc.navigationHistory.goForward());
    if (k === 'home') return go(() => runCmd(c, 'home'));
    if (k === 'd') return go(() => focusAddress(c));
    // Chrome: Alt+Enter — open omnibox in new tab is UI-side; Alt+F4 close window already OS
  }
  if (!ctrl && !alt) {
    if (k === 'f5') return go(() => wc && (shift ? wc.reloadIgnoringCache() : wc.reload()));
    if (k === 'f6') return go(() => focusAddress(c));
    if (k === 'f11') return go(() => toggleFullscreen(c));
    if (k === 'f12') return go(() => runCmd(c, 'devtools'));
    if (k === 'f3') return go(() => sendUi(c, 'find-next', shift ? -1 : 1));
    // Escape — stop loading
    if (k === 'escape' && wc && !c.tabFs) {
      try { if (wc.isLoading()) { e.preventDefault(); wc.stop(); } } catch {}
    }
  }
}

/* ───────────── kontekst menyular (custom, very dark) ───────────── */
function popup(c, tpl, pos) {
  const items = [];
  const actions = {};
  let n = 0;
  for (const it of tpl) {
    if (!it) continue;
    if (it.type === 'separator') { items.push({ t: 's' }); continue; }
    const id = 'm' + (++n);
    items.push({ t: 'i', id, label: it.label || '', en: it.enabled !== false, k: it.accelerator || it.k || '' });
    actions[id] = it;
  }
  if (!items.length) return;
  c._ctxActions = actions;
  c._ctxWc = (activeTab(c) && activeTab(c).wc) || null;
  const x = pos && pos.x != null ? Math.round(pos.x) : 80;
  const y = pos && pos.y != null ? Math.round(pos.y) : 80;
  // overlay uchun UI to'liq oynani qoplashi kerak
  c.overlay = true;
  layout(c);
  sendUi(c, 'ctx-menu', { items, x, y });
}
function runCtxRole(wc, role) {
  if (!wc || wc.isDestroyed()) return;
  try {
    if (role === 'cut') wc.cut();
    else if (role === 'copy') wc.copy();
    else if (role === 'paste') wc.paste();
    else if (role === 'selectAll') wc.selectAll();
    else if (role === 'undo') wc.undo();
    else if (role === 'redo') wc.redo();
  } catch {}
}
function pageMenu(c, tab, p) {
  const wc = tab.wc;
  if (wc.getURL().startsWith('mrb://') && !p.isEditable && !p.selectionText) return;
  const sep = { type: 'separator' };
  const T = [];
  if (p.misspelledWord) {
    for (const s of (p.dictionarySuggestions || []).slice(0, 5)) T.push({ label: s, click: () => wc.replaceMisspelling(s) });
    if (T.length) T.push(sep);
  }
  if (p.linkURL) {
    T.push({ label: tt('open_new_tab'), click: () => createTab(c, p.linkURL, { after: tab.id, background: true }) },
      { label: tt('open_new_window'), click: () => createWindow({ url: p.linkURL, private: c.priv, accountId: c.accountId }) },
      { label: tt('copy_url'), click: () => clipboard.writeText(p.linkURL) },
      { label: tt('url_to_omnibox'), click: () => { focusAddress(c); sendUi(c, 'focus-address'); } }, sep);
  }
  if (p.mediaType === 'image' && p.srcURL) {
    T.push({ label: tt('open_image_tab'), click: () => createTab(c, p.srcURL, { after: tab.id }) },
      { label: tt('copy_image_url'), click: () => clipboard.writeText(p.srcURL) },
      { label: tt('save_image'), click: () => wc.downloadURL(p.srcURL) }, sep);
  }
  if (p.isEditable) {
    const f = p.editFlags || {};
    T.push({ label: tt('cut'), role: 'cut', enabled: f.canCut, k: 'Ctrl+X' }, { label: tt('copy'), role: 'copy', enabled: f.canCopy, k: 'Ctrl+C' },
      { label: tt('paste'), role: 'paste', enabled: f.canPaste, k: 'Ctrl+V' }, { label: tt('select_all'), role: 'selectAll', k: 'Ctrl+A' }, sep);
  } else if (p.selectionText) {
    const sel = p.selectionText.trim();
    T.push({ label: tt('copy'), role: 'copy', k: 'Ctrl+C' },
      { label: tt('search_sel') + ': ' + sel.slice(0, 28) + (sel.length > 28 ? '…' : ''), click: () => createTab(c, searchUrl(sel), { after: tab.id }) },
      { label: tt('copy_raw'), click: () => clipboard.writeText(sel) }, sep);
  }
  if (!p.linkURL && !p.selectionText && !p.isEditable && p.mediaType === 'none') {
    const nav = wc.navigationHistory;
    const pageUrl = display(wc.getURL()) || wc.getURL();
    T.push({ label: tt('back'), enabled: nav.canGoBack(), click: () => nav.goBack(), k: 'Alt+←' },
      { label: tt('forward'), enabled: nav.canGoForward(), click: () => nav.goForward(), k: 'Alt+→' },
      { label: tt('reload'), click: () => wc.reload(), k: 'Ctrl+R' },
      { label: tt('hard_reload'), click: () => wc.reloadIgnoringCache(), k: 'Ctrl+Shift+R' }, sep,
      { label: tt('copy_page_url'), click: () => clipboard.writeText(pageUrl) },
      { label: tt('bookmark_add'), click: () => toggleBookmark(c), k: 'Ctrl+D' },
      { label: tt('print'), click: () => runCmd(c, 'print'), k: 'Ctrl+P' },
      { label: tt('view_source'), click: () => runCmd(c, 'viewsource'), k: 'Ctrl+U' }, sep);
  }
  T.push({ label: tt('inspect'), click: () => wc.inspectElement(p.x, p.y), k: 'Ctrl+Shift+I' });
  let bx = 0, by = 0;
  try { const b = tab.view.getBounds(); bx = b.x + (p.x || 0); by = b.y + (p.y || 0); } catch { bx = p.x || 100; by = (p.y || 100) + chromeH(c); }
  c._ctxWc = wc;
  popup(c, T, { x: bx, y: by });
}

/* ───────────── oynalar ───────────── */
function onWinClose(c) {
  if (c.priv) return;
  const d = store.get();
  if (!c.win.isMaximized() && !c.win.isFullScreen()) { const [w, h] = c.win.getSize(); d.win = { width: w, height: h }; }
  // Tablar holatini saqlash — keyingi ochilishda davom etish uchun
  const tabs = [];
  let activeIdx = 0;
  c.tabs.forEach((t, i) => {
    if (t.wc.isDestroyed()) return;
    const raw = t.wc.getURL() || '';
    // Bo'sh dashboard tabni saqlamaymiz
    if (/^mrb:\/\/(newtab|dashboard)/.test(raw) && c.tabs.length === 1) return;
    const url = display(raw) || raw;
    if (!url || url === 'about:blank') return;
    if (t.id === c.activeId) activeIdx = tabs.length;
    tabs.push({ url, pinned: !!t.pinned, accountId: t.accountId || c.accountId || 'default', muted: typeof t.userMuted === 'boolean' ? t.userMuted : (t.wc.isAudioMuted && t.wc.isAudioMuted()) });
  });
  store.acc(c.accountId).lastSession = tabs.length ? { tabs, active: activeIdx } : null;
  if (c.accountId) d.lastAccountId = c.accountId;
  store.save();
}
function createWindow(opts = {}) {
  const { ses, priv, accountId, account } = sessionForOpts(opts);
  setupSession(ses, priv, opts.accountId || "default");
  if (!priv && accountId) {
    store.get().lastAccountId = accountId;
    store.save();
  }
  const d = store.get();
  const title = priv ? tt('win_private') : (account && account.id !== 'default' ? (tt('win_title') + ' — ' + account.name) : tt('win_title'));
  const win = new BrowserWindow({
    width: priv ? 1100 : d.win.width, height: priv ? 720 : d.win.height, minWidth: 480, minHeight: 360,
    frame: false, show: false, title, icon: paths.icon,
    backgroundColor: '#000000', webPreferences: { sandbox: true, preload: paths.framePreload },
  });
  const ui = new WebContentsView({ webPreferences: { preload: paths.uiPreload, sandbox: true, contextIsolation: true } });
  ui.setBackgroundColor('#00000000');
  const c = { win, ui, ses, priv, accountId: accountId || null, account: account || null, tabs: [], activeId: null, nextId: 1, overlay: false, findOpen: false, htmlFs: false, closed: [], pushT: null, ready: false, frameReady: false, frameRects: [], frameBar: null, scrollX: 0, reveal: false };
  const uiId = ui.webContents.id;
  ctxs.add(c); ctxByUi.set(uiId, c); lastCtx = c;
  win.contentView.addChildView(ui);
  win.webContents.once('did-finish-load', () => { c.frameReady = true; paintFrame(c, c.frameRects); });
  win.loadFile(paths.frameHtml).catch(() => {});
  ui.webContents.on('before-input-event', (e, i) => handleKey(c, e, i));
  win.on('focus', () => { lastCtx = c; });
  win.on('resize', () => layout(c));
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, () => { layout(c); pushState(c); });
  win.on('close', () => onWinClose(c));
  win.on('closed', () => {
    ctxs.delete(c); ctxByUi.delete(uiId);
    if (lastCtx === c) lastCtx = [...ctxs][0] || null;
    for (const p of [...perms.values()]) if (p.ctx === c) { try { p.cb(false); } catch {} perms.delete(p.id); }
    for (const t of c.tabs) { tabByWc.delete(t.wc.id); try { t.wc.close(); } catch {} }
    try { ui.webContents.close(); } catch {}
  });
  ui.webContents.once('did-finish-load', () => {
    c.ready = true;
    if (opts.url) createTab(c, opts.url);
    else if (opts.restore && opts.restore.tabs && opts.restore.tabs.length) {
      for (const r of opts.restore.tabs) createTab(c, r.url, { background: true, pinned: r.pinned, accountId: r.accountId || opts.accountId || 'default', muted: !!r.muted });
      const a = c.tabs[Math.min(opts.restore.active || 0, c.tabs.length - 1)] || c.tabs[0];
      switchTab(c, a.id);
    } else createTab(c, null);
    layout(c);
    win.show();
    // Ishga tushganda tab bo'sh (dashboard) bo'lsa -- manzil qatori avtomatik faol bo'lsin.
    // Oyna ko'ringandan keyin fokus yo'qolmasligi uchun bir necha marta (yumshoq) qayta uriniladi.
    const fa = () => {
      const t = activeTab(c);
      if (win.isDestroyed() || !t || t.wc.isDestroyed() || display(t.wc.getURL()) !== '') return;
      try { win.focus(); c.ui.webContents.focus(); } catch {}
      sendUi(c, 'focus-address-soft');
    };
    fa(); setTimeout(fa, 120); setTimeout(fa, 400); setTimeout(fa, 900);
  });
  ui.webContents.loadFile(paths.uiHtml);
  return c;
}

/* ───────────── sozlamalar ───────────── */
const SETTING_TYPES = { engine: 'string', theme: 'string', language: 'string', startup: 'string', homepage: 'string', bookmarksBar: 'boolean', tile: 'boolean', tileBorder: 'boolean', suggest: 'boolean', httpsUpgrade: 'boolean', shields: 'boolean' };
function resolvedTheme() {
  const t = store.get().settings.theme || 'system';
  if (t === 'light') return 'light';
  if (t === 'dark') return 'dark';
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}
function applyThemeSource() {
  const t = store.get().settings.theme || 'system';
  nativeTheme.themeSource = t === 'system' ? 'system' : t;
}
function lang() { return i18n.norm(store.get().settings.language); }
function tt(key) { return i18n.t(lang(), key); }
function applySettings(patch, accountId) {
  const s = store.get().settings;
  const A = store.acc(accountId);
  for (const [k, v] of Object.entries(patch || {})) {
    if (typeof v !== SETTING_TYPES[k]) continue;
    if (k === 'engine' && !ENGINES[v]) continue;
    if (k === 'theme' && !['system', 'dark', 'light'].includes(v)) continue;
    if (k === 'language' && !['uz', 'en', 'ru'].includes(v)) continue;
    if (k === 'startup' && !['newtab', 'restore'].includes(v)) continue;
    // Account-only sozlamalar
    if (k === 'homepage') {
      const nh = normalizeHomepage(v);
      if (nh === null) continue;
      A.homepage = nh;
      continue;
    }
    if (k === 'engine') { A.engine = v; continue; }
    s[k] = v;
  }
  applyThemeSource();
  try { session.defaultSession.setUserAgent(CHROME_UA); } catch {}
  store.save();
  for (const c of ctxs) layout(c);
  pushAll(); broadcastPages('settings');
}
async function clearData(o) {
  const ses = session.defaultSession;
  const d = store.get();
  if (o.cookies) await ses.clearStorageData();
  if (o.cache) { await ses.clearCache(); await ses.clearAuthCache(); }
  if (o.history) { store.acc().history = []; }
  if (o.downloads) { for (let i = dls.length - 1; i >= 0; i--) if (!dlItems.has(dls[i].id)) dls.splice(i, 1); dlBroadcast(true); }
  store.save(); broadcastPages('history'); broadcastPages('settings'); broadcastPages('bookmarks'); broadcastPages('downloads'); pushAll();
}

/* ───────────── IPC ───────────── */
function registerIpc() {
  const on = (n, f) => ipcMain.on('ui:' + n, (e, ...a) => { const c = ctxByUi.get(e.sender.id); if (c) f(c, ...a); });
  const handle = (n, f) => ipcMain.handle('ui:' + n, (e, ...a) => { const c = ctxByUi.get(e.sender.id); return c ? f(c, ...a) : null; });

  ipcMain.on('frame:size', (e, w, h) => {
    if (!(w > 0 && h > 0)) return;
    for (const c of ctxs) {
      if (c.win.isDestroyed() || c.win.webContents.id !== e.sender.id) continue;
      c.size = { w: Math.round(w), h: Math.round(h) };
      layout(c);
    }
  });
  ipcMain.on('pane:focus', (e) => {
    const r = tabByWc.get(e.sender.id);
    if (r) sendUi(r.ctx, 'page-focused');
    if (!r || r.tab.id === r.ctx.activeId) return;
    closeFindUi(r.ctx);
    r.ctx.activeId = r.tab.id;
    r.ctx.reveal = true;
    layout(r.ctx); pushState(r.ctx);
  });
  ipcMain.on('frame:scroll', (e, kind, v) => {
    for (const c of ctxs) if (!c.win.isDestroyed() && c.win.webContents.id === e.sender.id) hscroll(c, kind, v);
  });
  ipcMain.on('frame:resize', (e, id, w) => {
    for (const c of ctxs) if (!c.win.isDestroyed() && c.win.webContents.id === e.sender.id) resizeTab(c, id, w);
  });
  ipcMain.on('frame:resetw', (e) => {
    for (const c of ctxs) if (!c.win.isDestroyed() && c.win.webContents.id === e.sender.id) resetWidths(c);
  });
  ipcMain.on('pane:hscroll', (e, dx) => { const r = tabByWc.get(e.sender.id); if (r) hscroll(r.ctx, 'delta', dx); });
  ipcMain.on('pane:ov', (e) => {
    const r = tabByWc.get(e.sender.id);
    e.returnValue = !!(r && store.get().settings.tile && !r.ctx.htmlFs && tileGeom(r.ctx).overflow);
  });
  on('new-tab', (c) => createTab(c, null));
  on('close-tab', (c, id) => closeTab(c, id));
  on('switch-tab', (c, id) => switchTab(c, id));
  on('move-tab', (c, id, to) => moveTab(c, id, to));
  on('mute-tab', (c, id) => muteTab(c, id));
  on('navigate', (c, text) => {
    const r = resolveInput(text), t = activeTab(c);
    if (r && t) { loadWithUA(t.wc, r.url); t.wc.focus(); }
  });
  on('open-url', (c, url, newTab) => { const t = activeTab(c); if (newTab || !t) createTab(c, url, { after: c.activeId }); else { t.homeBlank = false; loadWithUA(t.wc, url); t.wc.focus(); pushState(c); } });
  on('back', (c) => { const t = activeTab(c); if (t) t.wc.navigationHistory.goBack(); });
  on('forward', (c) => { const t = activeTab(c); if (t) t.wc.navigationHistory.goForward(); });
  on('reload', (c, hard) => { const t = activeTab(c); if (t) (hard ? t.wc.reloadIgnoringCache() : t.wc.reload()); });
  on('stop', (c) => { const t = activeTab(c); if (t) t.wc.stop(); });
  on('focus-page', (c) => { const t = activeTab(c); if (t) t.wc.focus(); });
  on('overlay', (c, open, focusPage) => {
    c.overlay = !!open; layout(c);
    if (open) return;
    if (focusPage) { const t = activeTab(c); if (t) t.wc.focus(); }
  });
  on('cmd', (c, name, arg) => runCmd(c, name, arg));
  on('find', (c, text, o) => {
    const t = activeTab(c);
    if (!t) return;
    if (!text) { stopFind(c); sendUi(c, 'find-result', { active: 0, matches: 0 }); return; }
    t.wc.findInPage(text, { forward: !o || o.forward !== false, findNext: !!(o && o.findNext) });
  });
  on('find-close', (c) => { stopFind(c); });
  on('find-visible', (c, v) => { c.findOpen = !!v; layout(c); });
  
  on('dl-action', (_c, id, act) => dlAction(id, act));
  on('perm-answer', (c, id, allow, remember) => {
    const p = perms.get(id);
    if (!p) return;
    try { p.cb(!!allow); } catch {}
    perms.delete(id);
    if (remember && !p.priv) {
      const A = store.acc(p.tab ? p.tab.accountId : null);
      (A.permissions[p.origin] = A.permissions[p.origin] || {})[p.perm] = !!allow;
      store.save();
    }
    pushState(c);
  });
  on('shield-toggle', (c) => {
    const t = activeTab(c);
    const h = t && hostOf(t.wc.getURL());
    if (!h) return;
    const A = store.acc(aid(c, t));
    const i = A.shieldsOff.indexOf(h);
    if (i >= 0) A.shieldsOff.splice(i, 1); else A.shieldsOff.push(h);
    store.save(); t.wc.reload(); pushAll(); broadcastPages('settings');
  });
  on('tab-menu', (c, id, x, y) => {
    const t = getTab(c, id);
    if (!t) return;
    const i = c.tabs.indexOf(t);
    const url = display(t.wc.getURL()) || '';
    popup(c, [
      { label: tt('new_tab'), click: () => createTab(c, null, { after: id }), k: 'Ctrl+T' }, { type: 'separator' },
      { label: tt('reload'), click: () => t.wc.reload(), k: 'Ctrl+R' },
      { label: tt('duplicate_tab'), click: () => createTab(c, url || null, { after: id }) },
      { label: url ? 'URL nusxalash' : 'URL nusxalash', enabled: !!url, click: () => clipboard.writeText(url) },
      { label: t.pinned ? tt('unpin_tab') : tt('pin_tab'), click: () => pinTab(c, id) },
      ...(c.priv ? [] : listAccounts().filter((a) => a.id !== (t.accountId || c.accountId)).map((a) => ({
        label: '→ ' + a.name, click: () => moveTabAccount(c, id, a.id),
      }))),
      { label: t.wc.isAudioMuted() ? tt('unmute') : tt('mute'), click: () => muteTab(c, id) }, { type: 'separator' },
      { label: tt('close_tab'), click: () => closeTab(c, id), k: 'Ctrl+W' },
      { label: tt('close_other'), enabled: c.tabs.length > 1, click: () => { for (const x of [...c.tabs]) if (x.id !== id && !x.pinned) closeTab(c, x.id); } },
      { label: tt('close_right'), enabled: i < c.tabs.length - 1, click: () => { for (const x of c.tabs.slice(i + 1)) closeTab(c, x.id); } },
      { label: tt('reopen_tab'), enabled: c.closed.length > 0, click: () => reopenTab(c), k: 'Ctrl+Shift+T' },
    ], { x: x || 80, y: y || 40 });
  });
  on('bm-menu', (c, id, x, y) => {
    const b = store.acc().bookmarks.find((x) => x.id === id);
    if (!b) return;
    popup(c, [
      { label: tt('open'), click: () => { const t = activeTab(c); if (t) t.wc.loadURL(b.url).catch(() => {}); } },
      { label: tt('open_new_tab'), click: () => createTab(c, b.url, { after: c.activeId }) },
      { label: tt('open_new_window'), click: () => createWindow({ url: b.url, private: c.priv, accountId: c.accountId }) },
      { label: tt('copy_url'), click: () => clipboard.writeText(b.url) }, { type: 'separator' },
      { label: tt('delete'), click: () => { const A = store.acc(); A.bookmarks = A.bookmarks.filter((x) => x.id !== id); store.save(); pushAll(); broadcastPages('bookmarks'); } },
    ], { x: x || 80, y: y || 80 });
  });
  on('ctx-pick', (c, id) => {
    const it = c._ctxActions && c._ctxActions[id];
    c._ctxActions = null;
    c.overlay = false;
    layout(c);
    if (!it || it.enabled === false) return;
    if (it.role) runCtxRole(c._ctxWc || (activeTab(c) && activeTab(c).wc), it.role);
    else if (typeof it.click === 'function') try { it.click(); } catch (e) { console.error('[ctx]', e); }
  });
  handle('suggest', (c, text) => ({ kind: (resolveInput(text) || {}).kind || 'search', items: localSuggest(text, aid(c)) }));
  handle('autocomplete', (c, text) => autoComplete(text, aid(c)));
  handle('suggest-web', (_c, text) => webSuggest(text));
  handle('downloads', () => dlList());
  handle('accounts:list', (c) => ({ accounts: listAccounts(), current: c.accountId || (c.priv ? null : 'default') }));
  handle('account-info', (_c, id) => {
    const a = getAccount(id || 'default');
    const A = store.acc(a.id);
    return {
      id: a.id, name: a.name, color: a.color || ACC_COLORS[0],
      history: (A.history || []).length,
      bookmarks: (A.bookmarks || []).length,
      shortcuts: (A.shortcuts || []).length,
      permissions: Object.keys(A.permissions || {}).length,
      zoom: Object.keys(A.zoom || {}).length,
      shieldsOff: (A.shieldsOff || []).length,
      engine: A.engine || 'google',
      homepage: A.homepage || '',
      isDefault: a.id === 'default',
    };
  });
  on('account-open', (c, id) => runCmd(c, 'account-open', id));
  on('account-new', (c, name) => runCmd(c, 'account-new', name));
  on('account-tab', (c, id) => runCmd(c, 'account-tab', id));
  on('account-move-tab', (c, tabId, accountId) => moveTabAccount(c, tabId, accountId));
  on('account-rename', (_c, id, name) => { renameAccount(id, name); pushAll(); });
  on('account-color', (_c, id, color) => { setAccountColor(id, color); pushAll(); });
  on('account-delete', async (_c, id) => { await deleteAccount(id); pushAll(); });

  // ichki mrb:// sahifalar uchun API
  const page = (n, f) => ipcMain.handle('page:' + n, (e, ...a) => {
    let ok = false;
    try {
      const u = (e.senderFrame && e.senderFrame.url) || (e.sender && !e.sender.isDestroyed() && e.sender.getURL()) || '';
      ok = String(u).startsWith('mrb:');
    } catch {}
    if (!ok) return null;
    const r = tabByWc.get(e.sender.id);
    try { return f(r ? r.ctx : null, ...a); } catch (err) { console.error('[page:' + n + ']', err); return null; }
  });
  page('settings:get', (c) => {
    const s = store.get().settings || {};
    const A = store.acc(aid(c));
    return {
      settings: {
        ...s,
        homepage: (A && A.homepage) || '',
        engine: (A && A.engine) || 'google',
        shieldsOff: (A && Array.isArray(A.shieldsOff)) ? A.shieldsOff : [],
      },
      engines: Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v.name])),
      version: VERSION,
      totalBlocked: store.get().totalBlocked || 0,
      recentBlocked: recentBlockedList(20),
      versions: { electron: process.versions.electron || '', chrome: process.versions.chrome || '' },
      languages: i18n.LANGS,
      strings: i18n.dict(s.language || 'uz'),
      theme: resolvedTheme(),
    };
  });
  page('settings:set', (c, patch) => { applySettings(patch, aid(c)); return true; });

  page('sync:status', () => ({ loggedIn: false, email: null, userId: null, lastPullAt: 0 }));
  page('sync:register', async () => ({ ok: false, error: 'disabled' }));
  page('sync:login', async () => ({ ok: false, error: 'disabled' }));
  page('sync:logout', async () => ({ ok: true }));
  page('sync:push', async () => ({ ok: false, error: 'disabled' }));
  page('sync:pull', async () => ({ ok: false, error: 'disabled' }));
  page('settings:unblock-site', (c, host) => {
    const A = store.acc(aid(c));
    A.shieldsOff = A.shieldsOff.filter((h) => h !== host);
    store.save(); pushAll(); broadcastPages('settings'); return true;
  });
  page('dash:get', () => {
    const s = store.get();
    let metrics = [];
    try { metrics = app.getAppMetrics(); } catch {}
    const byPid = new Map(metrics.map((x) => [x.pid, x]));
    const wins = [];
    for (const c of ctxs) {
      if (c.win.isDestroyed()) continue;
      wins.push({
        priv: !!c.priv, account: c.account ? c.account.name : (c.priv ? null : tt('default_account')), size: c.size ? [c.size.w, c.size.h] : c.win.getContentSize(), scrollX: Math.round(c.scrollX || 0),
        tabs: c.tabs.map((t) => {
          let pid = 0, title = '', url = '';
          try { pid = t.wc.getOSProcessId(); title = t.wc.getTitle(); url = t.wc.getURL(); } catch {}
          const mm = byPid.get(pid);
          return { id: t.id, active: t.id === c.activeId, pinned: !!t.pinned, audible: !!t.audible, muted: (() => { try { return t.wc.isAudioMuted(); } catch { return false; } })(), title, url, pid, cpu: mm ? mm.cpu.percentCPUUsage : 0, mem: mm ? (mm.memory.privateBytes || mm.memory.workingSetSize || 0) : 0, tw: t.tw || 0 };
        }),
      });
    }
    return {
      version: VERSION,
      versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, v8: process.versions.v8 },
      platform: process.platform + ' ' + process.arch, uptime: Math.round(process.uptime()),
      counts: (() => { const A = store.acc(); return { history: A.history.length, bookmarks: A.bookmarks.length, blocked: s.totalBlocked, zoom: Object.keys(A.zoom || {}).length, shieldsOff: (A.shieldsOff || []).length }; })(),
      settings: s.settings, wins,
      procs: metrics.map((x) => ({ pid: x.pid, type: x.type, name: x.name || '', cpu: x.cpu.percentCPUUsage, mem: (x.memory.privateBytes || x.memory.workingSetSize || 0) })),
    };
  });
  page('private', (c) => !!(c && c.priv));
  page('account', (c) => {
    if (!c || c.priv) return null;
    const t = activeTab(c);
    const id = (t && t.accountId) || c.accountId || 'default';
    const a = getAccount(id);
    return { id: a.id, name: a.name, color: a.color };
  });
  page('topsites', (c) => topSites(10, aid(c)));
  page('nav:open', (c, url, newTab) => {
    if (!c || !url) return false;
    if (newTab) createTab(c, url, { after: c.activeId });
    else {
      const t = activeTab(c);
      if (!t) createTab(c, url);
      else { t.homeBlank = false; loadWithUA(t.wc, url); t.wc.focus(); pushState(c); }
    }
    return true;
  });


  page('shortcuts:get', (c) => store.acc(aid(c)).shortcuts || []);
  page('shortcuts:add', (c, item) => {
    const d = store.acc(aid(c));
    if (!Array.isArray(d.shortcuts)) d.shortcuts = [];
    if (d.shortcuts.length >= 10) return { ok: false, err: 'limit' };
    let url = String((item && item.url) || '').trim();
    if (!url) return { ok: false, err: 'url' };
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'https://' + url;
    try { new URL(url); } catch { return { ok: false, err: 'url' }; }
    const title = String((item && item.title) || '').trim() || hostOf(url).replace(/^www\./, '') || url;
    const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const icon = (item && item.icon) || iconFromHistory(url, aid(c)) || '';
    d.shortcuts.push({ id, title, url, icon });
    store.save();
    broadcastPages('settings');
    return { ok: true, id };
  });
  page('shortcuts:remove', (c, id) => {
    const d = store.acc(aid(c));
    d.shortcuts = (d.shortcuts || []).filter((s) => s.id !== id);
    store.save();
    broadcastPages('settings');
    return true;
  });
  page('shortcuts:update', (c, item) => {
    const d = store.acc(aid(c));
    const s = (d.shortcuts || []).find((x) => x.id === item.id);
    if (!s) return false;
    if (item.title != null) s.title = String(item.title).trim() || s.title;
    if (item.url != null) {
      let url = String(item.url).trim();
      if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = 'https://' + url;
      try { new URL(url); s.url = url; } catch { return false; }
      if (!s.icon) s.icon = iconFromHistory(url, aid(c)) || '';
    }
    if (item.icon != null && item.icon) s.icon = String(item.icon);
    store.save();
    broadcastPages('settings');
    return true;
  });
  page('shortcuts:reorder', (c, ids) => {
    const d = store.acc(aid(c));
    const map = new Map((d.shortcuts || []).map((s) => [s.id, s]));
    const next = [];
    for (const id of (ids || [])) if (map.has(id)) { next.push(map.get(id)); map.delete(id); }
    for (const s of map.values()) next.push(s);
    d.shortcuts = next;
    store.save();
    broadcastPages('settings');
    return true;
  });
  page('search-url', (_c, text) => { const r = resolveInput(text); return r ? r.url : null; });
  page('history:get', (c, q) => {
    const s = String(q || '').toLowerCase();
    return store.acc(aid(c)).history.filter((h) => !s || h.url.toLowerCase().includes(s) || (h.title || '').toLowerCase().includes(s)).sort((a, b) => b.ts - a.ts).slice(0, 600);
  });
  page('history:remove', (c, url) => { const A = store.acc(aid(c)); A.history = A.history.filter((h) => h.url !== url); store.save(); return true; });
  page('history:clear', (c) => { store.acc(aid(c)).history = []; store.save(); return true; });
  page('bookmarks:get', (c) => store.acc(aid(c)).bookmarks);
  page('bookmarks:remove', (c, id) => { const A = store.acc(aid(c)); A.bookmarks = A.bookmarks.filter((b) => b.id !== id); store.save(); pushAll(); return true; });
  page('downloads:get', () => dlList());
  page('downloads:action', (_c, id, act) => { dlAction(id, act); return true; });
  page('data:clear', async (_c, o) => { await clearData(o || {}); return true; });
}

/* ───────────── ishga tushirish ───────────── */
function parseArgs(list) {
  const flags = list.filter((a) => a.startsWith('--'));
  const url = list.find((a) => !a.startsWith('--'));
  return { url, private: flags.some((f) => /^--(private|incognito)$/.test(f)), newWindow: flags.includes('--new-window') };
}
function openFromArgs(a) {
  // Ikkinchi (va keyingi) ishga tushirish — har doim YANGI oyna
  // URL bo'lsa shu oynada ochiladi; yo'q bo'lsa dashboard
  const d = store.get();
  const acc = d.lastAccountId || 'default';
  if (a.private) return createWindow({ private: true, url: a.url });
  createWindow({ url: a.url || null, accountId: acc });
}
function start() {
  store.load();
  applyThemeSource();
  nativeTheme.on('updated', () => { if ((store.get().settings.theme || 'system') === 'system') pushAll(); });
  Menu.setApplicationMenu(null);
  registerIpc();

  setupSession(session.defaultSession, false, "default");
  const a = parseArgs(process.argv.slice(app.isPackaged ? 1 : 2));
  const d = store.get();
  const startAcc = d.lastAccountId || 'default';
  if (a.private) createWindow({ private: true, url: a.url });
  else if (a.url) createWindow({ url: a.url, accountId: startAcc });
  else if ((d.settings.startup || 'restore') === 'restore' && store.acc(startAcc).lastSession && store.acc(startAcc).lastSession.tabs && store.acc(startAcc).lastSession.tabs.length) {
    createWindow({ restore: store.acc(startAcc).lastSession, accountId: startAcc });
  } else createWindow({ accountId: startAcc });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    try {
      const args = (argv || []).slice(1);
      openFromArgs(parseArgs(args));
    } catch (err) {
      console.error('[second-instance]', err);
      try { createWindow({ accountId: (store.get().lastAccountId || 'default') }); } catch {}
    }
  });
  app.whenReady().then(start);
}
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => store.flush());
