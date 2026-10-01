# How it was built — decisions & debugging notes

The [README](../README.md) covers what the app does. This page covers **why it
is built the way it is**: the trade-offs I chose, and the bugs that taught me
something. Each entry links to the commit, so the reasoning can be checked
against the code.

_Started 2026-07-03 · Windows + macOS · Electron, no runtime dependencies._

---

## Why I built it

claude.ai has a 5-hour and a weekly usage limit, and the only way to check
them was to open Settings → Usage in a browser. I kept hitting the limit
mid-task without warning. I wanted the number always visible — in the
taskbar, like a battery indicator — and a heads-up before running out.

---

## Design decisions

### 1. Never touch the user's credentials

The obvious way to call the usage API is to copy the session cookie out of the
browser. I didn't want an app that handles login cookies at all. Instead, the
user signs in to claude.ai inside the app's own window, and the request runs
**inside that page** (`executeJavaScript` with `credentials: 'include'`), so
the browser attaches the cookie itself. The app's code never reads, stores, or
sends the token anywhere.

Hardening around that:
- The popup has a strict Content-Security-Policy, `contextIsolation`, no Node
  integration, and refuses to open windows or navigate.
- The sign-in window may only open `https://` child windows (OAuth popups).
- Error text from the network is HTML-escaped before display, because it ends
  up in an `innerHTML` sink.
- `.gitignore` defensively excludes Chromium session files in case a profile
  ever lands inside the repo.

→ [`main.js`](../main.js) `poll()`, `createPopup()`, `createClaudeWindow()`

### 2. No personal ids in a public repo

The usage endpoint is scoped to an organization uuid. Hard-coding mine would
publish an account identifier and break for everyone else. The app discovers
the org at runtime from `/api/organizations`, caches it, and rediscovers it
automatically when it goes stale (a 404 after switching accounts). An optional,
git-ignored `config.js` can pin a specific org for edge cases.

### 3. The tray icon is the product

Most of the time nobody opens the popup — the icon itself has to carry the
information. It is redrawn on every poll as two concentric rings (session /
weekly) that sweep with usage and turn red at 90%. Electron's main process
has no canvas, so the rings are **rasterized by hand** (4×4 supersampled
anti-aliasing) and wrapped in a minimal PNG encoder written from scratch
(CRC32 + zlib). That keeps the app free of graphics dependencies. On macOS
it emits 1× and 2× representations so the menu bar stays sharp on Retina.

→ [`main.js`](../main.js) `drawUsageIcon()`, `encodePng()`

### 4. A popup that adapts to any size

Users resize the popup to fit their screen, so it chooses a layout from the
window's shape: rings when it's near-square, horizontal bars when it's wide,
vertical bars when it's tall, and a compact view when it's small. When space
runs out, rows drop in priority order — per-model caps first, then weekly —
and the 5-hour session always stays visible.

→ commits [`010659b`](https://github.com/HubbyLight/usage-tracker-for-claude/commit/010659b) … [`fda7c8c`](https://github.com/HubbyLight/usage-tracker-for-claude/commit/fda7c8c)

### 5. Shipping to people who don't use GitHub

Downloads from GitHub Actions artifacts require a login, so a version tag now
builds both platforms in CI and publishes a public Release
([`ba49a36`](https://github.com/HubbyLight/usage-tracker-for-claude/commit/ba49a36)).
Each binary comes with a `.sha256` checksum, so anyone can verify that a
download is the CI-built original.

### 6. Honest attribution and naming

The project was renamed so it doesn't look like an official Anthropic product,
and the README carries a trademark disclaimer. It was built with Claude as a
pair-programming assistant, and the README says so.

---

## Bugs worth telling

### Notifications that kept repeating — `e064a4f`
**Symptom:** the "90% used" alert fired at irregular intervals, sometimes
twice a minute.
**Cause:** the code used the API's `resets_at` timestamp to tell whether a new
usage window had started. That timestamp jitters by a few seconds between
otherwise identical responses. Whenever the jitter crossed a minute boundary,
the code treated it as a new window and fired the alert again.
**Fix:** key off a stable signal instead. Alerts re-arm only after usage
drops below 70%, which happens only when the window has actually rolled over.
**Lesson:** never derive state from a value that only *looks* constant.

### "Malware" — 2026-10, `b34b193`
**Symptom:** the release was judged to be malware.
**Investigation:** I unpacked the shipped `app.asar` and diffed it against the
source: identical, with no tampering. So the source was clean, and the question
became why it *looks* malicious. Two things did:
- On first run, the app silently registered itself to launch at login.
- The Windows build is a portable exe that unpacks into `%TEMP%` on every
  launch. So the startup entry pointed at an executable **inside a temp
  folder**, which is a classic malware pattern. It was also simply broken,
  because that copy disappears.

**Fix:** launch-at-login is opt-in from the tray menu, it registers the real
downloaded `.exe` (`PORTABLE_EXECUTABLE_FILE`), releases publish checksums,
and the README documents exactly which network calls and files the app uses.
**Lesson:** behaviour that is harmless in intent can still be
indistinguishable from malware. Design so the app's behaviour is clearly benign.

### macOS: the menu-bar icon couldn't close the popup — `972977c`
**Symptom:** on Windows a second tray click closed the popup; on macOS it
reopened it instantly.
**Cause:** the tray click first blurs the popup, which hides it. The click
handler then skips reopening if the popup hid within the last 300 ms. That
"hid at" time was recorded in the window's `hide` event, which Windows fires
synchronously. On macOS Electron emits it from an *occlusion notification*,
asynchronously and **after** the click handler has already run.
**Fix:** record the time where the code actually hides the window, not in
the event.
**Lesson:** event ordering is platform behaviour. Don't rely on it.

### "Refresh now" that looked broken — `cb7d110`
The tray menu's refresh did work, but it updated a hidden popup, so nothing
visibly happened. Now it opens the popup and replays the count-up animation.
**Lesson:** an action that gives no feedback looks the same as one that failed.

### Apple Silicon refused to launch the app — `c7bb80d`, `8acbc92`
CI had signing disabled entirely, and Apple Silicon won't run a completely
unsigned binary, even after clearing quarantine. Ad-hoc signing a universal
build fixed launches. Newer macOS (Sequoia) also needs a local re-sign, which
is documented step by step. The README also warns that the latest macOS may
block an unnotarized download anyway.

---

## What I'd do next

- **Code signing and notarization** (Apple Developer ID, Windows Authenticode).
  This is the real fix for antivirus and Gatekeeper friction; everything above
  is mitigation.
- Automated tests for `parseUsage()` and the notification re-arm logic.
  They're pure functions, so they're easy to test, and they're where
  regressions would hurt most.
