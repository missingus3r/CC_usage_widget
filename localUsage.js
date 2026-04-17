// Reads local token consumption from ~/.claude/projects/*/*.jsonl.
// Each assistant message in those files contains a `message.usage` object with
// input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens
// plus a top-level `timestamp`. We aggregate totals for the current local day
// and the trailing 7 days.

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');

function emptyTotals() {
  return { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, messages: 0 };
}

function addUsage(totals, u) {
  totals.input        += u.input_tokens || 0;
  totals.output       += u.output_tokens || 0;
  totals.cacheRead    += u.cache_read_input_tokens || 0;
  totals.cacheCreate  += u.cache_creation_input_tokens || 0;
  totals.messages     += 1;
}

function scanFile(filePath, todayStart, weekStart, today, week) {
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
      if (ts >= weekStart)  addUsage(week, usage);
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
  const weekStart  = now.getTime() - 7 * 24 * 3600 * 1000;
  const skipBefore = weekStart - 24 * 3600 * 1000;

  const today = emptyTotals();
  const week  = emptyTotals();

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
      await scanFile(fp, todayStart, weekStart, today, week);
    }
  }

  return { today, week };
}

module.exports = { readLocalUsage };
