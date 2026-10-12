const { contextBridge, ipcRenderer } = require('electron');
// Brauzer interfeysi (toolbar/tablar) uchun ko'prik
contextBridge.exposeInMainWorld('api', {
  send: (c, ...a) => ipcRenderer.send('ui:' + c, ...a),
  invoke: (c, ...a) => ipcRenderer.invoke('ui:' + c, ...a),
  on: (c, cb) => ipcRenderer.on('ui-ev:' + c, (_e, ...a) => cb(...a)),
});
