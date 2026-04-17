// Reads local token consumption from ~/.claude/projects/*/*.jsonl.
// Each assistant message in those files contains a `message.usage` object with
// input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens
// plus a top-level `timestamp`. We aggregate totals for the current local day,
// the trailing 7 calendar days, and a per-day breakdown for the sparkline.

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const DAY_MS = 24 * 3600 * 1000;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function emptyTotals() {
  return { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, messages: 0 };
}

function addUsage(t, u) {
  t.input        += u.input_tokens || 0;
  t.output       += u.output_tokens || 0;
  t.cacheRead    += u.cache_read_input_tokens || 0;
  t.cacheCreate  += u.cache_creation_input_tokens || 0;
  t.messages     += 1;
}

function scanFile(filePath, todayStart, weekStart, today, week, daily) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    stream.on('error', () => resolve());
    const rl = readline.createInterface({ input: stream });
    rl.on('line', (line) => {
      if (!line.includes('"usage"')) return;
      let obj;
      try { obj = JSON.parse(line); } catch { return; }
      const usage = obj && obj.message && obj.message.usage;
      if (!usage) return;
      const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN;
      if (!Number.isFinite(ts)) return;
      if (ts >= weekStart) {
        addUsage(week, usage);
        const dayIdx = Math.floor((ts - weekStart) / DAY_MS);
        if (dayIdx >= 0 && dayIdx < 7) addUsage(daily[dayIdx].totals, usage);
      }
      if (ts >= todayStart) addUsage(today, usage);
    });
    rl.on('close', resolve);
  });
}

async function readLocalUsage() {
  let entries;
  try {
    entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return null;
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart  = todayStart - 6 * DAY_MS;     // 7 calendar days inclusive
  const skipBefore = weekStart - DAY_MS;

  const today = emptyTotals();
  const week  = emptyTotals();
  const daily = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart + i * DAY_MS);
    return {
      label: DAY_NAMES[d.getDay()],
      date:  d.toISOString().slice(0, 10),
      totals: emptyTotals(),
    };
  });

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(PROJECTS_DIR, ent.name);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(dir, f);
      let stat;
      try { stat = fs.statSync(fp); } catch { continue; }
      if (stat.mtimeMs < skipBefore) continue;
      await scanFile(fp, todayStart, weekStart, today, week, daily);
    }
  }

  return { today, week, daily };
}

module.exports = { readLocalUsage };
