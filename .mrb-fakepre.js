const { contextBridge } = require('electron');
const mock = {
  'dash:get': { version: '2.0.0', versions: { electron: '44', chrome: '152', node: '24', v8: '15' }, platform: 'linux x64', uptime: 76, counts: { history: 9, bookmarks: 0, blocked: 16, zoom: 0, shieldsOff: 0 }, settings: { engine: 'google', tile: true, shieldsOff: [] }, wins: [{ priv: false, size: [1100, 700], scrollX: 0, tabs: [{ id: 1, active: true, pinned: false, audible: false, muted: false, title: 'T', url: 'mrb://dashboard/', pid: 1, cpu: 0, mem: 100000, tw: 0 }] }], procs: [{ pid: 1, type: 'Browser', name: '', cpu: 1, mem: 300000 }] },
  topsites: [{ title: 'github.com', url: 'https://github.com/', icon: '' }, { title: 'claude.ai', url: 'https://claude.ai/', icon: '' }],
  'settings:get': { settings: {}, totalBlocked: 16, engines: {}, version: '2.0.0', versions: {} },
  'search-url': 'https://example.com/',
};
contextBridge.exposeInMainWorld('mrb', { invoke: async (c) => mock[c], on: () => {} });
