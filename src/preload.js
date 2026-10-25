'use strict';
// Puente seguro entre la interfaz y el proceso principal: la interfaz no tiene acceso directo a Node.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel, fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('arcadia', {
  init: () => call('app:init'),
  updateSettings: (patch) => call('settings:update', patch),
  scan: () => call('library:scan'),
  launch: (id) => call('game:launch', id),
  cancelLaunch: (id) => call('game:cancelLaunch', id),
  stop: () => call('game:stop'),
  favorite: (id) => call('game:favorite', id),
  reveal: (id) => call('game:reveal', id),
  emuStatus: () => call('emu:status'),
  emuInstall: (id) => call('emu:install', id),
  emuLocate: (id) => call('emu:locate', id),
  emuOpen: (id) => call('emu:openGui', id),
  emuHomepage: (id) => call('emu:homepage', id),
  emuSetDefault: (systemId, key) => call('emu:setDefault', systemId, key),
  emuInstallFirmware: () => call('emu:installFirmware'),
  emuFirmwarePage: () => call('emu:firmwarePage'),
  openFolder: (kind, systemId) => call('folder:open', kind, systemId),
  chooseRoot: (suggested) => call('folder:chooseRoot', suggested),
  addRomDir: (systemId) => call('folder:addRomDir', systemId),
  removeRomDir: (systemId, dir) => call('folder:removeRomDir', systemId, dir),
  importPlan: (paths) => call('import:plan', paths),
  importPick: (mode) => call('import:pick', mode),
  importRun: (items, move) => call('import:execute', items, move),
  fetchCovers: () => call('covers:fetch'),
  coversConfig: () => call('covers:config'),
  coversSaveConfig: (patch) => call('covers:saveConfig', patch),
  coversOpenSite: (which) => call('covers:openSite', which),
  firewall: (block) => call('emu:firewall', block),
  cloudStatus: () => call('cloud:status'),
  qualityTable: () => call('quality:table'),
  qualitySet: (systemId, level) => call('quality:set', systemId, level),
  cloudConnect: () => call('cloud:connect'),
  cloudCancelConnect: () => call('cloud:cancelConnect'),
  cloudRemoveAccount: (remote) => call('cloud:removeAccount', remote),
  cloudSaveSource: (src) => call('cloud:saveSource', src),
  cloudRemoveSource: (id) => call('cloud:removeSource', id),
  cloudSetMapping: (name, systemId) => call('cloud:setMapping', name, systemId),
  cloudFolders: (sourceId) => call('cloud:folders', sourceId),
  cloudItems: (sourceId, folder, systemId, refresh) => call('cloud:items', sourceId, folder, systemId, refresh),
  cloudDownload: (sourceId, folder, systemId, units) => call('cloud:download', sourceId, folder, systemId, units),
  cloudCancel: (id) => call('cloud:cancel', id),
  cloudGames: () => call('cloud:games'),
  cloudRefresh: () => call('cloud:refresh'),
  cloudPlay: (id) => call('cloud:play', id),
  cloudOpenLink: (url) => call('cloud:openLink', url),
  cloudOpenConfig: () => call('cloud:openConfig'),
  focusWindow: () => call('app:focus'),
  quit: () => call('app:quit'),
  toggleFullscreen: () => call('app:fullscreen'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  on
});
