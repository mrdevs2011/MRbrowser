const { ipcRenderer, contextBridge } = require('electron');
contextBridge.exposeInMainWorld('fapi', { scroll: (k, v) => ipcRenderer.send('frame:scroll', k, v), resize: (id, w) => ipcRenderer.send('frame:resize', id, w), reset: () => ipcRenderer.send('frame:resetw') });
// Oynaning HAQIQIY o'lchamini main'ga yuboradi (Wayland/niri'da getContentSize eskirib qoladi)
const send = () => { try { ipcRenderer.send('frame:size', innerWidth, innerHeight); } catch {} };
addEventListener('resize', send);
addEventListener('DOMContentLoaded', send);
addEventListener('load', send);
