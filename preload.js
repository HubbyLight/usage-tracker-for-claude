'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('usageApi', {
  onUsage: (cb) => ipcRenderer.on('usage', (_e, data) => cb(data)),
  onManualRefresh: (cb) => ipcRenderer.on('manual-refresh', () => cb()),
  refresh: () => ipcRenderer.send('refresh'),
  login: () => ipcRenderer.send('login'),
  setPinned: (v) => ipcRenderer.send('set-pinned', v),
});
