const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  fetchUsage: () => ipcRenderer.invoke('fetch-usage'),
  fetchLocalUsage: () => ipcRenderer.invoke('fetch-local-usage'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  sendUsage: (data) => ipcRenderer.send('usage-updated', data),
  onRefresh: (cb) => ipcRenderer.on('trigger-refresh', cb),
});
