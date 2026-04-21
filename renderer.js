// ── State ──────────────────────────────────────────────────────
let usageData = null;
let codexData = null;
let localUsage = null;
let lastFetch = null;
let nextFetchAt = null;
let REFRESH_MS = 15 * 60 * 1000; // overwritten from config at startup
const RETRY_MS = 60 * 1000;       // when a fetch fails but we already have data
const INITIAL_RETRY_MS = 10 * 1000; // when we have no data yet
let tickInterval = null;
let fetchTimer = null;
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

// Codex /status prints resets in local time, with formats like
// "23:51" or "18:51 on 28 Apr".
function parseCodexResetDate(resetStr) {
  const now = new Date();

  const timeMatch = resetStr.match(/(\d{1,2}):(\d{2})/);
  let hour = 0, minute = 0;
  if (timeMatch) {
    hour = parseInt(timeMatch[1]);
    minute = parseInt(timeMatch[2]);
  }

  const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const dateMatch = resetStr.match(/(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);

  let target;
  if (dateMatch) {
    const day = parseInt(dateMatch[1]);
    const month = months[dateMatch[2].toLowerCase()];
    target = new Date(now.getFullYear(), month, day, hour, minute, 0);
    if (target < now && (now - target) > 180 * 24 * 3600 * 1000) {
      target.setFullYear(target.getFullYear() + 1);
    }
  } else {
    target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0);
    if (target <= now) target.setDate(target.getDate() + 1);
  }
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

// ── Number formatter (compact) ─────────────────────────────────
function fmtNum(n) {
  if (n == null || !isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n);
}

// ── Build sections HTML (static parts) ─────────────────────────
function buildSections() {
  if (!usageData && !codexData && !localUsage) return;

  let html = '';

  if (usageData) {
  html += '<div class="provider-header">Claude</div>';

  if (usageData.session) {
    html += `
      <div class="section">
        <div class="section-header">
          <span class="section-label">Current Session</span>
          <span class="section-pct" style="color:${pctColor(usageData.session.pct)}">${usageData.session.pct}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill ${barClass(usageData.session.pct)}" style="width:${usageData.session.pct}%"></div></div>
        <div class="countdown">
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
          Resets in <span class="countdown-value" id="cd-extra">—</span>
        </div>
      </div>`;
  }

  if (usageData.insight) {
    html += `<div class="divider"></div>`;
    html += `<div class="insight"><span>⚡</span><span>${usageData.insight}</span></div>`;
  }
  } // end Claude block

  if (codexData) {
    if (usageData) html += `<div class="divider"></div>`;
    const acct = codexData.account ? ` · ${codexData.account.plan}` : '';
    html += `<div class="provider-header">Codex${acct}</div>`;

    if (codexData.session5h) {
      const p = codexData.session5h.pctLeft;
      html += `
        <div class="section">
          <div class="section-header">
            <span class="section-label">5h limit</span>
            <span class="section-pct" style="color:${pctColor(p)}">${p}%</span>
          </div>
          <div class="bar-track"><div class="bar-fill ${barClass(p)}" style="width:${p}%"></div></div>
          <div class="countdown">
            Resets in <span class="countdown-value" id="cd-codex-5h">—</span>
          </div>
        </div>`;
    }

    if (codexData.weekly) {
      const p = codexData.weekly.pctLeft;
      html += `
        <div class="section">
          <div class="section-header">
            <span class="section-label">Weekly limit</span>
            <span class="section-pct" style="color:${pctColor(p)}">${p}%</span>
          </div>
          <div class="bar-track"><div class="bar-fill ${barClass(p)}" style="width:${p}%"></div></div>
          <div class="countdown">
            Resets in <span class="countdown-value" id="cd-codex-week">—</span>
          </div>
        </div>`;
    }
  }

  if (localUsage) {
    const tokenTotal = (t) => t.input + t.output + t.cacheRead + t.cacheCreate;

    const stackedBar = (t) => {
      const total = tokenTotal(t);
      if (total === 0) return `<div class="local-stacked-bar empty"></div>`;
      const inPct    = (t.input  / total) * 100;
      const outPct   = (t.output / total) * 100;
      const cachePct = ((t.cacheRead + t.cacheCreate) / total) * 100;
      return `
        <div class="local-stacked-bar">
          <div class="seg seg-in"    style="width:${inPct}%"    title="Input ${fmtNum(t.input)}"></div>
          <div class="seg seg-out"   style="width:${outPct}%"   title="Output ${fmtNum(t.output)}"></div>
          <div class="seg seg-cache" style="width:${cachePct}%" title="Cache ${fmtNum(t.cacheRead + t.cacheCreate)}"></div>
        </div>`;
    };

    const legend = (t) => `
      <div class="local-legend">
        <span class="leg"><i class="dot dot-in"></i>In <b>${fmtNum(t.input)}</b></span>
        <span class="leg"><i class="dot dot-out"></i>Out <b>${fmtNum(t.output)}</b></span>
        <span class="leg"><i class="dot dot-cache"></i>Cache <b>${fmtNum(t.cacheRead + t.cacheCreate)}</b></span>
        <span class="leg leg-msgs">${t.messages} msgs</span>
      </div>`;

    const row = (label, t) => `
      <div class="local-row">
        <div class="local-row-head">
          <span class="local-row-label">${label}</span>
          <span class="local-row-total">${fmtNum(tokenTotal(t))}</span>
        </div>
        ${stackedBar(t)}
        ${legend(t)}
      </div>`;

    const sparkline = () => {
      const totals = localUsage.daily.map(d => tokenTotal(d.totals));
      const maxT   = Math.max(1, ...totals);
      const maxM   = Math.max(1, ...localUsage.daily.map(d => d.totals.messages));
      const lastIdx = localUsage.daily.length - 1;
      return `
        <div class="local-spark-title">Last 7 days · tokens · messages</div>
        <div class="local-sparkline">
          ${localUsage.daily.map((d, i) => {
            const t   = totals[i];
            const msg = d.totals.messages;
            const hT  = t   > 0 ? Math.max(3, (t   / maxT) * 100) : 0;
            const hM  = msg > 0 ? Math.max(3, (msg / maxM) * 100) : 0;
            const isToday = i === lastIdx;
            return `
              <div class="spark-col${isToday ? ' spark-today' : ''}" title="${d.label} ${d.date}&#10;${fmtNum(t)} tokens · ${msg} msgs">
                <div class="spark-track">
                  <div class="spark-bar spark-bar-tok" style="height:${hT}%"></div>
                  <div class="spark-bar spark-bar-msg" style="height:${hM}%"></div>
                </div>
                <span class="spark-label">${d.label[0]}</span>
              </div>`;
          }).join('')}
        </div>`;
    };

    if (usageData || codexData) html += `<div class="divider"></div>`;
    html += `
      <div class="section local-section">
        <div class="section-header">
          <span class="section-label">Local Tokens</span>
        </div>
        ${row('Today', localUsage.today)}
        ${row('7 days', localUsage.week)}
        ${sparkline()}
      </div>`;
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

  const updateCodexSection = (section, elId) => {
    const d = codexData?.[section];
    if (!d || !d.resets) return;
    const el = document.getElementById(elId);
    if (!el) return;
    const remaining = parseCodexResetDate(d.resets) - now;
    el.textContent = fmtCountdown(remaining);
    if (remaining <= 0) {
      const key = `codex:${section}:${d.resets}`;
      if (!firedResets.has(key)) {
        firedResets.add(key);
        forceRefresh = true;
      }
    }
  };

  updateCodexSection('session5h', 'cd-codex-5h');
  updateCodexSection('weekly', 'cd-codex-week');

  // Footer: next refresh
  if (nextFetchAt) {
    footerNext.textContent = `↻ ${fmtCountdown(nextFetchAt - now)}`;
  } else if (fetching) {
    footerNext.textContent = `↻ fetching…`;
  }

  if (forceRefresh && !fetching) doFetch();
}

// ── Scheduling ─────────────────────────────────────────────────
function scheduleNextFetch(delay) {
  if (fetchTimer) clearTimeout(fetchTimer);
  nextFetchAt = new Date(Date.now() + delay);
  fetchTimer = setTimeout(() => {
    fetchTimer = null;
    doFetch();
  }, delay);
}

// ── Fetch usage ────────────────────────────────────────────────
async function doFetch() {
  if (fetching) return;
  if (fetchTimer) { clearTimeout(fetchTimer); fetchTimer = null; }
  fetching = true;
  nextFetchAt = null;
  btnRefresh.classList.add('spinning');

  if (!usageData) {
    loading.style.display = 'flex';
  }

  let data = null;
  let codex = null;
  let local = null;
  try {
    [data, codex, local] = await Promise.all([
      window.api.fetchUsage().catch(() => null),
      window.api.fetchCodexUsage().catch(() => null),
      window.api.fetchLocalUsage().catch(() => null),
    ]);
  } finally {
    btnRefresh.classList.remove('spinning');
    fetching = false;
  }

  if (local) localUsage = local;
  if (codex) {
    codexData = codex;
    window.api.sendCodexUsage(codex);
  }

  const gotAny = !!(data || codex);

  if (data) {
    usageData = data;
    window.api.sendUsage(data);
  }

  if (gotAny) {
    lastFetch = new Date();
    loading.style.display = 'none';
    const timeStr = lastFetch.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    footerUpdated.textContent = `Updated ${timeStr}`;
    buildSections();
    scheduleNextFetch(REFRESH_MS);
  } else if (!usageData && !codexData) {
    loading.querySelector('span').textContent = 'Could not fetch data. Retrying...';
    scheduleNextFetch(INITIAL_RETRY_MS);
  } else {
    if (local) buildSections();
    // Keep the old data visible but retry sooner than REFRESH_MS.
    scheduleNextFetch(RETRY_MS);
  }

  tick();
}

// ── Init ───────────────────────────────────────────────────────
(async () => {
  try {
    const cfg = await window.api.getConfig();
    if (cfg?.refreshMinutes > 0) REFRESH_MS = cfg.refreshMinutes * 60 * 1000;
  } catch {}
  window.api.onRefresh(() => doFetch());
  doFetch();
  tickInterval = setInterval(tick, 1000);
})();
