const { app, BrowserWindow, ipcMain, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

const cfgFile = () => path.join(app.getPath('userData'), 'window.json');
const loadCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch (e) { return {}; } };
let win;

function create() {
  const cfg = loadCfg();
  win = new BrowserWindow({
    width: cfg.width || 310, height: cfg.height || 900, x: cfg.x, y: cfg.y,
    minWidth: 240, minHeight: 360,
    title: 'Yekta Light',
    backgroundColor: '#232326',
    alwaysOnTop: cfg.pin !== false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'app', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (cfg.pin !== false) win.setAlwaysOnTop(true, 'floating');
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  const save = () => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    try { fs.writeFileSync(cfgFile(), JSON.stringify({ ...b, pin: win.isAlwaysOnTop() })); } catch (e) { /* ignore */ }
  };
  win.on('resized', save); win.on('moved', save); win.on('close', save);
}

ipcMain.handle('clip:write', (_e, t) => { clipboard.writeText(t); return true; });
ipcMain.handle('clip:read', () => clipboard.readText());
ipcMain.handle('pin:set', (_e, on) => { win.setAlwaysOnTop(on, 'floating'); return on; });
ipcMain.handle('pin:get', () => win.isAlwaysOnTop());

app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
