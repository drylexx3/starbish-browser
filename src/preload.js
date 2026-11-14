const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('starbishAPI', {
  navigate: (url) => ipcRenderer.invoke('navigate', url),
  newTab: (url) => ipcRenderer.invoke('new-tab', url),
  switchTab: (id) => ipcRenderer.invoke('switch-tab', id),
  closeTab: (id) => ipcRenderer.invoke('close-tab', id),
  goBack: () => ipcRenderer.invoke('go-back'),
  goForward: () => ipcRenderer.invoke('go-forward'),
  reload: () => ipcRenderer.invoke('reload'),
  resetIdentity: () => ipcRenderer.invoke('reset-identity'),
  getShieldStats: () => ipcRenderer.invoke('get-shield-stats'),

  onTabCreated: (callback) => ipcRenderer.on('tab-created', (e, data) => callback(data)),
  onTabUpdated: (callback) => ipcRenderer.on('tab-updated', (e, data) => callback(data)),
  onTabClosed: (callback) => ipcRenderer.on('tab-closed', (e, id) => callback(id)),
  onShieldStatsUpdated: (callback) => ipcRenderer.on('shield-stats-updated', (e, stats) => callback(stats))
});
