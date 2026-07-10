'use strict';

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

// macOS runs as a menu-bar app: smaller tray icon (18pt + @2x), popup drops
// from the menu bar instead of the taskbar corner, and the Dock icon is hidden.
// Every darwin branch below is additive — the Windows paths are untouched.
const IS_MAC = process.platform === 'darwin';

/* =========================================================================
 *  CONFIG
 * =========================================================================
 *
 *  1) DEMO_MODE = true  -> app runs immediately with fake numbers so you can
 *     see the UI. Flip to false to read your real claude.ai usage.
 *
 *  2) Usage endpoint: by default the app discovers it at runtime from
 *     /api/organizations (the org id is per-account, so nothing personal is
 *     committed). To pin a specific org, copy config.example.js -> config.js
 *     and set USAGE_ENDPOINT there. config.js is git-ignored, so your personal
 *     value never lands in the repo.
 *
 *  3) parseUsage(json) -> converts the endpoint's JSON into the numbers the UI
 *     needs. Only touch this if Anthropic changes the response field names.
 * ========================================================================= */

const DEMO_MODE = false;                // <-- set to false after wiring real data

// Personal, git-ignored overrides. Missing file is fine — we fall back to
// runtime org discovery. Keeping this out of the repo means the published code
// carries no account-specific ids.
let config = {};
try { config = require('./config.js') || {}; } catch (_) { /* no config.js — use defaults */ }

// Optional: a fixed usage URL from config.js. Empty -> discover the org below.
const USAGE_ENDPOINT = (config.USAGE_ENDPOINT || '').trim();

// When no fixed endpoint is set, the usage endpoint is org-scoped and the org
// id changes per logged-in account. We discover it at runtime from
// /api/organizations (the chat-capable org). usageOrgUuid caches that choice;
// it's cleared and re-discovered automatically if the endpoint later 404s.
const ORGS_ENDPOINT = 'https://claude.ai/api/organizations';
let usageOrgUuid = null;
const POLL_SECONDS = 20;                // how often to refresh (lightweight GET; server data itself updates less often)

/**
 * Turn the raw endpoint JSON into the shape the UI expects.
 * Return null if you can't find the fields (app will show "check parseUsage").
 *
 * Expected return shape:
 *   {
 *     sessionPct:   0-100 (number),   // 5-hour window used
 *     sessionReset: <ms epoch | null>,// when the 5-hour window resets
 *     weeklyPct:    0-100 (number),   // 7-day window used
 *     weeklyReset:  <ms epoch | null> // when the weekly window resets
 *     perModel:     [{ label, pct, reset }]  // per-model weekly caps (e.g. Fable)
 *   }
 */
function parseUsage(json) {
  // Confirmed against the live /usage response:
  //   five_hour: { utilization: 0-100, resets_at: ISO string, ... }
  //   seven_day: { utilization: 0-100, resets_at: ISO string, ... }
  //   limits: [{ kind: 'weekly_scoped', percent, resets_at, scope: { model: { display_name } } }, ...]
  try {
    const s = json.five_hour;
    const w = json.seven_day;
    if (!s || !w) return null;
    const reset = (r) => {
      if (r == null) return null;
      const t = Date.parse(r);
      return Number.isNaN(t) ? null : t;
    };
    const perModel = Array.isArray(json.limits)
      ? json.limits
          .filter((l) => l && l.kind === 'weekly_scoped' && l.scope && l.scope.model && l.scope.model.display_name)
          .map((l) => ({ label: l.scope.model.display_name, pct: l.percent, reset: reset(l.resets_at) }))
      : [];
    return {
      sessionPct: s.utilization,
      sessionReset: reset(s.resets_at),
      weeklyPct: w.utilization,
      weeklyReset: reset(w.resets_at),
      perModel,
    };
  } catch (_) {
    return null;
  }
}

/* ========================================================================= */

let tray = null;
let popup = null;
let claudeWin = null;     // hidden window that holds the claude.ai login session
let pollTimer = null;
let latest = { state: 'loading' };
let popupPinned = false;  // pinned popup stays open instead of hiding on blur
let popupHiddenAt = 0;    // when the popup last hid (to make tray clicks toggle)
let userPlaced = false;   // user moved/resized the popup — stop snapping to the corner

const BOUNDS_FILE = () => path.join(app.getPath('userData'), 'popup-bounds.json');

function loadBounds() {
  try { return JSON.parse(fs.readFileSync(BOUNDS_FILE(), 'utf8')); } catch (_) { return null; }
}

/* ---- small persisted settings (currently just the notifications toggle) ---- */
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')); } catch (_) { return {}; }
}
function saveSetting(key, value) {
  const s = loadSettings();
  s[key] = value;
  try { fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(s)); } catch (_) {}
}
let notifsEnabled = loadSettings().notifsEnabled !== false; // default on

/* ---- desktop notifications at 70% / 90% / 100% -----------------------------
   Fires once per threshold per window. We re-arm only when usage falls back
   below the lowest threshold — i.e. the window actually rolled over and usage
   dropped. Within a window usage only climbs, so each threshold alerts exactly
   once.

   (Earlier this keyed the "same window?" check off the API's resets_at, but that
   timestamp jitters by a few seconds between otherwise-identical polls; whenever
   the jitter straddled a minute boundary the alert re-armed and fired again,
   producing the irregular repeat toasts. Usage level is a stable signal —
   resets_at isn't — so we key off that instead and ignore resets_at here.) */
const RE_ARM_BELOW = 70; // usage must dip under this before alerts can fire again
const notifyState = {
  session: { firedAt: 0 },
  weekly: { firedAt: 0 },
};

function maybeNotify(kind, label, pct) {
  if (!notifsEnabled || pct == null || !Notification.isSupported()) return;
  const st = notifyState[kind];
  if (pct < RE_ARM_BELOW) st.firedAt = 0; // window rolled over → can fire again
  // Descending so a single poll that jumps past several thresholds fires only
  // the highest. st.firedAt tracks the highest threshold already alerted for this
  // window, so each of 70 / 90 / 100 fires exactly once, on first reach.
  for (const t of [100, 90, 70]) {
    if (pct >= t && st.firedAt < t) {
      st.firedAt = t;
      const body = t >= 100 ? "You've hit your usage limit."
        : t >= 90 ? "You're almost at the limit."
        : 'Usage is getting high.';
      const n = new Notification({
        title: `Claude ${label}: ${Math.round(pct)}% used`,
        body,
        icon: NOTIF_ICON(),
      });
      n.on('click', () => { if (popup) { positionPopupIfNeeded(); popup.show(); popup.focus(); sendToPopup(); } });
      n.show();
      break; // only the highest newly-crossed threshold
    }
  }
}
function positionPopupIfNeeded() { if (!userPlaced) positionPopup(); }

let saveBoundsTimer = null;
function saveBounds() {
  clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(() => {
    try { fs.writeFileSync(BOUNDS_FILE(), JSON.stringify(popup.getBounds())); } catch (_) {}
  }, 300);
}

const ICON = () => nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
// Larger icon for desktop-notification toasts (the 32px tray icon looks blurry there).
const NOTIF_ICON = () => nativeImage.createFromPath(path.join(__dirname, 'icon-256.png'));

/* ---- single instance: relaunching (desktop shortcut, Start Menu) just
        refreshes the running tray app instead of spawning a duplicate ---- */
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}
app.on('second-instance', () => {
  poll();                                   // 초기화(새로고침)만
  if (popup) { positionPopup(); popup.show(); popup.focus(); sendToPopup(); }
});

/* ---- dynamic tray icon --------------------------------------------------
   Same mark as icon.png, but the two rings sweep in proportion to the
   latest usage, so the taskbar itself shows current state. Drawn as raw
   RGBA and wrapped in a minimal PNG (the main process has no canvas). --- */

const zlib = require('zlib');

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })());
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(pixels, size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawUsageIcon(sessionPct, weeklyPct, size = 32) {
  const SS = 4, N = SS * SS;
  const BG = [0x14, 0x18, 0x1f], TRACK = [0x3a, 0x41, 0x4d];
  const CORAL = [0xe2, 0x79, 0x5a], AMBER = [0xe8, 0xa8, 0x4a], DANGER = [0xe5, 0x48, 0x4d];
  const cx = size / 2, cy = size / 2;
  const outerR = size * 0.36, innerR = size * 0.235, strokeW = size * 0.11;

  const clamp = (p) => Math.max(0, Math.min(100, p == null ? 0 : p));
  const rings = [
    { r: outerR, sweep: clamp(sessionPct) * 3.6, col: clamp(sessionPct) >= 90 ? DANGER : CORAL },
    { r: innerR, sweep: clamp(weeklyPct) * 3.6, col: clamp(weeklyPct) >= 90 ? DANGER : AMBER },
  ];

  const inCircleBg = (x, y) => Math.hypot(x - cx, y - cy) <= size * 0.5;
  const inArc = (x, y, r, w, startDeg, sweepDeg, roundCaps) => {
    const dx = x - cx, dy = y - cy, dist = Math.hypot(dx, dy), halfW = w / 2;
    if (Math.abs(dist - r) <= halfW) {
      const ang = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
      const rel = (ang - (((startDeg % 360) + 360) % 360) + 360) % 360;
      if (rel <= sweepDeg) return true;
    }
    if (roundCaps && sweepDeg > 0) {
      for (const deg of [startDeg, startDeg + sweepDeg]) {
        const a = (deg * Math.PI) / 180;
        if (Math.hypot(x - (cx + r * Math.cos(a)), y - (cy + r * Math.sin(a))) <= halfW) return true;
      }
    }
    return false;
  };

  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0, t0 = 0, t1 = 0, p0 = 0, p1 = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
          if (inCircleBg(px, py)) bg++;
          if (inArc(px, py, rings[0].r, strokeW * 0.7, 0, 360, false)) t0++;
          if (inArc(px, py, rings[1].r, strokeW * 0.7, 0, 360, false)) t1++;
          if (rings[0].sweep > 0 && inArc(px, py, rings[0].r, strokeW, -90, rings[0].sweep, true)) p0++;
          if (rings[1].sweep > 0 && inArc(px, py, rings[1].r, strokeW, -90, rings[1].sweep, true)) p1++;
        }
      }
      let rgb = BG.slice();
      const blend = (col, a) => { rgb = [0, 1, 2].map((i) => Math.round(col[i] * a + rgb[i] * (1 - a))); };
      if (t0) blend(TRACK, t0 / N);
      if (t1) blend(TRACK, t1 / N);
      if (p0) blend(rings[0].col, p0 / N);
      if (p1) blend(rings[1].col, p1 / N);
      const idx = (y * size + x) * 4;
      pixels[idx] = rgb[0]; pixels[idx + 1] = rgb[1]; pixels[idx + 2] = rgb[2];
      pixels[idx + 3] = Math.round((bg / N) * 255);
    }
  }
  return encodePng(pixels, size);
}

function baseTrayImage() {
  // The 32px asset overflows the ~22pt macOS menu bar — shrink it there.
  return IS_MAC ? ICON().resize({ width: 18, height: 18 }) : ICON();
}

function trayImage() {
  if (latest.state !== 'ok' || latest.sessionPct == null) return baseTrayImage();
  try {
    if (IS_MAC) {
      // 18pt logical size with an @2x representation so Retina stays crisp.
      const img = nativeImage.createEmpty();
      img.addRepresentation({ scaleFactor: 1, buffer: drawUsageIcon(latest.sessionPct, latest.weeklyPct, 18) });
      img.addRepresentation({ scaleFactor: 2, buffer: drawUsageIcon(latest.sessionPct, latest.weeklyPct, 36) });
      return img;
    }
    return nativeImage.createFromBuffer(drawUsageIcon(latest.sessionPct, latest.weeklyPct));
  } catch (_) {
    return baseTrayImage();
  }
}

function createPopup() {
  const saved = loadBounds();
  popup = new BrowserWindow({
    width: (saved && saved.width) || 320,
    height: (saved && saved.height) || 360,
    minWidth: 260,
    minHeight: 300,
    show: false,
    frame: false,
    resizable: true,           // frameless still gets edge resize handles
    movable: true,             // drag by the header (-webkit-app-region)
    maximizable: false,        // header double-click shouldn't maximize
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: '#12161c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  popup.loadFile('popup.html');
  // The popup renders only the bundled local page — it must never open new
  // windows or navigate anywhere (defense-in-depth alongside the page CSP).
  popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  popup.webContents.on('will-navigate', (e) => e.preventDefault());
  if (saved && saved.x != null && saved.y != null) {
    // restore last position if it's still on a connected display
    const onScreen = screen.getAllDisplays().some((d) =>
      saved.x >= d.workArea.x - 50 && saved.x < d.workArea.x + d.workArea.width &&
      saved.y >= d.workArea.y - 50 && saved.y < d.workArea.y + d.workArea.height);
    if (onScreen) { popup.setPosition(saved.x, saved.y); userPlaced = true; }
  }
  popup.on('blur', () => {
    if (popup && !popupPinned && !popup.webContents.isDevToolsOpened()) popup.hide();
  });
  popup.on('hide', () => { popupHiddenAt = Date.now(); });
  popup.on('moved', () => { userPlaced = true; saveBounds(); });
  popup.on('resized', () => { userPlaced = true; saveBounds(); });
}

function createClaudeWindow() {
  claudeWin = new BrowserWindow({
    width: 980,
    height: 760,
    show: false,                     // hidden until login is needed
    title: 'Sign in to Claude',
    webPreferences: {
      partition: 'persist:claude',   // keeps you logged in across restarts
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  claudeWin.loadURL('https://claude.ai/');
  // This window is a real browser for signing in (OAuth may open popups), but
  // child windows are restricted to https so no file:// or custom-scheme
  // window can ever be spawned from page content.
  claudeWin.webContents.setWindowOpenHandler(({ url }) =>
    url.startsWith('https://') ? { action: 'allow' } : { action: 'deny' });
  claudeWin.on('close', (e) => { e.preventDefault(); claudeWin.hide(); }); // don't kill session
}

function showLogin() {
  if (!claudeWin) createClaudeWindow();
  claudeWin.show();
  claudeWin.focus();
}

function positionPopup() {
  const { workArea } = screen.getPrimaryDisplay();
  const [w, h] = popup.getSize();
  if (IS_MAC) {
    // Menu-bar app: drop the popup just below the menu bar, centered under the
    // tray icon when we can read its bounds, clamped to the work area.
    let x = workArea.x + workArea.width - w - 12;
    try {
      const b = tray && tray.getBounds();
      if (b && b.width) x = b.x + b.width / 2 - w / 2;
    } catch (_) {}
    x = Math.max(workArea.x + 8, Math.min(x, workArea.x + workArea.width - w - 8));
    popup.setPosition(Math.round(x), Math.round(workArea.y + 8));
    return;
  }
  const x = Math.round(workArea.x + workArea.width - w - 12);
  const y = Math.round(workArea.y + workArea.height - h - 12);
  popup.setPosition(x, y);
}

function togglePopup() {
  if (!popup) return;
  if (popup.isVisible()) { popup.hide(); return; }
  // Clicking the tray while the popup is open blurs it first (popup hides),
  // then this click handler runs — without this guard it would instantly
  // reopen, so the tray button could never close the popup.
  if (Date.now() - popupHiddenAt < 300) return;
  if (!userPlaced) positionPopup();
  popup.show();
  popup.focus();
  sendToPopup();
}

function sendToPopup() {
  if (popup && !popup.isDestroyed()) popup.webContents.send('usage', latest);
}

function fmtPct(p) { return p == null ? '--' : Math.round(p) + '%'; }

function updateTray() {
  if (!tray) return;
  let tip = 'Claude Usage';
  if (latest.state === 'ok') {
    tip = `5h ${fmtPct(latest.sessionPct)}  ·  wk ${fmtPct(latest.weeklyPct)}`;
  } else if (latest.state === 'login') {
    tip = 'Claude Usage — sign in needed';
  }
  tray.setToolTip(tip);
  tray.setImage(trayImage());   // rings on the taskbar mirror current usage
}

/* ---- the actual data fetch: runs the request INSIDE the logged-in
        claude.ai window so its session cookies are attached automatically ---- */
async function poll() {
  if (DEMO_MODE) {
    const now = Date.now();
    latest = {
      state: 'ok',
      sessionPct: 82,
      sessionReset: now + 2 * 3600e3 + 41 * 60e3,
      weeklyPct: 34,
      weeklyReset: now + 4 * 86400e3 + 3 * 3600e3,
      perModel: [{ label: 'Fable', pct: 12, reset: now + 6 * 86400e3 }],
      updatedAt: now,
      demo: true,
    };
    updateTray(); sendToPopup();
    return;
  }

  if (!claudeWin) createClaudeWindow();

  // If config.js pins USAGE_ENDPOINT we use it verbatim; otherwise we discover
  // the chat org lazily (see usageOrgUuid comment). We pass the cached uuid into
  // the page; if it's null the script fetches the org list and picks one. A 404
  // means the cached uuid is stale (account switched) → clear + retry.
  const script = `
    (async () => {
      try {
        let usageUrl = ${JSON.stringify(USAGE_ENDPOINT)};
        let uuid = null;                       // only set when we auto-discover
        if (!usageUrl) {
          uuid = ${JSON.stringify(usageOrgUuid)};
          if (!uuid) {
            const or = await fetch(${JSON.stringify(ORGS_ENDPOINT)}, { credentials: 'include' });
            if (or.status === 401 || or.status === 403) return { authed: false, status: or.status };
            const orgs = await or.json();
            if (Array.isArray(orgs)) {
              // claude.ai usage lives on a chat-capable org, not an api-only one.
              const chat = orgs.filter((o) => o && Array.isArray(o.capabilities) && o.capabilities.includes('chat'));
              const pick = chat[0] || orgs[0];
              uuid = pick && pick.uuid;
            }
          }
          if (!uuid) return { authed: true, noOrg: true };
          usageUrl = ${JSON.stringify(ORGS_ENDPOINT)} + '/' + uuid + '/usage';
        }
        const r = await fetch(usageUrl, { credentials: 'include' });
        const ct = r.headers.get('content-type') || '';
        if (r.status === 401 || r.status === 403) return { authed: false, status: r.status };
        if (r.status === 404) return { authed: true, stale: true, uuid };
        if (!ct.includes('application/json')) return { authed: false, status: r.status, html: true };
        return { authed: true, status: r.status, uuid, data: await r.json() };
      } catch (e) { return { error: String(e) }; }
    })()
  `;

  try {
    const res = await claudeWin.webContents.executeJavaScript(script, true);
    if (res.error) { latest = { state: 'error', message: res.error, updatedAt: Date.now() }; }
    else if (!res.authed) { latest = { state: 'login' }; }
    else if (res.noOrg) {
      // signed in, but no usable org and no config.js override — nothing to point at
      usageOrgUuid = null;
      latest = { state: 'setup', updatedAt: Date.now() };
    } else if (res.stale) {
      // 404 from the usage URL. If we were auto-discovering (uuid set), the cached
      // org just went stale (e.g. re-login) — forget it so the next poll rediscovers.
      // If a fixed config.js endpoint 404s (no uuid), that URL is wrong → setup.
      usageOrgUuid = null;
      latest = { state: res.uuid ? 'parse' : 'setup', updatedAt: Date.now() };
    } else {
      usageOrgUuid = res.uuid || usageOrgUuid;   // cache the working org
      const parsed = parseUsage(res.data);
      latest = parsed
        ? { state: 'ok', ...parsed, updatedAt: Date.now() }
        : { state: 'parse', updatedAt: Date.now() };
    }
  } catch (e) {
    latest = { state: 'error', message: String(e), updatedAt: Date.now() };
  }
  if (latest.state === 'ok') {
    maybeNotify('session', '5-hour session', latest.sessionPct);
    maybeNotify('weekly', 'weekly usage', latest.weeklyPct);
  }
  updateTray(); sendToPopup();
}

function startPolling() {
  poll();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, POLL_SECONDS * 1000);
}

function buildTray() {
  tray = new Tray(baseTrayImage());
  const menu = Menu.buildFromTemplate([
    { label: 'Refresh now', click: () => poll() },
    { label: 'Sign in to Claude…', click: () => showLogin() },
    { type: 'separator' },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    {
      label: 'Desktop notifications (70% / 90% / 100%)',
      type: 'checkbox',
      checked: notifsEnabled,
      click: (item) => { notifsEnabled = item.checked; saveSetting('notifsEnabled', item.checked); },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.exit(0); } },
  ]);
  tray.setToolTip('Claude Usage');
  tray.on('click', () => togglePopup());
  tray.on('right-click', () => tray.popUpContextMenu(menu));
}

ipcMain.on('refresh', () => poll());
ipcMain.on('login', () => showLogin());
ipcMain.on('set-pinned', (_e, v) => { popupPinned = !!v; });

app.whenReady().then(() => {
  // Also what Windows shows as the notification source, since no Start Menu
  // shortcut is registered with this AUMID to supply a friendlier display name.
  if (process.platform === 'win32') app.setAppUserModelId('CLAUDE USAGE TRACKER');
  // Menu-bar-only app on macOS — no Dock icon.
  if (IS_MAC && app.dock) app.dock.hide();
  // Auto-launch on Windows sign-in once this is the packaged app (a dev run via
  // `npm start` would otherwise register node_modules/electron.exe as the
  // startup target, which breaks the next time you reinstall deps).
  if (app.isPackaged && !app.getLoginItemSettings().openAtLogin) {
    app.setLoginItemSettings({ openAtLogin: true });
  }
  createPopup();
  createClaudeWindow();
  buildTray();
  startPolling();
});

app.on('window-all-closed', (e) => { /* keep running in tray */ });
