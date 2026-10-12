'use strict';
/**
 * Supabase bulut sinxroni — login, push, pull.
 * @module main/sync
 */
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { createClient } = require('@supabase/supabase-js');
const { loadConfig } = require('../shared/supabase-config');

let client = null;
let storeRef = null;
let onChange = null;
let pushTimer = null;
let lastPullAt = 0;
let sessionCache = null;

function sessionFile() {
  return path.join(app.getPath('userData'), 'mrbrowser-cloud.json');
}

function loadSession() {
  try {
    const raw = fs.readFileSync(sessionFile(), 'utf8');
    const j = JSON.parse(raw);
    if (j && j.access_token && j.refresh_token) return j;
  } catch {}
  return null;
}

function saveSession(sess) {
  try {
    if (!sess) {
      try { fs.unlinkSync(sessionFile()); } catch {}
      sessionCache = null;
      return;
    }
    const out = {
      access_token: sess.access_token,
      refresh_token: sess.refresh_token,
      expires_at: sess.expires_at || null,
      user: sess.user ? { id: sess.user.id, email: sess.user.email } : null,
    };
    fs.writeFileSync(sessionFile(), JSON.stringify(out, null, 2));
    sessionCache = out;
  } catch (e) {
    console.error('[sync] saveSession', e);
  }
}

async function getClient() {
  if (client) return client;
  const cfg = await loadConfig();
  client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}

async function restoreAuth() {
  const saved = loadSession();
  if (!saved) return null;
  const sb = await getClient();
  try {
    const { data, error } = await sb.auth.setSession({
      access_token: saved.access_token,
      refresh_token: saved.refresh_token,
    });
    if (error) {
      console.error('[sync] setSession', error.message);
      saveSession(null);
      return null;
    }
    if (data.session) {
      saveSession(data.session);
      return data.session;
    }
  } catch (e) {
    console.error('[sync] restoreAuth', e);
    saveSession(null);
  }
  return null;
}

function buildPayload() {
  const d = storeRef.get();
  // Tarixni cheklab yuboramiz (hajm)
  const accounts = (d.accounts || []).map((a) => {
    const hist = Array.isArray(a.history) ? a.history.slice(0, 500) : [];
    return {
      id: a.id,
      name: a.name,
      color: a.color,
      homepage: a.homepage || '',
      engine: a.engine || 'google',
      shieldsOff: a.shieldsOff || [],
      bookmarks: a.bookmarks || [],
      shortcuts: a.shortcuts || [],
      history: hist,
      zoom: a.zoom || {},
      permissions: a.permissions || {},
      lastSession: a.lastSession || null,
    };
  });
  return {
    v: 1,
    settings: { ...(d.settings || {}) },
    accounts,
    lastAccountId: d.lastAccountId || 'default',
    updatedAt: Date.now(),
  };
}

function applyPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const d = storeRef.get();
  if (payload.settings && typeof payload.settings === 'object') {
    Object.assign(d.settings, payload.settings);
  }
  if (Array.isArray(payload.accounts) && payload.accounts.length) {
    // Mavjud local accountlarni merge: bulut ustun
    const byId = new Map(payload.accounts.map((a) => [a.id, a]));
    const merged = [];
    for (const a of payload.accounts) {
      const shaped = storeRef.shape ? storeRef.shape(a) : a;
      merged.push(shaped);
    }
    // Agar default yo'q bo'lsa
    if (!merged.find((x) => x.id === 'default') && d.accounts) {
      const def = d.accounts.find((x) => x.id === 'default');
      if (def) merged.unshift(def);
    }
    d.accounts = merged;
  }
  if (payload.lastAccountId) d.lastAccountId = payload.lastAccountId;
  storeRef.save();
  return true;
}

function status() {
  const s = sessionCache || loadSession();
  return {
    loggedIn: !!(s && s.user && s.user.id),
    email: s && s.user ? s.user.email : null,
    userId: s && s.user ? s.user.id : null,
    lastPullAt,
  };
}

function mapAuthError(error) {
  if (!error) return 'unknown';
  const msg = String(error.message || error || '').toLowerCase();
  const code = String(error.code || '').toLowerCase();
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) return 'email_not_confirmed';
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return 'invalid_credentials';
  if (msg.includes('invalid') && msg.includes('email')) return 'invalid_email';
  if (msg.includes('network') || msg.includes('fetch')) return 'network';
  return error.message || String(error);
}

async function register(email, password) {
  try {
    const sb = await getClient();
    const { data, error } = await sb.auth.signUp({ email: String(email || '').trim(), password: String(password || '') });
    if (error) return { ok: false, error: mapAuthError(error), raw: error.message };
    if (data.session) {
      saveSession(data.session);
      return { ok: true, email: data.user && data.user.email, needsConfirm: false };
    }
    if (data.user) {
      // Email confirm kerak — session yo'q
      return { ok: true, needsConfirm: true, email: data.user.email };
    }
    return { ok: false, error: 'unknown' };
  } catch (e) {
    return { ok: false, error: 'network', raw: e && e.message };
  }
}

async function login(email, password) {
  try {
    const sb = await getClient();
    const { data, error } = await sb.auth.signInWithPassword({
      email: String(email || '').trim(),
      password: String(password || ''),
    });
    if (error) return { ok: false, error: mapAuthError(error), raw: error.message };
    if (data.session) saveSession(data.session);
    const pulled = await pull();
    return { ok: true, email: data.user && data.user.email, pulled: pulled.ok, pullError: pulled.error || null };
  } catch (e) {
    return { ok: false, error: 'network', raw: e && e.message };
  }
}

async function logout() {
  try {
    const sb = await getClient();
    await sb.auth.signOut();
  } catch {}
  saveSession(null);
  return { ok: true };
}

async function push() {
  const st = status();
  if (!st.loggedIn) return { ok: false, error: 'not_logged_in' };
  const sb = await getClient();
  // session yangilash
  await restoreAuth();
  const payload = buildPayload();
  const row = {
    user_id: st.userId,
    payload,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('browser_sync').upsert(row, { onConflict: 'user_id' });
  if (error) {
    console.error('[sync] push', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, at: Date.now() };
}

async function pull() {
  const st = status();
  if (!st.loggedIn) return { ok: false, error: 'not_logged_in' };
  const sb = await getClient();
  await restoreAuth();
  const { data, error } = await sb
    .from('browser_sync')
    .select('payload, updated_at')
    .eq('user_id', st.userId)
    .maybeSingle();
  if (error) {
    console.error('[sync] pull', error.message);
    return { ok: false, error: error.message };
  }
  if (!data || !data.payload) {
    // Birinchi marta — lokalni yuklash
    const p = await push();
    lastPullAt = Date.now();
    return { ok: true, empty: true, pushed: p.ok };
  }
  applyPayload(data.payload);
  lastPullAt = Date.now();
  if (typeof onChange === 'function') {
    try { onChange(); } catch {}
  }
  return { ok: true, at: lastPullAt, remoteAt: data.updated_at };
}

function schedulePush() {
  if (!status().loggedIn) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    push().catch((e) => console.error('[sync] auto push', e));
  }, 2500);
}

function init(store, opts) {
  storeRef = store;
  onChange = opts && opts.onChange;
  // shape helper
  if (store && typeof store.acc === 'function') {
    storeRef.shape = (a) => {
      // minimal shape via store module pattern
      if (!a.history) a.history = [];
      if (!a.bookmarks) a.bookmarks = [];
      if (!a.shortcuts) a.shortcuts = [];
      if (!a.zoom) a.zoom = {};
      if (!a.permissions) a.permissions = {};
      if (!a.shieldsOff) a.shieldsOff = [];
      return a;
    };
  }
  sessionCache = loadSession();
  restoreAuth().then(async (s) => {
    if (s) {
      try { await pull(); } catch {}
      if (typeof onChange === 'function') { try { onChange(); } catch {} }
    } else if (typeof onChange === 'function') {
      try { onChange(); } catch {}
    }
  }).catch(() => {
    if (typeof onChange === 'function') { try { onChange(); } catch {} }
  });
}

module.exports = {
  init,
  status,
  register,
  login,
  logout,
  push,
  pull,
  schedulePush,
};
