// Standalone fetcher — runs with system Node.js + node-pty.
// Outputs JSON to stdout, then exits.
const os = require('os');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// ── Find claude binary cross-platform ──────────────────────────
function findClaude() {
  const home = os.homedir();
  const candidates = process.platform === 'win32'
    ? [
        path.join(home, '.local', 'bin', 'claude.exe'),
        path.join(home, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
      ]
    : [
        path.join(home, '.local', 'bin', 'claude'),
        path.join(home, '.claude', 'local', 'claude'),
        '/usr/local/bin/claude',
        '/usr/bin/claude',
      ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  try {
    const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
    return execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0].trim();
  } catch {
    return null;
  }
}

// ── Strip ANSI ─────────────────────────────────────────────────
function stripAnsi(str) {
  return str
    .replace(/\x1b\[\d+[ABCD]/g, ' ')
    .replace(/\x1b\[\d+;\d+[Hf]/g, ' ')
    .replace(/\x1b\[\??[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/\x1b[>=<]/g, '')
    .replace(/\x1b\[>[0-9;]*[a-zA-Z]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

// ── Parse ──────────────────────────────────────────────────────
function parseUsage(raw) {
  const clean = stripAnsi(raw).replace(/\s+/g, ' ');
  const data = {};

  const sm = clean.match(/Current\s*session\s*[█▌░\s]*(\d+)\s*%\s*used\s*Rese?t?s?\s*s?\s*(.+?)(?=Current|Extra|Esc|What|$)/i);
  if (sm) data.session = { pct: +sm[1], resets: sm[2].trim() };

  const wm = clean.match(/Current\s*week\s*\(all\s*models?\)\s*[█▌░\s]*(\d+)\s*%\s*used\s*Rese?t?s?\s*(.+?)(?=Current|Extra|Esc|What|$)/i);
  if (wm) data.weekAll = { pct: +wm[1], resets: wm[2].trim() };

  const ws = clean.match(/Current\s*week\s*\(Sonnet\s*only\)\s*[█▌░\s]*(\d+)\s*%\s*used/i);
  if (ws) data.weekSonnet = { pct: +ws[1] };

  const em = clean.match(/Extra\s*usage\s*[█▌░▏\s]*(\d+)\s*%\s*used\s*\$?\s*([\d.]+)\s*\/\s*\$?\s*([\d.]+)\s*spent\s*·?\s*Rese?t?s?\s*(.+?)(?=Esc|Last|$)/i);
  if (em) data.extra = { pct: +em[1], spent: em[2], total: em[3], resets: em[4].trim() };

  const im = clean.match(/(\d+)\s*%\s*of\s*your\s*usage\s*was\s*while\s*(\d+\+?\s*sessions?\s*ran\s*in\s*parallel)/i);
  if (im) data.insight = `${im[1]}% of your usage was while ${im[2]}`;

  return (data.session || data.weekAll || data.extra) ? data : null;
}

// ── Main ───────────────────────────────────────────────────────
async function main() {
  const claudePath = findClaude();
  if (!claudePath) {
    process.stdout.write(JSON.stringify({ error: 'claude not found' }));
    process.exit(1);
  }

  let pty;
  try {
    pty = require('node-pty');
  } catch {
    // Fallback: try loading from the temp install used by get_usage.js
    const fallback = path.join(os.tmpdir(), 'usage-script', 'node_modules', 'node-pty');
    try { pty = require(fallback); } catch {
      process.stdout.write(JSON.stringify({ error: 'node-pty not found' }));
      process.exit(1);
    }
  }

  let output = '';
  const proc = pty.spawn(claudePath, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 50,
    cwd: path.join(os.homedir(), 'Desktop'),
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  proc.onData((d) => { output += d; });

  setTimeout(() => proc.write('/usage\r'), 8000);

  setTimeout(() => {
    const data = parseUsage(output);
    proc.write('\x1b');
    setTimeout(() => {
      proc.write('/exit\r');
      setTimeout(() => {
        try { proc.kill(); } catch {}
        process.stdout.write(JSON.stringify(data || { error: 'parse failed' }));
        process.exit(0);
      }, 2000);
    }, 1000);
  }, 20000);

  setTimeout(() => {
    try { proc.kill(); } catch {}
    const data = parseUsage(output);
    process.stdout.write(JSON.stringify(data || { error: 'timeout' }));
    process.exit(0);
  }, 35000);
}

main();
