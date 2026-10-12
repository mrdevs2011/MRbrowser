const { app, BrowserWindow, protocol } = require('electron');
const path = require('path'), fs = require('fs');
protocol.registerSchemesAsPrivileged([{ scheme: 'mrb', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const probeNew = () => ({ text: document.body.innerText.trim(), appKids: document.getElementById('app').children.length, bg: getComputedStyle(document.body).backgroundColor, title: document.title });
const probeDash = () => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom), cx: Math.round(b.left + b.width / 2), w: Math.round(b.width) }; };
  const inp = document.querySelector('#q');
  const cs = inp ? getComputedStyle(inp) : null;
  return { vw: innerWidth, logo: r('.logo'), sbox: r('.sbox'), seg: r('.seg'), pane: r('#pane'), on: (document.querySelector('.seg button.on') || {}).textContent, segText: [...document.querySelectorAll('.seg button')].map((b) => b.textContent), hasOverview: document.body.innerText.includes('OVERVIEW'), hasClock: !!document.querySelector('.clock'), tiles: document.querySelectorAll('.tile').length, inputBorder: cs && cs.borderTopWidth, inputW: cs && Math.round(parseFloat(cs.width)), radius: getComputedStyle(document.querySelector('.sbox')).borderTopLeftRadius, title: document.title };
};
app.whenReady().then(async () => {
  protocol.handle('mrb', () => new Response(fs.readFileSync(path.join(__dirname, 'internal.html')), { headers: { 'content-type': 'text/html' } }));
  const out = {}; const errs = [];
  const mk = async (route) => {
    const w = new BrowserWindow({ show: false, width: 1100, height: 700, webPreferences: { sandbox: true, preload: path.join(__dirname, '.mrb-fakepre.js') } });
    w.webContents.on('console-message', (e) => { if ((e.level === 'error' || e.level === 3)) errs.push(route + ': ' + e.message); });
    w.webContents.on('preload-error', (_e, p, er) => errs.push('preload: ' + er.message));
    await w.loadURL('mrb://' + route + '/'); await sleep(700);
    return w;
  };
  const ex = (w, fn) => w.webContents.executeJavaScript('(' + fn.toString() + ')()');
  let w = await mk('newtab'); out.newtab = await ex(w, probeNew); w.destroy();
  w = await mk('dashboard');
  out.dashDev = await ex(w, probeDash);
  await w.webContents.executeJavaScript("document.querySelector('.seg button[data-m=gen]').click()"); await sleep(500);
  out.dashGen = await ex(w, probeDash);
  await w.webContents.executeJavaScript("document.querySelector('.seg button[data-m=dev]').click()"); await sleep(500);
  out.dashDevAgain = await ex(w, probeDash);
  w.destroy();
  out.errors = errs;
  console.log('RESULT ' + JSON.stringify(out));
  app.exit(0);
});
