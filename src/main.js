const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const path = require('path');
const fetch = require('cross-fetch');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');

// Privacy & Performance Command Line Switches
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'default_public_interface_only');
app.commandLine.appendSwitch('enable-features', 'DnsOverHttps');
app.commandLine.appendSwitch('disable-breakpad'); // Disable crash reporting
app.commandLine.appendSwitch('no-default-browser-check');

let mainWindow = null;
let adBlocker = null;
let blockedStats = {
  totalBlocked: 0,
  trackersBlocked: 0,
  adsBlocked: 0
};

// Tabs state
const tabs = new Map();
let activeTabId = null;
let nextTabId = 1;
const TOOLBAR_HEIGHT = 80;

// Initialize AdBlocker & Privacy Protection (Mullvad + Brave style)
async function initAdBlocker(sess) {
  try {
    adBlocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
    adBlocker.enableBlockingInSession(sess);

    adBlocker.on('request-blocked', (request) => {
      blockedStats.totalBlocked++;
      if (request.type === 'script' || request.url.includes('track') || request.url.includes('analytics')) {
        blockedStats.trackersBlocked++;
      } else {
        blockedStats.adsBlocked++;
      }
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('shield-stats-updated', blockedStats);
      }
    });

    console.log('[Starbish Shield] Ad & Tracker Blocker initialized successfully.');
  } catch (err) {
    console.error('[Starbish Shield] Failed to initialize ad blocker:', err);
  }
}

// Configure Strict Privacy Session Headers
function setupPrivacySession(sess) {
  // Inject Do Not Track & Global Privacy Control headers
  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['DNT'] = '1';
    details.requestHeaders['Sec-GPC'] = '1';
    callback({ requestHeaders: details.requestHeaders });
  });

  // Configure Encrypted DNS (DoH) - Mullvad Ad-blocking DNS
  try {
    app.configureHostResolver({
      enableBuiltInResolver: true,
      secureDnsMode: 'secure',
      secureDnsServers: [
        'https://adblock.dns.mullvad.net/dns-query',
        'https://dns.quad9.net/dns-query'
      ]
    });
    console.log('[Starbish Privacy] Secure DNS over HTTPS configured.');
  } catch (e) {
    console.warn('[Starbish Privacy] DoH configuration notice:', e.message);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#080a10',
    title: 'Starbish Browser',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'ui/index.html'));

  mainWindow.on('resize', () => {
    updateActiveViewBounds();
  });

  mainWindow.webContents.on('did-finish-load', () => {
    // Create initial tab
    createNewTab('https://www.bing.com');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    tabs.clear();
  });
}

function updateActiveViewBounds() {
  if (!mainWindow || !activeTabId) return;
  const tab = tabs.get(activeTabId);
  if (!tab || !tab.view) return;

  const [width, height] = mainWindow.getContentSize();
  tab.view.setBounds({
    x: 0,
    y: TOOLBAR_HEIGHT,
    width: width,
    height: Math.max(0, height - TOOLBAR_HEIGHT)
  });
}

function createNewTab(initialUrl = 'https://www.bing.com') {
  const id = nextTabId++;
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      sandbox: true
    }
  });

  const tab = {
    id,
    url: initialUrl,
    title: 'New Tab',
    view,
    canGoBack: false,
    canGoForward: false,
    isLoading: false
  };

  tabs.set(id, tab);

  // Wire view events
  view.webContents.on('did-start-loading', () => {
    tab.isLoading = true;
    notifyTabUpdate(tab);
  });

  view.webContents.on('did-stop-loading', () => {
    tab.isLoading = false;
    tab.canGoBack = view.webContents.navigationHistory ? view.webContents.navigationHistory.canGoBack() : view.webContents.canGoBack();
    tab.canGoForward = view.webContents.navigationHistory ? view.webContents.navigationHistory.canGoForward() : view.webContents.canGoForward();
    tab.url = view.webContents.getURL();
    notifyTabUpdate(tab);
  });

  view.webContents.on('page-title-updated', (e, title) => {
    tab.title = title || 'Starbish Tab';
    notifyTabUpdate(tab);
  });

  view.webContents.on('did-navigate', (e, url) => {
    tab.url = url;
    notifyTabUpdate(tab);
  });

  view.webContents.on('did-navigate-in-page', (e, url) => {
    tab.url = url;
    notifyTabUpdate(tab);
  });

  // Handle target=_blank or window.open
  view.webContents.setWindowOpenHandler(({ url }) => {
    createNewTab(url);
    return { action: 'deny' };
  });

  view.webContents.loadURL(initialUrl);

  // Switch to this new tab
  switchTab(id);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-created', {
      id: tab.id,
      url: tab.url,
      title: tab.title
    });
  }

  return tab;
}

function switchTab(id) {
  if (!tabs.has(id)) return;

  // Detach previous view
  if (activeTabId && tabs.has(activeTabId)) {
    const prev = tabs.get(activeTabId);
    if (prev && prev.view && mainWindow.contentView.children.includes(prev.view)) {
      mainWindow.contentView.removeChildView(prev.view);
    }
  }

  activeTabId = id;
  const current = tabs.get(id);

  if (mainWindow && current && current.view) {
    mainWindow.contentView.addChildView(current.view);
    updateActiveViewBounds();
  }

  notifyTabUpdate(current);
}

function closeTab(id) {
  if (!tabs.has(id)) return;
  const tab = tabs.get(id);

  if (tab.view && mainWindow.contentView.children.includes(tab.view)) {
    mainWindow.contentView.removeChildView(tab.view);
  }

  tabs.delete(id);

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('tab-closed', id);
  }

  // If closed tab was active, switch to another
  if (activeTabId === id) {
    const remainingIds = Array.from(tabs.keys());
    if (remainingIds.length > 0) {
      switchTab(remainingIds[remainingIds.length - 1]);
    } else {
      // Create fresh new tab
      createNewTab('https://www.bing.com');
    }
  }
}

function notifyTabUpdate(tab) {
  if (!mainWindow || mainWindow.isDestroyed() || !tab) return;
  mainWindow.webContents.send('tab-updated', {
    id: tab.id,
    url: tab.url,
    title: tab.title,
    isLoading: tab.isLoading,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
    isActive: tab.id === activeTabId
  });
}

function navigateActiveTab(input) {
  if (!activeTabId || !tabs.has(activeTabId)) return;
  const tab = tabs.get(activeTabId);
  if (!tab || !tab.view) return;

  let targetUrl = input.trim();

  // If it's a URL or domain
  const isUrl = /^(https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(:\d+)?(\/.*)?$/i.test(targetUrl) ||
                /^localhost(:\d+)?/i.test(targetUrl) ||
                /^file:\/\//i.test(targetUrl);

  if (isUrl) {
    if (!/^https?:\/\//i.test(targetUrl) && !/^file:\/\//i.test(targetUrl)) {
      targetUrl = 'https://' + targetUrl;
    }
  } else {
    // Default search engine: BING
    targetUrl = `https://www.bing.com/search?q=${encodeURIComponent(targetUrl)}`;
  }

  tab.view.webContents.loadURL(targetUrl);
}

// IPC Handlers
ipcMain.handle('navigate', (e, input) => {
  navigateActiveTab(input);
});

ipcMain.handle('new-tab', (e, url) => {
  createNewTab(url || 'https://www.bing.com');
});

ipcMain.handle('switch-tab', (e, id) => {
  switchTab(id);
});

ipcMain.handle('close-tab', (e, id) => {
  closeTab(id);
});

ipcMain.handle('go-back', () => {
  if (activeTabId && tabs.has(activeTabId)) {
    const tab = tabs.get(activeTabId);
    if (tab.view) {
      if (tab.view.webContents.navigationHistory) {
        if (tab.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack();
      } else if (tab.view.webContents.canGoBack()) {
        tab.view.webContents.goBack();
      }
    }
  }
});

ipcMain.handle('go-forward', () => {
  if (activeTabId && tabs.has(activeTabId)) {
    const tab = tabs.get(activeTabId);
    if (tab.view) {
      if (tab.view.webContents.navigationHistory) {
        if (tab.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward();
      } else if (tab.view.webContents.canGoForward()) {
        tab.view.webContents.goForward();
      }
    }
  }
});

ipcMain.handle('reload', () => {
  if (activeTabId && tabs.has(activeTabId)) {
    const tab = tabs.get(activeTabId);
    if (tab.view) {
      tab.view.webContents.reload();
    }
  }
});

// Mullvad Amnesic Reset ("New Identity")
ipcMain.handle('reset-identity', async () => {
  const defaultSess = session.defaultSession;
  await defaultSess.clearStorageData({
    storages: ['cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage']
  });
  await defaultSess.clearCache();
  blockedStats = { totalBlocked: 0, trackersBlocked: 0, adsBlocked: 0 };

  // Reload all active tabs clean
  for (const [id, tab] of tabs) {
    if (tab.view) {
      tab.view.webContents.loadURL('https://www.bing.com');
    }
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('shield-stats-updated', blockedStats);
  }

  return { success: true };
});

ipcMain.handle('get-shield-stats', () => {
  return blockedStats;
});

// App lifecycle
app.whenReady().then(async () => {
  setupPrivacySession(session.defaultSession);
  await initAdBlocker(session.defaultSession);
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', async () => {
  // Amnesic policy: Clean session storage on exit (Mullvad Browser feature)
  try {
    await session.defaultSession.clearStorageData({
      storages: ['cookies', 'localstorage', 'cachestorage', 'websql']
    });
  } catch (_) {}
  if (process.platform !== 'darwin') app.quit();
});
