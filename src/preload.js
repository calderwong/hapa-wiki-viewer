const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hapaWiki', {
  load: () => ipcRenderer.invoke('wiki:load'),
  loadCardWindow: (slug) => ipcRenderer.invoke('wiki:loadCardWindow', slug),
  renderMarkdown: (markdown, fromSlug) => ipcRenderer.invoke('wiki:renderMarkdown', markdown, fromSlug),
  openFolder: () => ipcRenderer.invoke('wiki:openFolder'),
  getPage: (slug) => ipcRenderer.invoke('wiki:getPage', slug),
  reindex: () => ipcRenderer.invoke('wiki:reindex'),
  showInFinder: (slug) => ipcRenderer.invoke('wiki:showInFinder', slug),
  openCardWindow: (slug) => ipcRenderer.invoke('wiki:openCardWindow', slug),
  listComments: (options) => ipcRenderer.invoke('wikiops:listComments', options),
  addComment: (payload) => ipcRenderer.invoke('wikiops:addComment', payload),
  updateComment: (id, payload) => ipcRenderer.invoke('wikiops:updateComment', id, payload),
  listVersions: (slug) => ipcRenderer.invoke('wikiops:listVersions', slug),
  appendPage: (payload) => ipcRenderer.invoke('wikiops:appendPage', payload),
  updatePage: (payload) => ipcRenderer.invoke('wikiops:updatePage', payload),
  getCategories: () => ipcRenderer.invoke('wikiops:getCategories'),
  addCategory: (payload) => ipcRenderer.invoke('wikiops:addCategory', payload)
});
