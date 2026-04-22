const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const zlib = require('zlib');
const { spawn } = require('child_process');
const { loadConfig } = require('./config');
const { readLocalUsage } = require('./localUsage');

let win = null;
let tray = null;
let latestUsage = null;
let latestCodex = null;
let isQuitting = false;

// ── PNG encoder (no deps) ──────────────────────────────────────
// Builds a 32x32 RGBA PNG with two horizontal bars that reflect
// session% (top) and week% (bottom).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgbaRowsWithFilter) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(rgbaRowsWithFilter);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

function colorForPct(pct) {
  if (pct == null) return [120, 120, 130];
  if (pct >= 75) return [239, 68, 68];
  if (pct >= 50) return [250, 204, 21];
  return [74, 222, 128];
}

function buildTrayIcon(sessionPct, weekPct) {
  const size = 32;
  const rowSize = 1 + size * 4;
  const raw = Buffer.alloc(rowSize * size);
  const empty = [60, 60, 70, 200];

  for (let y = 0; y < size; y++) {
    raw[y * rowSize] = 0;
    for (let x = 0; x < size; x++) {
      const i = y * rowSize + 1 + x * 4;
      raw[i + 3] = 0;
    }
  }

  const drawBar = (yStart, yEnd, pct) => {
    const [r, g, b] = colorForPct(pct);
    const barStart = 2, barEnd = size - 2;
    const barWidth = barEnd - barStart;
    const fillPx = pct == null ? 0 : Math.max(1, Math.round(barWidth * pct / 100));
    for (let y = yStart; y < yEnd; y++) {
      for (let x = barStart; x < barEnd; x++) {
        const i = y * rowSize + 1 + x * 4;
        const filled = (x - barStart) < fillPx;
        if (filled) { raw[i] = r; raw[i+1] = g; raw[i+2] = b; raw[i+3] = 255; }
        else { raw[i] = empty[0]; raw[i+1] = empty[1]; raw[i+2] = empty[2]; raw[i+3] = empty[3]; }
      }
    }
  };

  drawBar(6, 14, sessionPct);
  drawBar(18, 26, weekPct);

  return encodePng(size, size, raw);
}

// ── Fetch usage by running a fetcher script with system Node ───
function runFetcher(scriptName) {
  return new Promise((resolve) => {
    const fetcherPath = path.join(__dirname, scriptName);
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

    setTimeout(() => {
      try { child.kill(); } catch {}
    }, 40000);
  });
}

const fetchUsage = () => runFetcher('fetcher.js');
const fetchCodexUsage = () => runFetcher('codexFetcher.js');

// ── Tray ───────────────────────────────────────────────────────
function updateTray() {
  if (!tray) return;

  const s = latestUsage?.session?.pct;
  const w = latestUsage?.weekAll?.pct;
  const ws = latestUsage?.weekSonnet?.pct;
  const e = latestUsage?.extra;

  tray.setImage(nativeImage.createFromBuffer(buildTrayIcon(s ?? null, w ?? null)));

  const cx5 = latestCodex?.session5h?.pct;
  const cxw = latestCodex?.weekly?.pct;

  const tipLines = ['AI Usage'];
  tipLines.push('— Claude —');
  tipLines.push(s != null ? `Session: ${s}%` : 'Session: —');
  tipLines.push(w != null ? `Week (all): ${w}%` : 'Week (all): —');
  if (ws != null) tipLines.push(`Week (Sonnet): ${ws}%`);
  if (e) tipLines.push(`Extra: ${e.pct}% ($${e.spent} / $${e.total})`);
  if (cx5 != null || cxw != null) {
    tipLines.push('— Codex —');
    if (cx5 != null) tipLines.push(`5h limit: ${cx5}%`);
    if (cxw != null) tipLines.push(`Weekly: ${cxw}%`);
  }
  tray.setToolTip(tipLines.join('\n'));

  const menu = Menu.buildFromTemplate([
    { label: 'Claude', enabled: false },
    { label: s != null ? `  Session  ${s}%` : '  Session  —', enabled: false },
    { label: w != null ? `  Week (all)  ${w}%` : '  Week (all)  —', enabled: false },
    ...(ws != null ? [{ label: `  Week (Sonnet)  ${ws}%`, enabled: false }] : []),
    ...(e ? [{ label: `  Extra  ${e.pct}%  ($${e.spent}/$${e.total})`, enabled: false }] : []),
    ...(cx5Left != null || cxwLeft != null ? [
      { type: 'separator' },
      { label: 'Codex', enabled: false },
      ...(cx5Left != null ? [{ label: `  5h limit  ${cx5Left}%`, enabled: false }] : []),
      ...(cxwLeft != null ? [{ label: `  Weekly  ${cxwLeft}%`, enabled: false }] : []),
    ] : []),
    { type: 'separator' },
    { label: 'Show widget', click: () => showWindow() },
    { label: 'Refresh now', click: () => { if (win) win.webContents.send('trigger-refresh'); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function createTray() {
  tray = new Tray(nativeImage.createFromBuffer(buildTrayIcon(null, null)));
  tray.setToolTip('AI Usage — loading…');
  tray.on('click', () => {
    if (!win) { createWindow(); return; }
    if (win.isVisible()) win.hide(); else showWindow();
  });
  updateTray();
}

// ── Window ─────────────────────────────────────────────────────
function showWindow() {
  if (!win) { createWindow(); return; }
  win.show();
  win.focus();
}

function createWindow() {
  const { width: screenW } = screen.getPrimaryDisplay().workAreaSize;

  win = new BrowserWindow({
    width: 340,
    height: 860,
    x: screenW - 360,
    y: 20,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
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

  win.on('close', (e) => {
    if (!isQuitting) { e.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { win = null; });
}

// ── IPC ────────────────────────────────────────────────────────
ipcMain.handle('fetch-usage', () => fetchUsage());
ipcMain.handle('fetch-codex-usage', () => fetchCodexUsage());
ipcMain.handle('fetch-local-usage', () => readLocalUsage());
ipcMain.handle('get-config', () => loadConfig());
ipcMain.on('window-minimize', () => { if (win) win.hide(); });
ipcMain.on('window-close', () => { if (win) win.hide(); });
ipcMain.on('usage-updated', (_event, data) => {
  latestUsage = data;
  updateTray();
});
ipcMain.on('codex-usage-updated', (_event, data) => {
  latestCodex = data;
  updateTray();
});

// ── App lifecycle ──────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();
  createTray();
  app.on('activate', () => { if (!win) createWindow(); });
});

// Don't quit when the widget window is closed — tray keeps the app alive.
app.on('window-all-closed', (e) => { e.preventDefault(); });
app.on('before-quit', () => { isQuitting = true; });
