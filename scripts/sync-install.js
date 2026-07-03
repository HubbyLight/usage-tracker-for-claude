'use strict';
// Copies the app source files into the installed standalone copy at
// %LOCALAPPDATA%\Programs\ClaudeUsage\resources\app so edits made here show
// up next time the installed app is relaunched. Run: npm run sync-install
const fs = require('fs');
const path = require('path');

const SRC = __dirname + '/..';
const DEST = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ClaudeUsage', 'resources', 'app');
// config.js is intentionally NOT synced — it's personal/git-ignored, and the
// installed copy falls back to auto-discovery when it's absent.
const FILES = ['main.js', 'preload.js', 'renderer.js', 'popup.html', 'config.example.js', 'package.json', 'icon.png', 'icon-256.png', 'icon.ico'];

if (!fs.existsSync(DEST)) {
  console.error(`Installed app not found at ${DEST}. Nothing to sync.`);
  process.exit(1);
}

for (const f of FILES) {
  fs.copyFileSync(path.join(SRC, f), path.join(DEST, f));
  console.log(`synced ${f}`);
}
console.log('Done. Quit and relaunch Claude Usage from the tray/Desktop shortcut to pick up changes.');
