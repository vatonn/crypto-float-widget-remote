'use strict';

const { app, BrowserWindow, ipcMain, Notification, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const Store = require('./store');
const { applyAcrylic } = require('./acrylic');
const { isLeftButtonDown } = require('./cursor');
const { RemoteFeed, testServer } = require('./remote');

app.setAppUserModelId('com.trae.crypto-float-widget-remote');

const DIAG_FILE = 'diag.log';
function diag(line) {
  try {
    const file = path.join(app.getPath('userData'), DIAG_FILE);
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* ignore */
  }
}

const store = new Store();
let config = store.get();
let win = null;
let feed = null;
let acrylicOk = false;
let positionTimer = null;

let latest = new Map();
const pending = new Map();
const history = new Map();
const lastAlert = new Map();

const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 140;
const MAX_WIDTH = 680;
const MAX_HEIGHT = 760;

let programmaticResize = false;
let sizeTimer = null;

// ---------- 窗口 ----------

function clampToScreen(x, y, w, h) {
  const displays = screen.getAllDisplays();
  const area = displays.reduce((acc, d) => {
    const b = d.workArea;
    if (x >= b.x - 40 && x <= b.x + b.width - 40 && y >= b.y - 40 && y <= b.y + b.height - 40) return b;
    return acc;
  }, screen.getPrimaryDisplay().workArea);
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - w),
    y: Math.min(Math.max(y, area.y), area.y + area.height - h)
  };
}

function createWindow() {
  const manual = !!(config.manualSize && config.size);
  const width = manual ? config.size.width : DEFAULT_WIDTH;
  const height = manual ? config.size.height : 120;
  const pos = config.position
    ? clampToScreen(config.position.x, config.position.y, width, height)
    : { x: undefined, y: undefined };

  win = new BrowserWindow({
    width,
    height,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    maxWidth: MAX_WIDTH,
    maxHeight: MAX_HEIGHT,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: false,
    alwaysOnTop: !!config.alwaysOnTop,
    show: false,
    title: '行情浮窗',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    acrylicOk = config.blur ? applyAcrylic(win, { state: 'blur' }) : false;
    if (config.blur && !acrylicOk) win.setBackgroundColor('#141418');
    win.webContents.send('window:acrylic', acrylicOk);
    win.setMovable(true);
    win.show();
    win.focus();
    disableClickThrough();
    diag(`window shown acrylic=${acrylicOk} blur=${config.blur}`);
    console.log('[window] acrylic =', acrylicOk, 'blur =', config.blur);
  });

  win.on('resize', () => {
    if (!win || win.isDestroyed()) return;
    if (programmaticResize) return;
    const [w, h] = win.getSize();
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => {
      config = store.set({ manualSize: true, size: { width: w, height: h } });
      broadcast('config', config);
    }, 300);
  });

  win.on('moved', () => {
    clearTimeout(positionTimer);
    positionTimer = setTimeout(() => {
      const [x, y] = win.getPosition();
      config = store.set({ position: { x, y } });
    }, 400);
    placeSettingsWindow();
  });

  win.on('focus', () => diag('window focus'));
  win.on('blur', () => diag('window blur'));

  win.on('closed', () => {
    closeSettings();
    win = null;
  });
}

// ---------- 设置小窗 ----------

let settingsWin = null;

function placeSettingsWindow() {
  if (!settingsWin || settingsWin.isDestroyed() || !win || win.isDestroyed()) return;
  const main = win.getBounds();
  const area = screen.getDisplayMatching(main).workArea;
  const [w, h] = settingsWin.getSize();
  let x = main.x - w - 8;
  if (x < area.x) x = Math.min(main.x + main.width + 8, area.x + area.width - w);
  const y = Math.min(Math.max(main.y, area.y), area.y + area.height - h);
  settingsWin.setPosition(Math.round(x), Math.round(y));
}

function openSettings() {
  if (!win || win.isDestroyed()) return;
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return;
  }

  settingsWin = new BrowserWindow({
    width: 320,
    height: 320,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    parent: win,
    show: false,
    title: '设置',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  settingsWin.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));

  settingsWin.once('ready-to-show', () => {
    placeSettingsWindow();
    settingsWin.show();
    settingsWin.focus();
    if (win) win.webContents.send('settings:visible', true);
  });

  settingsWin.on('closed', () => {
    settingsWin = null;
    if (win && !win.isDestroyed()) win.webContents.send('settings:visible', false);
  });
}

function closeSettings() {
  if (!settingsWin || settingsWin.isDestroyed()) return;
  settingsWin.close();
}

function toggleSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) closeSettings();
  else openSettings();
}

/**
 * Windows 上 setIgnoreMouseEvents(true, { forward: true }) 会让窗口长期吞掉点击与拖拽，
 * 且 DPI 缩放下光标命中判断不稳定，这里不再做整窗穿透：
 * 窗口始终接收鼠标事件，保证拖拽与点击可用。
 */
function disableClickThrough() {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(false);
}

function getLimits() {
  const bounds = win && !win.isDestroyed() ? win.getBounds() : screen.getPrimaryDisplay().bounds;
  const area = screen.getDisplayMatching(bounds).workArea;
  return {
    minWidth: MIN_WIDTH,
    maxWidth: MAX_WIDTH,
    minHeight: MIN_HEIGHT,
    maxHeight: Math.min(MAX_HEIGHT, area.height - 40),
    manualSize: !!config.manualSize
  };
}

function resizeToContent(height) {
  if (!win || win.isDestroyed()) return;
  if (config.manualSize) return;
  const b = win.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const maxHeight = Math.min(MAX_HEIGHT, area.height - 40);
  const clamped = Math.max(MIN_HEIGHT, Math.min(Math.round(height), maxHeight));
  programmaticResize = true;
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: clamped });
  setTimeout(() => {
    programmaticResize = false;
  }, 50);
}

// ---------- 手动缩放（右下角手柄） ----------

let resizeTimer = null;
let resizeOrigin = null;

function startResize() {
  if (!win || win.isDestroyed() || resizeTimer) return;
  const start = screen.screenToDipPoint(screen.getCursorScreenPoint());
  resizeOrigin = { start, b: win.getBounds() };
  resizeTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !isLeftButtonDown()) {
      endResize();
      return;
    }
    const p = screen.screenToDipPoint(screen.getCursorScreenPoint());
    const width = Math.max(
      MIN_WIDTH,
      Math.min(MAX_WIDTH, Math.round(resizeOrigin.b.width + p.x - resizeOrigin.start.x))
    );
    const height = Math.max(
      MIN_HEIGHT,
      Math.min(MAX_HEIGHT, Math.round(resizeOrigin.b.height + p.y - resizeOrigin.start.y))
    );
    programmaticResize = true;
    win.setBounds({ x: resizeOrigin.b.x, y: resizeOrigin.b.y, width, height });
    programmaticResize = false;
  }, 16);
}

function endResize() {
  if (!resizeTimer) return;
  clearInterval(resizeTimer);
  resizeTimer = null;
  resizeOrigin = null;
  if (!win || win.isDestroyed()) return;
  const [width, height] = win.getSize();
  config = store.set({ manualSize: true, size: { width, height } });
  broadcast('config', config);
}

function broadcast(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send(channel, payload);
}

// ---------- 数据 ----------

function startFeed() {
  feed = new RemoteFeed({
    serverUrl: config.serverUrl,
    coins: config.coins
  });

  feed.on('ticker', (t) => {
    latest.set(t.symbol, t);
    pending.set(t.symbol, t);
    checkRapidMove(t);
    checkPriceAlert(t);
  });

  feed.on('state', (s) => broadcast('feed:state', s));

  feed.on('log', (line) => console.log('[feed]', line));

  feed.on('contracts', (list) => broadcast('contracts', list));

  feed.start();
}

setInterval(() => {
  if (!pending.size) return;
  const batch = Array.from(pending.values());
  pending.clear();
  broadcast('prices', batch);
}, 250);

// 定期推送连接状态，便于界面及时反映延迟/断开
setInterval(() => {
  if (!feed) return;
  broadcast('feed:state', feed.statePayload());
}, 2000);

// ---------- 提醒 ----------

function notify(title, body) {
  if (!Notification.isSupported()) return;
  new Notification({ title, body, silent: false }).show();
}

function cooldownOk(key, ms) {
  const now = Date.now();
  if (now - (lastAlert.get(key) || 0) < ms) return false;
  lastAlert.set(key, now);
  return true;
}

function checkRapidMove(t) {
  const { pct, windowSec, cooldownSec } = config.rapidMove;
  const arr = history.get(t.symbol) || [];
  arr.push({ t: t.ts, p: t.price });
  const cutoff = Date.now() - windowSec * 1000;
  while (arr.length && arr[0].t < cutoff) arr.shift();
  history.set(t.symbol, arr);
  if (arr.length < 3) return;

  let min = Infinity;
  let max = -Infinity;
  for (const a of arr) {
    if (a.p < min) min = a.p;
    if (a.p > max) max = a.p;
  }
  if (!(max > min)) return;

  const up = (t.price / min - 1) * 100;
  const down = (1 - t.price / max) * 100;
  let dir = null;
  let delta = 0;
  if (up >= pct) {
    dir = 'up';
    delta = up;
  } else if (down >= pct) {
    dir = 'down';
    delta = down;
  }
  if (!dir) return;
  if (!cooldownOk(`${t.symbol}:rapid`, cooldownSec * 1000)) return;

  const name = t.symbol.replace('USDT', '');
  const text = `${name} ${windowSec}s 内急${dir === 'up' ? '涨' : '跌'} ${delta.toFixed(2)}%`;
  notify('急涨急跌提醒', `${text}\n现价 ${t.price}`);
  broadcast('alert', { symbol: t.symbol, kind: dir, text });
}

function checkPriceAlert(t) {
  const rule = config.priceAlerts[t.symbol];
  if (!rule) return;
  const name = t.symbol.replace('USDT', '');
  if (rule.above && t.price >= rule.above && cooldownOk(`${t.symbol}:above`, 300000)) {
    notify('价格提醒', `${name} 已涨破 ${rule.above}\n现价 ${t.price}`);
    broadcast('alert', { symbol: t.symbol, kind: 'up', text: `${name} 涨破 ${rule.above}` });
  }
  if (rule.below && t.price <= rule.below && cooldownOk(`${t.symbol}:below`, 300000)) {
    notify('价格提醒', `${name} 已跌破 ${rule.below}\n现价 ${t.price}`);
    broadcast('alert', { symbol: t.symbol, kind: 'down', text: `${name} 跌破 ${rule.below}` });
  }
}

// ---------- IPC ----------

ipcMain.handle('boot:get', () => ({
  config,
  acrylic: acrylicOk,
  version: app.getVersion(),
  limits: getLimits(),
  snapshot: feed ? feed.snapshot() : null,
  prices: Array.from(latest.values())
}));

ipcMain.on('window:resize', (_e, height) => resizeToContent(height));
ipcMain.on('window:close', () => app.quit());
ipcMain.on('resize:start', () => startResize());
ipcMain.on('settings:toggle', () => toggleSettings());
ipcMain.on('settings:close', () => closeSettings());
ipcMain.on('search:open', () => {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    win.webContents.send('open-search');
  }
});
ipcMain.on('settings:resize', (_e, height) => {
  if (!settingsWin || settingsWin.isDestroyed()) return;
  const [x, y] = settingsWin.getPosition();
  const area = screen.getDisplayMatching(settingsWin.getBounds()).workArea;
  const h = Math.max(160, Math.min(Math.round(height), area.height - 40));
  settingsWin.setBounds({ x, y, width: 320, height: h });
});
ipcMain.on('diag', (_e, payload) => diag(`renderer ${JSON.stringify(payload)}`));

ipcMain.handle('config:set', (_e, patch) => {
  config = store.set(patch);
  if ('alwaysOnTop' in patch) win && win.setAlwaysOnTop(config.alwaysOnTop);
  if ('blur' in patch && win) {
    acrylicOk = config.blur ? applyAcrylic(win, { state: 'blur' }) : false;
    if (!config.blur) applyAcrylic(win, { state: 'none' });
    win.webContents.send('window:acrylic', acrylicOk);
  }
  if ('serverUrl' in patch && feed) {
    latest.clear();
    feed.restart(config.serverUrl, config.coins);
  }
  broadcast('config', config);
  return config;
});

ipcMain.handle('coin:reorder', (_e, order) => {
  if (!Array.isArray(order)) return config;
  const next = order.filter((s) => config.coins.includes(s));
  if (next.length !== config.coins.length) return config;
  config = store.set({ coins: next });
  broadcast('config', config);
  return config;
});

ipcMain.handle('coin:search', async (_e, query) => {
  if (!feed) return [];
  try {
    return await feed.search(query);
  } catch (err) {
    console.log('[search]', err.message);
    return [];
  }
});

ipcMain.handle('coin:add', (_e, symbol) => {
  if (!feed || config.coins.includes(symbol)) return config;
  config = store.set({ coins: [...config.coins, symbol] });
  feed.setCoins(config.coins);
  broadcast('config', config);
  return config;
});

ipcMain.handle('coin:remove', (_e, symbol) => {
  if (!feed) return config;
  const coins = config.coins.filter((s) => s !== symbol);
  if (!coins.length) return config;
  config = store.set({ coins });
  feed.setCoins(coins);
  latest.delete(symbol);
  broadcast('config', config);
  return config;
});

ipcMain.handle('alert:set', (_e, { symbol, above, below }) => {
  const priceAlerts = { ...config.priceAlerts };
  if (!above && !below) delete priceAlerts[symbol];
  else priceAlerts[symbol] = { above: Number(above) || 0, below: Number(below) || 0 };
  config = store.set({ priceAlerts });
  broadcast('config', config);
  return config;
});

ipcMain.handle('feed:retry', async () => {
  if (!feed) return null;
  latest.clear();
  await feed.restart(config.serverUrl, config.coins);
  return feed.statePayload();
});

ipcMain.handle('server:test', async (_e, serverUrl) => testServer(serverUrl));

// ---------- 生命周期 ----------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    startFeed();
  });

  app.on('window-all-closed', () => {
    if (feed) feed.stop();
    app.quit();
  });
}
