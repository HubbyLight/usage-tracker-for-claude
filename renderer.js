'use strict';

const $ = (id) => document.getElementById(id);
let current = null;

const RING_CIRC = { s: 2 * Math.PI * 56, w: 2 * Math.PI * 38 };

function countdown(ms) {
  if (ms == null) return '—';
  let d = Math.max(0, ms - Date.now());
  const day = Math.floor(d / 86400e3); d -= day * 86400e3;
  const h = Math.floor(d / 3600e3);   d -= h * 3600e3;
  const m = Math.floor(d / 60e3);
  if (day > 0) return `resets ${day}d ${h}h`;
  if (h > 0)   return `resets ${h}h ${m}m`;
  return `resets ${m}m`;
}

const counters = {};   // per-gauge rAF handles for the % count-up

function countUp(prefix, target) {
  cancelAnimationFrame(counters[prefix]);
  const el = $(`${prefix}-pct`);
  const rcEl = $(`rc-${prefix}-pct`);
  if (target == null) {
    el.innerHTML = '--<span class="unit">used</span>';
    if (rcEl) rcEl.textContent = '--';
    return;
  }
  const t0 = performance.now(), dur = 800;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);   // ease-out, matches the ring sweep
    const val = Math.round(target * eased);
    el.innerHTML = val + '<span class="unit">used</span>';
    if (rcEl) rcEl.textContent = val;
    if (k < 1) counters[prefix] = requestAnimationFrame(step);
  };
  counters[prefix] = requestAnimationFrame(step);
}

function setGauge(prefix, pct, resetMs, animate) {
  const row = $(prefix);                       // 's' or 'w' legend row
  const ring = $(`${prefix}-ring`);
  const p = pct == null ? null : Math.round(pct);
  const clamped = p == null ? 0 : Math.min(100, Math.max(0, p));
  const circ = RING_CIRC[prefix];
  const danger = p != null && p >= 90;

  ring.style.strokeDasharray = `${circ}`;
  if (animate) {
    // restart the sweep from 0 so the refresh visibly counts up
    ring.style.transition = 'none';
    ring.style.strokeDashoffset = `${circ}`;
    void ring.getBoundingClientRect();         // flush so the reset takes
    ring.style.transition = '';
    countUp(prefix, p);
  } else {
    cancelAnimationFrame(counters[prefix]);
    $(`${prefix}-pct`).innerHTML = (p == null ? '--' : p) + '<span class="unit">used</span>';
    const rcEl = $(`rc-${prefix}-pct`);
    if (rcEl) rcEl.textContent = p == null ? '--' : p;
  }
  ring.style.strokeDashoffset = `${circ * (1 - clamped / 100)}`;

  ring.classList.toggle('danger', danger);
  $(`${prefix}-reset`).textContent = countdown(resetMs);
  row.classList.toggle('danger', danger);
  const rcRow = $(`rc-${prefix}`);
  if (rcRow) rcRow.classList.toggle('danger', danger);
}

function renderPerModel(list) {
  const el = $('per-model');
  if (!list || !list.length) { el.classList.remove('show'); el.innerHTML = ''; return; }
  el.classList.add('show');
  el.innerHTML = '';
  for (const m of list) {
    const danger = m.pct != null && m.pct >= 90;
    const row = document.createElement('div');
    row.className = 'pm-row' + (danger ? ' danger' : '');
    row.dataset.reset = m.reset ?? '';

    const label = document.createElement('span');
    label.className = 'pm-label';
    label.textContent = m.label;

    const pct = document.createElement('span');
    pct.className = 'pm-pct';
    pct.textContent = (m.pct == null ? '--' : Math.round(m.pct)) + '%';

    const reset = document.createElement('span');
    reset.className = 'pm-reset';
    reset.textContent = countdown(m.reset);

    row.append(label, pct, reset);
    el.appendChild(row);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ---- wide (landscape) layout: horizontal bars ----------------------------
   Rebuilt on each 'ok' render so it always holds current data when the user
   stretches the window. Shown/hidden purely via body.hbars (see updateLayout). */
function barRow(label, pct, resetMs, colorVar, animate) {
  const p = pct == null ? null : Math.round(pct);
  const danger = p != null && p >= 90;
  const color = danger ? 'var(--danger)' : colorVar;
  const row = document.createElement('div');
  row.className = 'bar-row' + (danger ? ' danger' : '');
  row.dataset.reset = resetMs == null ? '' : resetMs;
  row.innerHTML =
    '<div class="bar-head"><span class="bar-label"></span>' +
    '<span class="bar-reset"></span></div>' +
    '<div class="bar-track"><div class="bar-fill"></div></div>' +
    '<span class="bar-pct"></span>';
  row.querySelector('.bar-label').textContent = label;
  row.querySelector('.bar-reset').textContent = countdown(resetMs);
  const pctEl = row.querySelector('.bar-pct');
  pctEl.textContent = p == null ? '--' : p + '%';
  pctEl.style.color = color;
  const fill = row.querySelector('.bar-fill');
  fill.style.background = color;
  const target = p == null ? 0 : Math.min(100, Math.max(0, p));
  if (animate) {
    fill.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.width = target + '%'; }));
  } else {
    fill.style.width = target + '%';
  }
  return row;
}

function renderBars(u, animate) {
  const el = $('bars');
  el.innerHTML = '';
  // Order = drop priority: rows are hidden from the end first when short, so
  // per-model (Fable…) goes first, then weekly, and 5-hour session always stays.
  el.appendChild(barRow('5-hour session', u.sessionPct, u.sessionReset, 'var(--session)', animate));
  el.appendChild(barRow('Weekly · all models', u.weeklyPct, u.weeklyReset, 'var(--weekly)', animate));
  if (Array.isArray(u.perModel)) {
    for (const m of u.perModel) el.appendChild(barRow(m.label, m.pct, m.reset, 'var(--weekly)', animate));
  }
  fitBars();
}

/* ---- vertical bars: used when the window is tall (portrait) ---------------
   Same data as the horizontal list, but columns that fill upward so they use
   the height. Short labels since the columns are narrow. */
function vbarCol(label, pct, resetMs, colorVar, animate) {
  const p = pct == null ? null : Math.round(pct);
  const danger = p != null && p >= 90;
  const color = danger ? 'var(--danger)' : colorVar;
  const col = document.createElement('div');
  col.className = 'vbar' + (danger ? ' danger' : '');
  col.dataset.reset = resetMs == null ? '' : resetMs;
  col.innerHTML =
    '<span class="vbar-pct"></span>' +
    '<div class="vbar-track"><div class="vbar-fill"></div></div>' +
    '<span class="vbar-label"></span><span class="vbar-reset"></span>';
  const pctEl = col.querySelector('.vbar-pct');
  pctEl.textContent = p == null ? '--' : p + '%';
  pctEl.style.color = color;
  col.querySelector('.vbar-label').textContent = label;
  col.querySelector('.vbar-reset').textContent = countdown(resetMs);
  const fill = col.querySelector('.vbar-fill');
  fill.style.background = color;
  const target = p == null ? 0 : Math.min(100, Math.max(0, p));
  if (animate) {
    fill.style.height = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.height = target + '%'; }));
  } else {
    fill.style.height = target + '%';
  }
  return col;
}

function renderVBars(u, animate) {
  const el = $('vbars');
  el.innerHTML = '';
  el.appendChild(vbarCol('5-hour', u.sessionPct, u.sessionReset, 'var(--session)', animate));
  el.appendChild(vbarCol('weekly', u.weeklyPct, u.weeklyReset, 'var(--weekly)', animate));
  if (Array.isArray(u.perModel)) {
    for (const m of u.perModel) el.appendChild(vbarCol(m.label, m.pct, m.reset, 'var(--weekly)', animate));
  }
  fitVBars();
}

// Vertical columns collapse by WIDTH (they already fill the height): when the
// window gets too narrow, drop the lowest-priority columns first so each stays
// at least MIN wide — per-model (Fable) → weekly → (5-hour session stays).
function fitVBars() {
  const el = $('vbars');
  if (!document.body.classList.contains('vbars')) return;
  const cols = [...el.children];
  cols.forEach((c) => c.classList.remove('hide'));
  const GAP = 18, MARGIN = 12, MIN = 54;         // keep a little side margin
  const avail = el.clientWidth - MARGIN;
  const maxN = Math.max(1, Math.floor((avail + GAP) / (MIN + GAP)));
  for (let i = cols.length - 1; i >= maxN; i--) cols[i].classList.add('hide');
}

// In the horizontal bar mode, keep only the rows that fit the current height
// (with margin), dropping the lowest-priority first: per-model → weekly →
// (session stays). Vertical bars fill the height so they don't need this.
function fitBars() {
  const bars = $('bars');
  if (!document.body.classList.contains('hbars')) return;
  const rows = [...bars.children];
  rows.forEach((r) => r.classList.remove('hide'));
  const GAP = 16, MARGIN = 24;                 // never fill edge-to-edge
  const avail = bars.clientHeight - MARGIN;
  const shown = rows.slice();
  const needed = () => shown.reduce((s, r) => s + r.offsetHeight, 0) + GAP * Math.max(0, shown.length - 1);
  while (shown.length > 1 && needed() > avail) shown.pop().classList.add('hide');
}

function showState(msg, btnLabel, btnAction) {
  $('gauges').classList.add('hide');
  $('state').classList.add('show');
  $('state-msg').innerHTML = msg;
  const btn = $('state-btn');
  if (btnLabel) {
    btn.style.display = 'inline-block';
    btn.textContent = btnLabel;
    btn.onclick = btnAction;
  } else { btn.style.display = 'none'; }
}
function showGauges() {
  $('gauges').classList.remove('hide');
  $('state').classList.remove('show');
}

let lastKey = null;       // last rendered percentages
let forceAnimate = false; // set on manual refresh / popup reopen

function render(u) {
  current = u;
  switch (u.state) {
    case 'ok': {
      showGauges();
      // animate from 0 only when it's meaningful — a value change, a manual
      // refresh, or reopening the popup. Background polls repaint silently.
      const key = `${u.sessionPct}|${u.weeklyPct}`;
      const animate = forceAnimate || key !== lastKey;
      lastKey = key; forceAnimate = false;
      setGauge('s', u.sessionPct, u.sessionReset, animate);
      setGauge('w', u.weeklyPct, u.weeklyReset, animate);
      renderPerModel(u.perModel);
      renderBars(u, animate);   // horizontal bars (hidden unless body.hbars)
      renderVBars(u, animate);  // vertical bars (hidden unless body.vbars)
      $('foot-left').textContent = u.updatedAt
        ? 'updated ' + new Date(u.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '';
      $('foot-right').innerHTML = u.demo ? '<span class="demo">DEMO</span>' : 'live';
      break;
    }
    case 'login':
      showState('Not signed in to <b>Claude</b>. Sign in once to start tracking.',
        'Sign in to Claude', () => window.usageApi.login());
      $('foot-left').textContent = ''; $('foot-right').textContent = '';
      break;
    case 'setup':
      showState('Couldn\u2019t determine your usage endpoint. Copy <b>config.example.js</b> to <b>config.js</b> and set <b>USAGE_ENDPOINT</b> (see README), or sign in to an account with claude.ai access.');
      $('foot-left').textContent = 'setup needed'; $('foot-right').textContent = '';
      break;
    case 'parse':
      showState('Got a response but couldn\u2019t read the numbers. Adjust <b>parseUsage()</b> in main.js.');
      $('foot-left').textContent = 'check parseUsage'; $('foot-right').textContent = '';
      break;
    case 'error':
      // u.message comes from network/JS error strings — escape it so unexpected
      // markup in an error body can never execute in the popup (innerHTML sink).
      showState('Something went wrong: <b>' + escapeHtml(u.message || 'unknown') + '</b>');
      $('foot-left').textContent = 'error'; $('foot-right').textContent = '';
      break;
    default:
      $('foot-left').textContent = 'connecting…';
  }
}

$('refresh').onclick = () => { forceAnimate = true; window.usageApi.refresh(); };

// pin: keep the popup on screen (no auto-hide)
let pinned = false;
$('pin').onclick = () => {
  pinned = !pinned;
  $('pin').classList.toggle('active', pinned);
  $('pin').textContent = pinned ? '📌 Fixed' : '📌 Fix';
  $('pin').title = pinned ? 'Click to unfix (auto-hide again)' : 'Keep on screen';
  window.usageApi.setPinned(pinned);
};

// popup re-shown → replay the count-up once
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') forceAnimate = true;
});

window.usageApi.onUsage(render);

// Layouts by window shape:
//  - bars    : stretched far from square (wide OR tall) → horizontal bar list
//              that fills the long axis; hides low-priority rows when short
//  - compact : small & near-square → numbers fold into the ring centers
//  - normal  : near-square → rings on top, legend below
// bars wins over compact so a wide-but-short window shows bars, not tiny rings.
function updateLayout() {
  const w = window.innerWidth, h = window.innerHeight;
  const hbars = w >= 400 && w >= h * 1.3;   // clearly landscape → horizontal bars
  const vbars = !hbars && h >= 440 && h >= w * 1.3;  // clearly tall → vertical bars
  const compact = !hbars && !vbars && (w < 300 || h < 340);
  document.body.classList.toggle('hbars', hbars);
  document.body.classList.toggle('vbars', vbars);
  document.body.classList.toggle('compact', compact);
  fitBars();    // horizontal: which rows fit the height
  fitVBars();   // vertical: which columns fit the width
}
window.addEventListener('resize', updateLayout);
updateLayout();

// keep the reset countdowns ticking every second
setInterval(() => {
  if (current && current.state === 'ok') {
    $('s-reset').textContent = countdown(current.sessionReset);
    $('w-reset').textContent = countdown(current.weeklyReset);
    document.querySelectorAll('.pm-row').forEach((row) => {
      const ms = row.dataset.reset ? Number(row.dataset.reset) : null;
      row.querySelector('.pm-reset').textContent = countdown(ms);
    });
    document.querySelectorAll('#bars .bar-row').forEach((row) => {
      const ms = row.dataset.reset ? Number(row.dataset.reset) : null;
      row.querySelector('.bar-reset').textContent = countdown(ms);
    });
    document.querySelectorAll('#vbars .vbar').forEach((col) => {
      const ms = col.dataset.reset ? Number(col.dataset.reset) : null;
      col.querySelector('.vbar-reset').textContent = countdown(ms);
    });
  }
}, 1000);
