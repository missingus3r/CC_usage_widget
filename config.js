const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  refreshMinutes: 15,
};

const CONFIG_PATH = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const cfg = { ...DEFAULTS, ...parsed };
    if (!(typeof cfg.refreshMinutes === 'number' && cfg.refreshMinutes > 0)) {
      cfg.refreshMinutes = DEFAULTS.refreshMinutes;
    }
    if (!Array.isArray(cfg.apiKeys)) cfg.apiKeys = [];
    return cfg;
  } catch {
    return { ...DEFAULTS, apiKeys: [] };
  }
}

function saveConfig(patch) {
  const current = loadConfig();
  const merged = { ...current, ...patch };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8');
  return merged;
}

module.exports = { loadConfig, saveConfig, DEFAULTS, CONFIG_PATH };
