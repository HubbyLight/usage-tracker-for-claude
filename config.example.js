'use strict';

/* =========================================================================
 *  Personal config — copy this file to `config.js` and edit it there.
 *
 *  `config.js` is git-ignored, so anything you put here stays on your machine
 *  and never lands in the repo. This example file (with blank values) is the
 *  one that's committed.
 *
 *  You usually DON'T need to set anything: with an empty USAGE_ENDPOINT the app
 *  auto-discovers your claude.ai org at runtime. Only fill it in if you want to
 *  pin a specific organization (e.g. your account has more than one and the
 *  auto-pick chooses the wrong one).
 * ========================================================================= */

module.exports = {
  // Optional. Full usage URL for a specific org. Leave '' to auto-discover.
  // Find it via claude.ai → Settings → Usage with DevTools open (Network tab),
  // it looks like:
  //   https://claude.ai/api/organizations/<your-org-uuid>/usage
  USAGE_ENDPOINT: '',
};
