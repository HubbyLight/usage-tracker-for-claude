# How it was built: decisions and debugging notes

The [README](../README.md) explains what the app does. These notes are about
why it works the way it does: the trade-offs I picked, and the bugs that took
real digging. Commit hashes are linked so you can check each claim against the
code.

Started 2026-07-03. Runs on Windows and macOS. Electron, no runtime
dependencies.

---

## Why I built it

claude.ai has a 5-hour limit and a weekly limit, and the only place to see
either was Settings → Usage in a browser tab. I kept running into the limit in
the middle of something with no warning. What I wanted was a number that's
always on screen, the way a battery percentage is, plus a nudge before I run
out.

---

## Design decisions

### 1. The app never handles login credentials

The easy way to call the usage API would be to copy the session cookie out of
a browser. I didn't want to write an app that touches login cookies at all.
So you sign in to claude.ai inside the app's own window, and the request runs
in that page (`executeJavaScript` with `credentials: 'include'`). The browser
attaches the cookie the same way it would on claude.ai. My code never reads,
stores, or sends the token.

A few other things keep the surface small. The popup runs with a strict
Content-Security-Policy, `contextIsolation`, and no Node integration, and it
can't open windows or navigate anywhere. The sign-in window only opens new
windows in-app for claude.ai and the sign-in providers; any other link goes to
your default browser, so random sites never load inside the logged-in session.
The poll script also checks that the window is actually on claude.ai before it
runs. Error text from the network is
HTML-escaped before it's shown, since it goes into `innerHTML`. And
`.gitignore` lists Chromium's session files, in case a profile folder ever
ends up inside the repo by accident.

See [`main.js`](../main.js): `poll()`, `createPopup()`, `createClaudeWindow()`.

### 2. No personal ids in a public repo

The usage endpoint includes an organization uuid. If I hard-coded mine, the
repo would publish an account identifier and the app wouldn't work for anyone
else. Instead the app looks the org up from `/api/organizations` at runtime,
caches it, and looks it up again if it stops working (a 404 after you switch
accounts, for example). For the rare account with several orgs, an optional
`config.js` can pin one, and git ignores that file.

### 3. Most of the information lives in the tray icon

Most of the time nobody opens the popup, so the icon has to do the work. It's
redrawn on every poll as two rings, session outside and weekly inside, that
fill with usage and turn red at 90%. Electron's main process has no canvas, so
I rasterize the rings by hand with 4×4 supersampling for anti-aliasing, then
wrap the pixels in a small PNG encoder written from scratch (CRC32 plus zlib).
That's why the app has no graphics dependency. On macOS it also produces a 2×
version so the menu bar icon stays sharp on Retina screens.

See [`main.js`](../main.js): `drawUsageIcon()`, `encodePng()`.

### 4. The popup adapts to whatever size you drag it to

People resize the popup to fit their screen, so the layout follows the
window's shape. A roughly square window shows rings, a wide one shows
horizontal bars, a tall one shows vertical bars, and a small one gets a
compact view. When there isn't room for everything, rows disappear in a fixed
order (per-model caps first, then weekly), and the 5-hour session is always
the last one left.

Commits [`010659b`](https://github.com/HubbyLight/usage-tracker-for-claude/commit/010659b)
through [`fda7c8c`](https://github.com/HubbyLight/usage-tracker-for-claude/commit/fda7c8c).

### 5. Getting builds to people who don't use GitHub

Downloading a GitHub Actions artifact requires a GitHub login, which is a lot
to ask of someone who just wants the app. Now pushing a version tag builds
both platforms in CI and publishes a public Release
([`ba49a36`](https://github.com/HubbyLight/usage-tracker-for-claude/commit/ba49a36)).
Every file in a release ships with a `.sha256` checksum, so anyone can confirm
their download is the one CI built.

### 6. Naming and credit

I renamed the project so it wouldn't look like an official Anthropic product,
and the README has a trademark disclaimer. I built it with Claude as a
pair-programming assistant, and the README says that too.

---

### 7. Locking down the runtime (0.2.7)

A security pass turned up two problems. The first was that the login cookie
sat on disk unencrypted, because Electron leaves cookie encryption off unless
you turn it on. I checked the actual cookie database to confirm it rather than
assume. The second was Electron 31, which was long out of support, in an app
whose sign-in window renders live web pages.

The app is now on Electron 44, and the release builds flip Electron's "fuses"
(switches compiled into the binary). Cookie encryption is on, so the session
is protected by the OS keychain the way Chrome protects it. `RunAsNode`,
`NODE_OPTIONS`, and `--inspect` are off, so nobody can reuse the signed app
binary as a general-purpose Node.js runtime, and the app only loads code from
its own `app.asar`. I verified the fuses by reading them back from a local
build.

---

## Bugs that took some digging

### Notifications that kept repeating ([`e064a4f`](https://github.com/HubbyLight/usage-tracker-for-claude/commit/e064a4f))

The "90% used" alert kept coming back at random intervals, sometimes twice in
one minute. The code decided whether a new usage window had started by
comparing the API's `resets_at` timestamp, and that timestamp drifts by a few
seconds between otherwise identical responses. Each time the drift crossed a
minute boundary, the app treated it as a new window and alerted again.

I switched to a signal that doesn't drift: alerts re-arm only once usage
falls below 70%, which only happens when the window has really reset. What I
took from it is to check whether a value is actually stable before building
state on top of it, even when it looks stable.

### The release got flagged as malware (2026-10, [`b34b193`](https://github.com/HubbyLight/usage-tracker-for-claude/commit/b34b193))

First I made sure the build hadn't been tampered with. I unpacked the shipped
`app.asar` and diffed it against the source, and they were identical. That
left the question of why a clean app looked malicious, and I found two
reasons. On first run the app added itself to startup without asking. And the
Windows build is a portable exe that unpacks into `%TEMP%` each time it
launches, so the startup entry pointed at a program inside a temp folder.
That's a textbook malware pattern, and it was also just broken, because the
temp copy gets deleted.

Now launch-at-login is off until you turn it on from the tray menu, and it
registers the exe you actually downloaded (`PORTABLE_EXECUTABLE_FILE`).
Releases ship with checksums, and the README lists every network call and
every file the app writes. The bigger lesson for me was that harmless intent
doesn't count for much if the behavior looks identical to malware from the
outside.

### macOS: clicking the menu bar icon reopened the popup instead of closing it ([`972977c`](https://github.com/HubbyLight/usage-tracker-for-claude/commit/972977c))

On Windows a second click on the tray icon closed the popup. On macOS it
closed and instantly reopened. Here's the sequence: the click blurs the popup,
the blur handler hides it, and then the click handler runs. The click handler
is supposed to skip reopening if the popup hid within the last 300 ms, and it
got that time from the window's `hide` event. Windows fires that event
immediately. On macOS, Electron fires it from an occlusion notification that
arrives later, after the click handler has already checked the time and
reopened the popup.

The fix was to record the time at the line that hides the window instead of
waiting for the event. I'd assumed events arrive in the same order on every
OS, and they don't.

### "Refresh now" looked broken ([`cb7d110`](https://github.com/HubbyLight/usage-tracker-for-claude/commit/cb7d110))

The tray menu's refresh worked fine, but it updated a hidden popup, so from
the user's side nothing happened. It now opens the popup and replays the
count-up animation. A working action with no visible result looks the same to
users as a broken one.

### Apple Silicon wouldn't launch the app ([`c7bb80d`](https://github.com/HubbyLight/usage-tracker-for-claude/commit/c7bb80d), [`8acbc92`](https://github.com/HubbyLight/usage-tracker-for-claude/commit/8acbc92))

CI had code signing switched off completely, and Apple Silicon refuses to run
a binary with no signature at all, quarantine or not. Ad-hoc signing a
universal build fixed the launch. Newer macOS (Sequoia) also wants a local
re-sign, so the README walks through that step by step, and it's upfront that
the latest macOS may still block a download that Apple hasn't notarized.

---

## What I'd do next

Real code signing (an Apple Developer ID with notarization, and Authenticode
on Windows) is the actual fix for the antivirus and Gatekeeper trouble.
Everything above works around the problem without solving it.

I'd also add tests for `parseUsage()` and the notification re-arm logic. Both
are pure functions, so they're easy to test, and a regression in either would
hit users directly.
