const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  refreshMinutes: 15,
};

function loadConfig() {
  const file = path.join(__dirname, 'config.json');
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw);
    const cfg = { ...DEFAULTS, ...parsed };
    if (!(typeof cfg.refreshMinutes === 'number' && cfg.refreshMinutes > 0)) {
      cfg.refreshMinutes = DEFAULTS.refreshMinutes;
    }
    return cfg;
  } catch {
    return { ...DEFAULTS };
  }
}

module.exports = { loadConfig, DEFAULTS };
