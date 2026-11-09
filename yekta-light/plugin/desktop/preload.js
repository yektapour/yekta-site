const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('yektaNative', {
  copy: (text) => ipcRenderer.invoke('clip:write', String(text)),
  read: () => ipcRenderer.invoke('clip:read'),
  setPin: (on) => ipcRenderer.invoke('pin:set', !!on),
  getPin: () => ipcRenderer.invoke('pin:get'),
});
