# Changelog

## 0.2.7 — unreleased

- **Security: Electron 31 → 44.** 31 was long out of support; the sign-in
  window renders live web pages, so it needs current Chromium security fixes.
  electron-builder 24 → 26.
- **Security: the login cookie is encrypted on disk** (OS keychain on macOS,
  DPAPI on Windows). macOS may ask once per update to allow keychain access.
- **Security: hardened runtime switches.** Release builds can't be run as
  plain Node.js and ignore `NODE_OPTIONS` / `--inspect`; app code loads only
  from `app.asar`.
- CI builds on Node 24. Running from source needs Node 22+; the README no
  longer needs an `xattr` step before the first `npm start`.

## 0.2.6 — 2026-10-02

- **Security:** links clicked inside the sign-in window open in your default
  browser instead of an in-app window that shares the login session. Only
  claude.ai and the sign-in providers open in-app.
- **Security:** the usage poll runs only when the sign-in window is on
  claude.ai. If the hidden window has wandered elsewhere, it is sent back
  first.
- CI: third-party GitHub Actions are pinned to commit SHAs.
- README: documents that the login cookie is stored unencrypted on disk.

## 0.2.5 — 2026-10-02

- Usage percentages (ring view, horizontal and vertical bars) are now bold;
  the small "used" label stays regular weight.

## 0.2.4 — 2026-10-01

- **Tray menu "Refresh now" now gives feedback.** It opens the popup and
  replays the count-up, like the popup's own ↻ button. Before, it refreshed
  silently in the background, so on macOS it looked like nothing happened.

## 0.2.3 — 2026-10-01

- **macOS: clicking the menu-bar icon again now closes the popup.** Electron
  fires the window's `hide` event late on macOS, so the click that closed the
  popup immediately reopened it.
- Release `.sha256` files now name the file as GitHub serves it, so
  `shasum -c` works on a download.

## 0.2.2 — 2026-10-01

- **Launch at login is opt-in.** The app no longer adds itself to startup on
  first run; turn it on from the tray menu ("Start with Windows" / "Open at
  Login" on macOS).
- **Windows:** launch-at-login registers the downloaded `.exe` instead of the
  temporary copy the portable build unpacks into `%TEMP%`.
- Each release file now ships with a `.sha256` checksum.
- README: privacy & security section, download verification.

## 0.2.1 — 2026-08-13

- **macOS: runs on Apple Silicon.** CI had signing fully disabled, and Apple
  Silicon refuses to launch a completely unsigned binary. Builds are now
  ad-hoc signed and universal (arm64 + x64).
- README: step-by-step Gatekeeper workaround, run-from-source path, and an
  honest note that the latest macOS may still block unsigned downloads.

## 0.2.0 — 2026-08-13

- **Public GitHub Releases.** Pushing a version tag builds Windows and macOS
  on GitHub Actions and attaches the `.exe` / `.dmg` / `.zip` to a release —
  a login-free download link instead of Actions artifacts.

## Before 0.2.0 — July 2026

Development before tagged releases (first commit 2026-07-03):

- Windows tray app: popup with 5-hour and weekly usage, reset countdowns, and
  a tray icon drawn as a live dual-ring gauge.
- Runtime org discovery — no account-specific id in the code.
- Desktop notifications at 70 / 90 / 100%, each once per usage window.
- macOS menu-bar support and cloud builds (2026-07-10).
- Responsive popup: rings, horizontal bars (wide), vertical bars (tall), and
  priority-based collapse when space runs out (2026-07-12).

Full detail: [commit history](https://github.com/HubbyLight/usage-tracker-for-claude/commits/main).
