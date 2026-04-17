const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let win = null;

// ── Fetch usage by running fetcher.js with system Node ─────────
function fetchUsage() {
  return new Promise((resolve) => {
    const fetcherPath = path.join(__dirname, 'fetcher.js');
    const child = spawn('node', [fetcherPath], {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env },
    });

    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });

    child.on('close', () => {
      try {
        const data = JSON.parse(stdout);
        resolve(data.error ? null : data);
      } catch {
        resolve(null);
      }
    });

    child.on('error', () => resolve(null));

    // Safety kill after 40s
    setTimeout(() => {
      try { child.kill(); } catch {}
    }, 40000);
  });
}

// ── Create window ──────────────────────────────────────────────
function createWindow() {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 340,
    height: 520,
    x: screenW - 360,
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: false,
    hasShadow: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('index.html');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.on('closed', () => { win = null; });

  // Uncomment to debug:
  // win.webContents.openDevTools({ mode: 'detach' });
}

// ── IPC ────────────────────────────────────────────────────────
ipcMain.handle('fetch-usage', () => fetchUsage());
ipcMain.on('window-minimize', () => { if (win) win.minimize(); });
ipcMain.on('window-close', () => { if (win) win.close(); });

// ── App lifecycle ──────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', () => app.quit());
