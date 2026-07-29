const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    perguntarIA: (mensagem) => ipcRenderer.invoke('perguntar-ia', mensagem),
    onSystemReady: (callback) => ipcRenderer.on('system-ready', callback)
});