'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  boot: () => ipcRenderer.invoke('boot:get'),
  onPrices: (cb) => ipcRenderer.on('prices', (_e, d) => cb(d)),
  onState: (cb) => ipcRenderer.on('feed:state', (_e, d) => cb(d)),
  onConfig: (cb) => ipcRenderer.on('config', (_e, d) => cb(d)),
  onAlert: (cb) => ipcRenderer.on('alert', (_e, d) => cb(d)),
  onContracts: (cb) => ipcRenderer.on('contracts', (_e, d) => cb(d)),
  onAcrylic: (cb) => ipcRenderer.on('window:acrylic', (_e, d) => cb(d)),

  resize: (h) => ipcRenderer.send('window:resize', h),
  close: () => ipcRenderer.send('window:close'),
  resizeStart: () => ipcRenderer.send('resize:start'),
  toggleSettings: () => ipcRenderer.send('settings:toggle'),
  closeSettings: () => ipcRenderer.send('settings:close'),
  settingsResize: (h) => ipcRenderer.send('settings:resize', h),
  onSettingsVisible: (cb) => ipcRenderer.on('settings:visible', (_e, v) => cb(v)),
  openSearch: () => ipcRenderer.send('search:open'),
  onOpenSearch: (cb) => ipcRenderer.on('open-search', () => cb()),
  diag: (payload) => ipcRenderer.send('diag', payload),

  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  search: (q) => ipcRenderer.invoke('coin:search', q),
  add: (symbol) => ipcRenderer.invoke('coin:add', symbol),
  remove: (symbol) => ipcRenderer.invoke('coin:remove', symbol),
  setAlert: (payload) => ipcRenderer.invoke('alert:set', payload),
  reorder: (order) => ipcRenderer.invoke('coin:reorder', order),
  retry: () => ipcRenderer.invoke('feed:retry'),
  testServer: (url) => ipcRenderer.invoke('server:test', url)
});
