const os = require('os');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { loadConfig } = require('./config');

let pty;
try {
  pty = require('node-pty');
} catch {
  console.error('node-pty not found. Run `npm install` first.');
  process.exit(1);
}

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
  for (const p of candidates) if (fs.existsSync(p)) return p;
  try {
    const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
    return execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0].trim();
  } catch { return null; }
}

const CLAUDE_PATH = findClaude();
if (!CLAUDE_PATH) {
  console.error('claude binary not found. Install Claude Code and run `claude` once to log in.');
  process.exit(1);
}

// ── State ──────────────────────────────────────────────────────
let usageData = null;   // parsed data from last fetch
let lastFetch = null;   // Date of last successful fetch
let fetching = false;
const REFRESH_MS = loadConfig().refreshMinutes * 60 * 1000;
// Tracks `${section}:${resetsString}` pairs we've already force-refreshed for,
// so a countdown that sits at "Now!" doesn't re-trigger every tick.
const firedResets = new Set();

// ── ANSI helpers ───────────────────────────────────────────────
const CLR  = '\x1b[2J\x1b[H';      // clear screen + cursor home
const BOLD = '\x1b[1m';
const DIM  = '\x1b[90m';
const CYAN = '\x1b[36m';
const YEL  = '\x1b[33m';
const GRN  = '\x1b[32m';
const RED  = '\x1b[31m';
const RST  = '\x1b[0m';
const HIDE = '\x1b[?25l';
const SHOW = '\x1b[?25h';

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

// ── Bar renderer ───────────────────────────────────────────────
function makeBar(pct, width = 30) {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  let color = GRN;
  if (pct >= 75) color = RED;
  else if (pct >= 50) color = YEL;
  return `${color}${'█'.repeat(filled)}${DIM}${'░'.repeat(empty)}${RST} ${pct}%`;
}

// ── Countdown helpers ──────────────────────────────────────────
function parseResetDate(resetStr) {
  // Handles: "5pm (America/Buenos_Aires)" → today at 17:00 ART
  //          "Apr 23, 4pm (America/Buenos_Aires)" → Apr 23 at 16:00 ART
  //          "May 1 (America/Buenos_Aires)" → May 1 at 00:00 ART
  const tz = 'America/Buenos_Aires';
  const now = new Date();

  // Extract time like "5pm" or "4pm"
  const timeMatch = resetStr.match(/(\d{1,2})\s*(am|pm)/i);
  let hour = 0;
  if (timeMatch) {
    hour = parseInt(timeMatch[1]);
    if (timeMatch[2].toLowerCase() === 'pm' && hour !== 12) hour += 12;
    if (timeMatch[2].toLowerCase() === 'am' && hour === 12) hour = 0;
  }

  // Extract date like "Apr 23" or "May 1"
  const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const dateMatch = resetStr.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})/i);

  let target;
  if (dateMatch) {
    const month = months[dateMatch[1].toLowerCase()];
    const day = parseInt(dateMatch[2]);
    target = new Date(now.getFullYear(), month, day, hour, 0, 0);
    // If the target is far in the past, it's probably next year
    if (target < now && (now - target) > 180 * 24 * 3600 * 1000) {
      target.setFullYear(target.getFullYear() + 1);
    }
  } else {
    // No date → today at the given hour
    target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0);
    // If already past, it means tomorrow (for session resets)
    if (target <= now) {
      target.setDate(target.getDate() + 1);
    }
  }

  // ART is UTC-3. We built the Date in local time.
  // Convert: the reset is at `hour` in ART. Our local offset might differ.
  const localOffsetMin = now.getTimezoneOffset();  // minutes, positive = behind UTC
  const artOffsetMin = 180; // ART = UTC-3 = +180 minutes behind UTC
  const diffMin = artOffsetMin - localOffsetMin;
  target = new Date(target.getTime() + diffMin * 60 * 1000);

  return target;
}

function formatCountdown(ms) {
  if (ms <= 0) return `${BOLD}${GRN}Now!${RST}`;
  const totalSec = Math.floor(ms / 1000);
  const days  = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins  = Math.floor((totalSec % 3600) / 60);
  const secs  = totalSec % 60;

  const parts = [];
  if (days > 0)  parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0)  parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  return parts.join(' ');
}

// ── Parse raw PTY output into structured data ──────────────────
function parseUsage(raw) {
  const clean = stripAnsi(raw).replace(/\s+/g, ' ');
  const data = {};

  const sessionMatch = clean.match(/Current\s*session\s*[█▌░\s]*(\d+)\s*%\s*used\s*Rese?t?s?\s*s?\s*(.+?)(?=Current|Extra|Esc|What|$)/i);
  if (sessionMatch) {
    data.session = { pct: parseInt(sessionMatch[1]), resets: sessionMatch[2].replace(/\s+/g, ' ').trim() };
  }

  const weekAllMatch = clean.match(/Current\s*week\s*\(all\s*models?\)\s*[█▌░\s]*(\d+)\s*%\s*used\s*Rese?t?s?\s*(.+?)(?=Current|Extra|Esc|What|$)/i);
  if (weekAllMatch) {
    data.weekAll = { pct: parseInt(weekAllMatch[1]), resets: weekAllMatch[2].replace(/\s+/g, ' ').trim() };
  }

  const weekSonnetMatch = clean.match(/Current\s*week\s*\(Sonnet\s*only\)\s*[█▌░\s]*(\d+)\s*%\s*used/i);
  if (weekSonnetMatch) {
    data.weekSonnet = { pct: parseInt(weekSonnetMatch[1]) };
  }

  const extraMatch = clean.match(/Extra\s*usage\s*[█▌░▏\s]*(\d+)\s*%\s*used\s*\$?\s*([\d.]+)\s*\/\s*\$?\s*([\d.]+)\s*spent\s*·?\s*Rese?t?s?\s*(.+?)(?=Esc|Last|$)/i);
  if (extraMatch) {
    data.extra = {
      pct: parseInt(extraMatch[1]),
      spent: extraMatch[2],
      total: extraMatch[3],
      resets: extraMatch[4].replace(/\s+/g, ' ').trim()
    };
  }

  const insightMatch = clean.match(/(\d+)\s*%\s*of\s*your\s*usage\s*was\s*while\s*(\d+\+?\s*sessions?\s*ran\s*in\s*parallel)/i);
  if (insightMatch) {
    data.insight = `${insightMatch[1]}% of your usage was while ${insightMatch[2]}`;
  }

  return (data.session || data.weekAll || data.extra) ? data : null;
}

// ── Fetch usage via PTY ────────────────────────────────────────
function fetchUsage() {
  return new Promise((resolve) => {
    if (fetching) return resolve(null);
    fetching = true;

    let output = '';
    const proc = pty.spawn(CLAUDE_PATH, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 50,
      cwd: path.join(os.homedir(), 'Desktop'),
      env: { ...process.env, TERM: 'xterm-256color' }
    });

    proc.onData((data) => { output += data; });

    // Send /usage after startup
    setTimeout(() => proc.write('/usage\r'), 8000);

    // Capture and exit
    setTimeout(() => {
      const data = parseUsage(output);
      // Close claude
      proc.write('\x1b');
      setTimeout(() => {
        proc.write('/exit\r');
        setTimeout(() => {
          try { proc.kill(); } catch(e) {}
          fetching = false;
          resolve(data);
        }, 2000);
      }, 1000);
    }, 20000);

    // Safety
    setTimeout(() => {
      try { proc.kill(); } catch(e) {}
      fetching = false;
      resolve(parseUsage(output));
    }, 35000);
  });
}

// ── Render dashboard ───────────────────────────────────────────
function render() {
  const now = new Date();
  const sep = `${DIM}${'─'.repeat(54)}${RST}`;
  let lines = [];
  let forceRefresh = false;

  const checkExpired = (section, resetsStr) => {
    const key = `${section}:${resetsStr}`;
    if (!firedResets.has(key)) {
      firedResets.add(key);
      forceRefresh = true;
    }
  };

  lines.push('');
  lines.push(`${BOLD}${CYAN}  ☁  Claude Code Usage Dashboard${RST}`);
  lines.push(sep);

  if (!usageData) {
    lines.push(`  ${DIM}Fetching usage data...${RST}`);
    lines.push(sep);
  } else {
    // ── Current Session ──
    if (usageData.session) {
      const d = usageData.session;
      const target = parseResetDate(d.resets);
      const remaining = target - now;
      if (remaining <= 0) checkExpired('session', d.resets);
      const cd = formatCountdown(remaining);
      lines.push(`${BOLD}  Current Session${RST}`);
      lines.push(`  ${makeBar(d.pct)}`);
      lines.push(`  ${DIM}Resets in:${RST} ${BOLD}${cd}${RST}`);
      lines.push('');
    }

    // ── Weekly (All Models) ──
    if (usageData.weekAll) {
      const d = usageData.weekAll;
      const target = parseResetDate(d.resets);
      const remaining = target - now;
      if (remaining <= 0) checkExpired('weekAll', d.resets);
      const cd = formatCountdown(remaining);
      lines.push(`${BOLD}  Weekly (All Models)${RST}`);
      lines.push(`  ${makeBar(d.pct)}`);
      lines.push(`  ${DIM}Resets in:${RST} ${BOLD}${cd}${RST}`);
      lines.push('');
    }

    // ── Weekly (Sonnet Only) ──
    if (usageData.weekSonnet) {
      const d = usageData.weekSonnet;
      lines.push(`${BOLD}  Weekly (Sonnet Only)${RST}`);
      lines.push(`  ${makeBar(d.pct)}`);
      lines.push('');
    }

    // ── Extra Usage ──
    if (usageData.extra) {
      const d = usageData.extra;
      const target = parseResetDate(d.resets);
      const remaining = target - now;
      if (remaining <= 0) checkExpired('extra', d.resets);
      const cd = formatCountdown(remaining);
      lines.push(`${BOLD}  Extra Usage${RST}`);
      lines.push(`  ${makeBar(d.pct)}`);
      lines.push(`  ${DIM}$${d.spent} / $${d.total} spent · Resets in:${RST} ${BOLD}${cd}${RST}`);
      lines.push('');
    }

    // ── Insight ──
    if (usageData.insight) {
      lines.push(sep);
      lines.push(`  ${YEL}⚡ ${usageData.insight}${RST}`);
    }

    lines.push(sep);

    // ── Footer ──
    const nextRefresh = new Date(lastFetch.getTime() + REFRESH_MS);
    const refreshIn = formatCountdown(nextRefresh - now);
    lines.push(`  ${DIM}Last updated: ${lastFetch.toLocaleTimeString()} · Next refresh in ${refreshIn}${RST}`);
  }

  lines.push(`  ${DIM}Ctrl+C to exit${RST}`);
  lines.push('');

  process.stdout.write(CLR + lines.join('\n'));

  if (forceRefresh && !fetching) refresh();
}

// ── Main loop ──────────────────────────────────────────────────
async function refresh() {
  const data = await fetchUsage();
  if (data) {
    usageData = data;
    lastFetch = new Date();
  }
}

async function main() {
  process.stdout.write(HIDE);
  process.on('SIGINT', () => {
    process.stdout.write(SHOW + '\n');
    process.exit(0);
  });
  process.on('exit', () => {
    process.stdout.write(SHOW);
  });

  // Initial render while fetching
  render();

  // First fetch
  await refresh();
  render();

  // Update display every second (countdowns tick)
  setInterval(render, 1000);

  // Refresh data every 30 minutes
  setInterval(async () => {
    await refresh();
  }, REFRESH_MS);
}

main();
