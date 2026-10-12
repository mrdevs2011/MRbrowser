const { contextBridge, ipcRenderer } = require('electron');
// Yonma-yon rejimda: shu panega bosilsa, u faol tab bo'ladi
addEventListener('pointerdown', () => { try { ipcRenderer.send('pane:focus'); } catch {} }, true);
// Faqat ichki mrb:// sahifalarga API beriladi (oddiy saytlarga hech narsa ochilmaydi)
if (location.protocol === 'mrb:' || String(location.href || '').startsWith('mrb:')) {
  contextBridge.exposeInMainWorld('mrb', {
    invoke: (c, ...a) => ipcRenderer.invoke('page:' + c, ...a),
    on: (c, cb) => ipcRenderer.on('page-ev:' + c, (_e, ...a) => cb(...a)),
  });
}
// Yonma-yon rejimda tablar sig'masa: touchpad / barmoq / Shift+g'ildirak -- panelarni gorizontal suradi
let ov = false;
try { ov = !!ipcRenderer.sendSync('pane:ov'); } catch {}
ipcRenderer.on('tile-ov', (_e, v) => { ov = !!v; });
// Sahifaning o'zida (shu nuqtada) gorizontal surish mumkinmi? Mumkin bo'lsa -- tegmaymiz.
const canScrollX = (el, dir) => {
  const can = (n) => dir > 0 ? n.scrollLeft + n.clientWidth < n.scrollWidth - 1 : n.scrollLeft > 0;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    let cs; try { cs = getComputedStyle(n); } catch { continue; }
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && n.scrollWidth > n.clientWidth + 1 && can(n)) return true;
  }
  const se = document.scrollingElement;
  return !!(se && se.scrollWidth > se.clientWidth + 1 && can(se));
};
// Deltalar kadrga bir marta yig'ilib yuboriladi (IPC chastotasi <= ekran chastotasi)
let acc = 0, raf = 0;
const flush = () => { raf = 0; const d = acc; acc = 0; if (d) { try { ipcRenderer.send('pane:hscroll', d); } catch {} } };
const hs = (dx) => { acc += dx; if (!raf) raf = requestAnimationFrame(flush); };
// Gesture (touchpad inertsiyasi ham) davomida nishon bir marta tanlanadi: canScrollX (majburiy layout/style recalc)
// har wheel hodisasida chaqirilmaydi. wLatch: 1 -- panellar suriladi, -1 -- sahifaning o'zi.
let wLatch = 0, wT = 0;
addEventListener('wheel', (e) => {
  if (!ov) return;
  if (e.shiftKey) { const d = e.deltaX || e.deltaY; if (d) { e.preventDefault(); hs(d); } return; }
  const now = performance.now();
  // Yangi gesture: yo'nalish bir marta aniqlanadi. 1 -- panellar suriladi, -1 -- sahifaning o'zi, 2 -- vertikal gesture
  if (!wLatch || now - wT > 120) {
    const ax = Math.abs(e.deltaX), ay = Math.abs(e.deltaY);
    if (ax > ay && ax > 0) wLatch = canScrollX(e.target, e.deltaX) ? -1 : 1; else wLatch = 2;
  }
  wT = now;
  if (wLatch !== 1) return;
  // Gesture davomida (diagonal harakat va inertsiya ham) panellar suriladi, vertikal siljish aralashmaydi
  e.preventDefault();
  if (e.deltaX) hs(e.deltaX);
}, { capture: true, passive: false });
let tx = 0, mode = 2;
addEventListener('touchstart', (e) => {
  if (e.touches.length !== 1) { mode = 2; return; }
  tx = e.touches[0].clientX; ty0 = e.touches[0].clientY; mode = ov ? 0 : 2;
}, { capture: true, passive: true });
let ty0 = 0;
addEventListener('touchmove', (e) => {
  if (!ov || mode === 2 || e.touches.length !== 1) return;
  const x = e.touches[0].clientX, y = e.touches[0].clientY, dx = x - tx, dy = y - ty0;
  if (mode === 0) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    if (Math.abs(dx) > Math.abs(dy) && !canScrollX(e.target, -dx)) mode = 1; else { mode = 2; return; }
  }
  if (e.cancelable) e.preventDefault();
  hs(-dx); tx = x; ty0 = y;
}, { capture: true, passive: false });


