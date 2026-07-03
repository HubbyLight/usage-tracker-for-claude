# Claude Usage — Windows tray app

A tiny tray app that shows your **claude.ai 5-hour session** and **weekly** usage
at a glance, so you stop finding out you're throttled mid-prompt.

Left-click the tray icon → popup with both percentages + reset countdowns.
Right-click → Refresh / Sign in / Quit.

---

## 1. Requirements

- **Node.js 18+** on Windows — https://nodejs.org (LTS installer)
- That's it. `npm install` pulls Electron.

## 2. Run it (see the UI first)

```bash
cd claude-usage-tray
npm install
npm start
```

It ships with **DEMO_MODE on**, so it runs immediately with fake numbers
(5h 82%, weekly 34%). Confirm the tray icon + popup look right, then wire real data.

## 3. Wire your real usage

The app reads the *same data the claude.ai Settings → Usage page shows*, by making
the request **inside a logged-in claude.ai window** (its session cookies come along
automatically).

With `DEMO_MODE = false` (the default), there's **nothing to configure**: on each
poll the app calls `/api/organizations`, picks your chat-capable org, and fetches
`/api/organizations/<uuid>/usage`. Because the org id is discovered at runtime, it
keeps working when you sign into a different account (the cached org is dropped and
re-discovered automatically).

Restart (`npm start`). First launch shows **"Sign in to Claude"** → click it, log in
once (the session persists), and the numbers go live.

### Optional: pin a specific org with `config.js`

Personal settings live in `config.js`, which is **git-ignored** (so your account
details never end up in the repo). It's optional — skip it and the app
auto-discovers your org.

Set it up only if you want to force a specific organization (e.g. your account
has more than one and the auto-pick chooses the wrong one):

```bash
cp config.example.js config.js      # Windows: copy config.example.js config.js
```

Then open `config.js` and set your own URL:

```js
module.exports = {
  USAGE_ENDPOINT: 'https://claude.ai/api/organizations/<your-org-uuid>/usage',
};
```

Restart the app. If `config.js` is missing or `USAGE_ENDPOINT` is left blank, the
app falls back to auto-discovery; if a URL is set but wrong, the popup shows
**"setup needed"**.

> If Anthropic ever changes the response field names, the popup shows
> **"check parseUsage"** — only then do you need to touch `parseUsage(json)` in
> `main.js` (it returns `{ sessionPct, sessionReset, weeklyPct, weeklyReset, perModel }`;
> reset is epoch ms or an ISO string — the helper handles both).

## 4. Package to a single .exe (optional)

```bash
npm run dist
```
Produces a portable `.exe` in `dist/`. (Uses electron-builder.)

## 5. Installed copy

A standalone copy also lives at `%LOCALAPPDATA%\Programs\ClaudeUsage\ClaudeUsage.exe`,
with a Desktop and Start Menu shortcut ("Claude Usage") pointing at it. It
registers itself to start with Windows (toggle from the tray's right-click
menu). It shares the same login session as this source folder (same app
`name` in package.json → same userData path), so signing in once covers both.

After editing files in this folder, push the changes to that installed copy
with:
```bash
npm run sync-install
```
then quit (tray → Quit) and relaunch it from the Desktop/Start Menu shortcut.

---

## How it works (short version)

- `main.js` — tray + popup + a hidden `persist:claude` window that holds your
  login. Every `POLL_SECONDS` (20s) it fetches your org's `/usage` endpoint inside
  that window and pushes the result to the popup + redraws the tray rings.
- `renderer.js` / `popup.html` — the readout (percentages, live reset countdowns).
- `preload.js` — the thin, safe bridge between them.

## Honest caveats

- **Unofficial.** The usage endpoint is internal and undocumented. Anthropic can
  change it any time and this will break — you'd re-find it (step 3) and adjust
  `parseUsage`. Fine for a personal tool; don't build a business on it.
- **Reads only your own data, in your own session.** No password sharing, no
  scraping other accounts. Same thing the Usage page already does — just surfaced
  in your tray.
- There's already a free incumbent (ClaudeKarma) for the browser. This is your
  own native Windows version — good to build, learn from, and actually use.

## Next steps (ask Claude to add)

- ~~Concentric ring gauge instead of bars (matches the icon)~~ done
- ~~Desktop notifications at 75% / 90%~~ done — a native Windows notification
  fires once per threshold per window (5-hour session and weekly, tracked
  separately), so it won't repeat every 20s poll. Toggle from the tray's
  right-click menu → **Desktop notifications (75% / 90%)**.
- ~~Per-model weekly breakdown~~ done — accounts with a per-model weekly cap
  (e.g. Fable) get an extra row per model below the two main gauges, pulled
  from the `limits` array's `weekly_scoped` entries. Hidden in compact mode
  (small window) along with the rest of the legend.
- ~~Launch on startup + start hidden in tray~~ done — right-click the tray
  icon → **Start with Windows** to toggle. Auto-enables itself the first time
  you run the packaged `.exe` (`npm run dist`); a `npm start` dev run leaves
  it off by default so it doesn't register a `node_modules` path as your
  startup target.

All planned next-steps are now implemented.
