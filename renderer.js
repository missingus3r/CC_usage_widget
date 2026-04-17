// ── State ──────────────────────────────────────────────────────
let usageData = null;
let lastFetch = null;
const REFRESH_MS = 30 * 60 * 1000;
let tickInterval = null;
let fetching = false;
// Tracks `${section}:${resetsString}` pairs we've already force-refreshed for,
// so a countdown that sits at "Now!" for a while doesn't re-trigger every tick.
const firedResets = new Set();

// ── DOM refs ───────────────────────────────────────────────────
const content = document.getElementById('content');
const loading = document.getElementById('loading');
const footerUpdated = document.getElementById('footer-updated');
const footerNext = document.getElementById('footer-next');
const btnRefresh = document.getElementById('btn-refresh');

document.getElementById('btn-min').addEventListener('click', () => window.api.minimize());
document.getElementById('btn-close').addEventListener('click', () => window.api.close());
btnRefresh.addEventListener('click', () => doFetch());

// ── Reset date parser ──────────────────────────────────────────
function parseResetDate(resetStr) {
  const now = new Date();

  const timeMatch = resetStr.match(/(\d{1,2})\s*(am|pm)/i);
  let hour = 0;
  if (timeMatch) {
    hour = parseInt(timeMatch[1]);
    if (timeMatch[2].toLowerCase() === 'pm' && hour !== 12) hour += 12;
    if (timeMatch[2].toLowerCase() === 'am' && hour === 12) hour = 0;
  }

  const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const dateMatch = resetStr.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})/i);

  let target;
  if (dateMatch) {
    const month = months[dateMatch[1].toLowerCase()];
    const day = parseInt(dateMatch[2]);
    target = new Date(now.getFullYear(), month, day, hour, 0, 0);
    if (target < now && (now - target) > 180 * 24 * 3600 * 1000) {
      target.setFullYear(target.getFullYear() + 1);
    }
  } else {
    target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
  }

  // Convert from ART (UTC-3) to local
  const localOffsetMin = now.getTimezoneOffset();
  const artOffsetMin = 180;
  const diffMin = artOffsetMin - localOffsetMin;
  target = new Date(target.getTime() + diffMin * 60 * 1000);

  return target;
}

// ── Countdown formatter ────────────────────────────────────────
function fmtCountdown(ms) {
  if (ms <= 0) return 'Now!';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${sec}s`);
  return parts.join(' ');
}

// ── Bar color class ────────────────────────────────────────────
function barClass(pct) {
  if (pct >= 75) return 'red';
  if (pct >= 50) return 'yellow';
  return 'green';
}

function pctColor(pct) {
  if (pct >= 75) return '#ef4444';
  if (pct >= 50) return '#facc15';
  return '#4ade80';
}

// ── Build sections HTML (static parts) ─────────────────────────
function buildSections() {
  if (!usageData) return;

  let html = '';

  if (usageData.session) {
    html += `
      <div class="section">
        <div class="section-header">
          <span class="section-label">Current Session</span>
          <span class="section-pct" style="color:${pctColor(usageData.session.pct)}">${usageData.session.pct}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill ${barClass(usageData.session.pct)}" style="width:${usageData.session.pct}%"></div></div>
        <div class="countdown">
          <span class="countdown-icon">⏱</span>
          Resets in <span class="countdown-value" id="cd-session">—</span>
        </div>
      </div>`;
  }

  if (usageData.weekAll) {
    html += `
      <div class="section">
        <div class="section-header">
          <span class="section-label">Weekly · All Models</span>
          <span class="section-pct" style="color:${pctColor(usageData.weekAll.pct)}">${usageData.weekAll.pct}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill ${barClass(usageData.weekAll.pct)}" style="width:${usageData.weekAll.pct}%"></div></div>
        <div class="countdown">
          <span class="countdown-icon">⏱</span>
          Resets in <span class="countdown-value" id="cd-week">—</span>
        </div>
      </div>`;
  }

  if (usageData.weekSonnet) {
    html += `
      <div class="section">
        <div class="section-header">
          <span class="section-label">Weekly · Sonnet Only</span>
          <span class="section-pct" style="color:${pctColor(usageData.weekSonnet.pct)}">${usageData.weekSonnet.pct}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill ${barClass(usageData.weekSonnet.pct)}" style="width:${usageData.weekSonnet.pct}%"></div></div>
      </div>`;
  }

  if (usageData.extra) {
    html += `
      <div class="section">
        <div class="section-header">
          <span class="section-label">Extra Usage</span>
          <span class="section-pct" style="color:${pctColor(usageData.extra.pct)}">${usageData.extra.pct}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill ${barClass(usageData.extra.pct)}" style="width:${usageData.extra.pct}%"></div></div>
        <div class="spent">
          <span class="spent-value">$${usageData.extra.spent}</span> / $${usageData.extra.total} spent
        </div>
        <div class="countdown">
          <span class="countdown-icon">⏱</span>
          Resets in <span class="countdown-value" id="cd-extra">—</span>
        </div>
      </div>`;
  }

  if (usageData.insight) {
    html += `<div class="divider"></div>`;
    html += `<div class="insight"><span>⚡</span><span>${usageData.insight}</span></div>`;
  }

  content.innerHTML = html;
}

// ── Tick: update countdowns every second ───────────────────────
function tick() {
  const now = new Date();
  let forceRefresh = false;

  const updateSection = (section, elId) => {
    const d = usageData?.[section];
    if (!d || !d.resets) return;
    const el = document.getElementById(elId);
    if (!el) return;
    const remaining = parseResetDate(d.resets) - now;
    el.textContent = fmtCountdown(remaining);
    if (remaining <= 0) {
      const key = `${section}:${d.resets}`;
      if (!firedResets.has(key)) {
        firedResets.add(key);
        forceRefresh = true;
      }
    }
  };

  updateSection('session', 'cd-session');
  updateSection('weekAll', 'cd-week');
  updateSection('extra', 'cd-extra');

  // Footer: next refresh
  if (lastFetch) {
    const nextRefresh = new Date(lastFetch.getTime() + REFRESH_MS);
    footerNext.textContent = `↻ ${fmtCountdown(nextRefresh - now)}`;
  }

  if (forceRefresh && !fetching) doFetch();
}

// ── Fetch usage ────────────────────────────────────────────────
async function doFetch() {
  if (fetching) return;
  fetching = true;
  btnRefresh.classList.add('spinning');

  if (!usageData) {
    loading.style.display = 'flex';
  }

  const data = await window.api.fetchUsage();

  btnRefresh.classList.remove('spinning');
  fetching = false;

  if (data) {
    usageData = data;
    lastFetch = new Date();
    loading.style.display = 'none';

    const timeStr = lastFetch.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    footerUpdated.textContent = `Updated ${timeStr}`;

    buildSections();
    tick();
  } else if (!usageData) {
    loading.querySelector('span').textContent = 'Could not fetch data. Retrying...';
    setTimeout(doFetch, 10000);
  }
}

// ── Init ───────────────────────────────────────────────────────
doFetch();
tickInterval = setInterval(tick, 1000);
setInterval(doFetch, REFRESH_MS);
