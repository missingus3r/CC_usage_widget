const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  fetchUsage: () => ipcRenderer.invoke('fetch-usage'),
  fetchCodexUsage: () => ipcRenderer.invoke('fetch-codex-usage'),
  fetchElevenUsage: () => ipcRenderer.invoke('fetch-eleven-usage'),
  fetchLocalUsage: () => ipcRenderer.invoke('fetch-local-usage'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  getApiKeys: () => ipcRenderer.invoke('get-api-keys'),
  saveApiKeys: (keys) => ipcRenderer.invoke('save-api-keys', keys),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  resizeContent: (height) => ipcRenderer.send('resize-content', height),
  sendUsage: (data) => ipcRenderer.send('usage-updated', data),
  sendCodexUsage: (data) => ipcRenderer.send('codex-usage-updated', data),
  sendElevenUsage: (data) => ipcRenderer.send('eleven-usage-updated', data),
  onRefresh: (cb) => ipcRenderer.on('trigger-refresh', cb),
});
