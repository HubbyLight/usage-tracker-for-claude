# Changelog

## 0.2.4

- **Tray menu "Refresh now" now gives feedback.** It opens the popup and
  replays the count-up, like the popup's own ↻ button. Before, it refreshed
  silently in the background, so on macOS it looked like nothing happened.

## 0.2.3

- **macOS: clicking the menu-bar icon again now closes the popup.** Electron
  fires the window's `hide` event late on macOS, so the click that closed the
  popup immediately reopened it.
- Release `.sha256` files now name the file as GitHub serves it, so
  `shasum -c` works on a download.

## 0.2.2

- **Launch at login is opt-in.** The app no longer adds itself to startup on
  first run; turn it on from the tray menu ("Start with Windows" / "Open at
  Login" on macOS).
- **Windows:** launch-at-login registers the downloaded `.exe` instead of the
  temporary copy the portable build unpacks into `%TEMP%`.
- Each release file now ships with a `.sha256` checksum.
- README: privacy & security section, download verification.

## 0.2.1 and earlier

See the [commit history](https://github.com/HubbyLight/usage-tracker-for-claude/commits/main).
