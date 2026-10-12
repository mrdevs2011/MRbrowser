'use strict';
/**
 * Import Google cookies from Chrome / Chromium / Brave (Linux).
 * 1) CDP (remote debugging) — eng ishonchli
 * 2) SQLite + keyring decrypt — fallback
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const { execFileSync, spawn } = require('child_process');

function home() {
  return os.homedir();
}

function listSources() {
  const h = home();
  const roots = [
    ['Brave', path.join(h, '.config/BraveSoftware/Brave-Browser')],
    ['Brave Nightly', path.join(h, '.config/BraveSoftware/Brave-Browser-Nightly')],
    ['Chromium', path.join(h, '.config/chromium')],
    ['Chrome', path.join(h, '.config/google-chrome')],
  ];
  const out = [];
  for (const [label, root] of roots) {
    if (!fs.existsSync(root)) continue;
    let names = {};
    try {
      const ls = JSON.parse(fs.readFileSync(path.join(root, 'Local State'), 'utf8'));
      const cache = (ls.profile && ls.profile.info_cache) || {};
      for (const [k, v] of Object.entries(cache)) names[k] = (v && v.name) || k;
    } catch {}
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const cookies = path.join(root, ent.name, 'Cookies');
      if (!fs.existsSync(cookies)) continue;
      out.push({
        id: label + ':' + ent.name,
        browser: label,
        profile: ent.name,
        profileLabel: names[ent.name] || ent.name,
        cookiesPath: cookies,
      });
    }
  }
  return out;
}

function isGoogleHost(host) {
  if (!host) return false;
  const h = String(host).replace(/^\./, '').toLowerCase();
  return (
    h === 'google.com' || h.endsWith('.google.com') ||
    /^google\.[a-z.]+$/.test(h) ||
    h.endsWith('.google.co.uz') || h === 'google.co.uz' ||
    h === 'youtube.com' || h.endsWith('.youtube.com') ||
    h.includes('gstatic.com') || h.includes('ggpht.com') ||
    h.includes('googleusercontent.com') || h.includes('googleapis.com')
  );
}

function httpGetJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs || 2000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function cdpGetAllCookies(wsUrl) {
  return new Promise((resolve, reject) => {
    let WebSocket;
    try { WebSocket = require('ws'); } catch {
      // minimal WS via undici/no - use pure manual
      return reject(new Error('no_ws'));
    }
    const ws = new WebSocket(wsUrl);
    const id = 1;
    const t = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('cdp_timeout')); }, 8000);
    ws.on('open', () => {
      ws.send(JSON.stringify({ id, method: 'Network.getAllCookies' }));
    });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg.id === id) {
          clearTimeout(t);
          try { ws.close(); } catch {}
          resolve((msg.result && msg.result.cookies) || []);
        }
      } catch (e) {
        clearTimeout(t);
        reject(e);
      }
    });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

/** CDP without ws package — use Node 22 experimental or raw HTTP not available for WS.
 *  Fallback: spawn python websocket-client if needed.
 */
function cdpGetAllCookiesPython(wsUrl) {
  const script = `
import json, sys
try:
    import websocket
except ImportError:
    print(json.dumps({"error": "no_websocket_client"}))
    sys.exit(0)
ws = websocket.create_connection(sys.argv[1], timeout=8)
ws.send(json.dumps({"id": 1, "method": "Network.getAllCookies"}))
while True:
    msg = json.loads(ws.recv())
    if msg.get("id") == 1:
        print(json.dumps(msg.get("result", {}).get("cookies", [])))
        break
ws.close()
`;
  const py = path.join(os.tmpdir(), 'mrb-cdp-' + process.pid + '.py');
  fs.writeFileSync(py, script);
  try {
    const out = execFileSync('python3', [py, wsUrl], { encoding: 'utf8', timeout: 12000, env: process.env });
    const data = JSON.parse(out);
    if (data && data.error) throw new Error(data.error);
    return data;
  } finally {
    try { fs.unlinkSync(py); } catch {}
  }
}

async function fetchCookiesViaCDP() {
  const ports = [9222, 9223, 9229, 9333, 9450];
  for (const port of ports) {
    try {
      const targets = await httpGetJson('http://127.0.0.1:' + port + '/json');
      if (!Array.isArray(targets) || !targets.length) continue;
      // Prefer a page target with webSocketDebuggerUrl
      const t = targets.find((x) => x.webSocketDebuggerUrl && x.type === 'page')
        || targets.find((x) => x.webSocketDebuggerUrl);
      if (!t || !t.webSocketDebuggerUrl) continue;
      let cookies;
      try {
        cookies = cdpGetAllCookiesPython(t.webSocketDebuggerUrl);
      } catch (e) {
        continue;
      }
      if (Array.isArray(cookies) && cookies.length) {
        return { port, cookies, source: 'cdp' };
      }
    } catch {}
  }
  return null;
}

function secretPassword() {
  const tries = [
    ['secret-tool', ['lookup', 'application', 'brave']],
    ['secret-tool', ['lookup', 'application', 'chromium']],
    ['secret-tool', ['lookup', 'application', 'chrome']],
    ['secret-tool', ['lookup', 'xdg:schema', 'chrome_libsecret_os_crypt_password_v2']],
  ];
  for (const [bin, args] of tries) {
    try {
      const r = execFileSync(bin, args, {
        encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
      });
      if (r && r.length) return r.replace(/\n$/, '');
    } catch {}
  }
  return 'peanuts';
}

function deriveKey(password) {
  return crypto.pbkdf2Sync(String(password), 'saltysalt', 1, 16, 'sha1');
}

function decryptValue(key, buf) {
  if (!buf || buf.length < 4) return null;
  const prefix = buf.slice(0, 3).toString('utf8');
  try {
    if (prefix === 'v10') {
      const iv = Buffer.alloc(16, ' ');
      const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
      decipher.setAutoPadding(true);
      return Buffer.concat([decipher.update(buf.slice(3)), decipher.final()]).toString('utf8');
    }
    if (prefix === 'v11') {
      const payload = buf.slice(3);
      if (payload.length < 28) return null;
      const nonce = payload.slice(0, 12);
      const tag = payload.slice(payload.length - 16);
      const ct = payload.slice(12, payload.length - 16);
      const decipher = crypto.createDecipheriv('aes-128-gcm', key, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    }
  } catch { return null; }
  return null;
}

function readCookiesDb(cookiesPath) {
  const tmp = path.join(os.tmpdir(), 'mrb-ck-' + process.pid + '-' + Date.now() + '.db');
  fs.copyFileSync(cookiesPath, tmp);
  const script = `
import sqlite3, sys, json
con=sqlite3.connect(sys.argv[1])
cur=con.cursor()
cur.execute('SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies')
rows=[]
for r in cur.fetchall():
    rows.append({'host_key': r[0], 'name': r[1], 'value': r[2] or '', 'encrypted_value': list(r[3]) if r[3] else [], 'path': r[4] or '/', 'expires_utc': r[5] or 0, 'is_secure': int(r[6] or 0), 'is_httponly': int(r[7] or 0), 'samesite': int(r[8] or 0)})
print(json.dumps(rows))
con.close()
`;
  const pyTmp = path.join(os.tmpdir(), 'mrb-ck-read-' + process.pid + '.py');
  fs.writeFileSync(pyTmp, script);
  try {
    const out = execFileSync('python3', [pyTmp, tmp], { encoding: 'utf8', maxBuffer: 80 * 1024 * 1024, env: process.env });
    const rows = JSON.parse(out);
    for (const r of rows) r.encrypted_value = Buffer.from(r.encrypted_value || []);
    return rows;
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
    try { fs.unlinkSync(pyTmp); } catch {}
  }
}

function chromeExpiryToUnix(expiresUtc) {
  if (!expiresUtc || expiresUtc <= 0) return undefined;
  const unix = Math.floor(expiresUtc / 1000000 - 11644473600);
  if (unix <= Math.floor(Date.now() / 1000)) return undefined;
  return unix;
}

function sameSite(v) {
  if (v === 1 || v === 'None' || v === 'no_restriction') return 'no_restriction';
  if (v === 2 || v === 'Lax' || v === 'lax') return 'lax';
  if (v === 3 || v === 'Strict' || v === 'strict') return 'strict';
  return 'unspecified';
}

async function setCookieFromCDP(ses, c) {
  const domain = c.domain || '';
  const hostClean = domain.replace(/^\./, '') || 'google.com';
  const cookiePath = c.path || '/';
  const url = (c.secure !== false ? 'https://' : 'http://') + hostClean + cookiePath;
  const name = c.name;
  const isHost = name.startsWith('__Host-');
  const opts = {
    url,
    name,
    value: c.value,
    path: isHost ? '/' : cookiePath,
    secure: isHost || name.startsWith('__Secure-') ? true : !!c.secure,
    httpOnly: !!c.httpOnly,
    sameSite: sameSite(c.sameSite),
  };
  if (!isHost && domain.startsWith('.')) opts.domain = domain;
  if (c.expires && c.expires > 0 && c.expires < 1e12) opts.expirationDate = c.expires;
  else if (c.expires && c.expires > 1e12) opts.expirationDate = Math.floor(c.expires / 1000);
  await ses.cookies.set(opts);
}

async function setOneCookie(ses, row, value) {
  const hostKey = row.host_key || '';
  const name = row.name;
  const cookiePath = row.path || '/';
  const hostClean = hostKey.replace(/^\./, '') || 'google.com';
  const url = 'https://' + hostClean + (cookiePath.startsWith('/') ? cookiePath : '/' + cookiePath);
  const isHost = name.startsWith('__Host-');
  const base = {
    url,
    name,
    value,
    path: isHost ? '/' : cookiePath,
    secure: name.startsWith('__Secure-') || isHost ? true : !!row.is_secure,
    httpOnly: !!row.is_httponly,
    sameSite: sameSite(row.samesite),
  };
  const exp = chromeExpiryToUnix(row.expires_utc);
  if (exp) base.expirationDate = exp;
  if (!isHost && hostKey.startsWith('.')) base.domain = hostKey;
  await ses.cookies.set(base);
}

async function importFromSqlite(ses) {
  const sources = listSources();
  const pw = secretPassword();
  const keys = [];
  const seen = new Set();
  for (const p of [pw, 'peanuts', '']) {
    const k = deriveKey(p);
    const hex = k.toString('hex');
    if (!seen.has(hex)) { seen.add(hex); keys.push(k); }
  }
  let imported = 0, decrypted = 0, failed = 0, googleRows = 0;
  const details = [];
  for (const src of sources) {
    let rows;
    try { rows = readCookiesDb(src.cookiesPath); }
    catch (e) { details.push({ id: src.id, error: String(e.message || e) }); continue; }
    let n = 0, dec = 0;
    for (const row of rows) {
      if (!isGoogleHost(row.host_key)) continue;
      googleRows++;
      let value = row.value || '';
      if (!value && row.encrypted_value && row.encrypted_value.length) {
        const buf = Buffer.isBuffer(row.encrypted_value) ? row.encrypted_value : Buffer.from(row.encrypted_value);
        for (const key of keys) {
          const d = decryptValue(key, buf);
          if (d) { value = d; dec++; break; }
        }
      }
      if (!value) { failed++; continue; }
      try { await setOneCookie(ses, row, value); n++; imported++; }
      catch { failed++; }
    }
    decrypted += dec;
    details.push({ id: src.id, count: n, decrypted: dec });
  }
  return {
    ok: imported > 0,
    method: 'sqlite',
    imported, decrypted, failed, googleRows,
    keyring: pw === 'peanuts' ? 'fallback' : 'ok',
    details,
  };
}

async function importGoogleCookies(ses) {
  // 1) CDP first
  try {
    const cdp = await fetchCookiesViaCDP();
    if (cdp && cdp.cookies && cdp.cookies.length) {
      let imported = 0, failed = 0;
      for (const c of cdp.cookies) {
        const host = c.domain || '';
        if (!isGoogleHost(host)) continue;
        try { await setCookieFromCDP(ses, c); imported++; }
        catch { failed++; }
      }
      try { await ses.cookies.flushStore(); } catch {}
      if (imported > 0) {
        return { ok: true, method: 'cdp', port: cdp.port, imported, failed, keyring: 'n/a' };
      }
    }
  } catch {}

  // 2) SQLite decrypt
  const r = await importFromSqlite(ses);
  try { await ses.cookies.flushStore(); } catch {}
  if (!r.ok) {
    r.hint = 'Brave ni yoping va shunday oching: brave --remote-debugging-port=9222  keyin qayta Import';
  }
  return r;
}

module.exports = { listSources, importGoogleCookies };
