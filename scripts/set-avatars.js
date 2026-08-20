'use strict';
const fs = require('fs');
const path = require('path');
const { config } = require('../src/config');

/**
 * Applies an avatar (and optional banner) to every bot account in the fleet.
 *
 *   npm run avatars              apply
 *   npm run avatars -- --dry-run show what would happen and change nothing
 *
 * Files are matched by position, 1-based, where 1 is the primary:
 *   assets/avatar-1.png   assets/banner-1.png
 *   assets/avatar-2.png   assets/banner-2.png
 *   ...
 *
 * A missing file is skipped rather than treated as an error, so re-running
 * after adding a fifth bot only touches the fifth.
 *
 * Discord rate-limits these hard - a handful per hour per account - and a 429
 * here is answered by waiting rather than hammering, because burning the limit
 * means the remaining bots silently keep the wrong picture.
 */

const API = 'https://discord.com/api/v10/users/@me';
const ASSETS = path.resolve(__dirname, '..', 'assets');
const DRY_RUN = process.argv.includes('--dry-run');

const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
};

/** Discord wants a data URI, and refuses anything over ~10 MB. */
function readImage(stem, index) {
  for (const ext of Object.keys(MIME)) {
    const file = path.join(ASSETS, `${stem}-${index}${ext}`);
    if (!fs.existsSync(file)) continue;
    const bytes = fs.readFileSync(file);
    if (bytes.length > 10 * 1024 * 1024) {
      console.warn(`  ${path.basename(file)} is ${(bytes.length / 1048576).toFixed(1)} MB — Discord's limit is 10 MB, skipping`);
      return null;
    }
    return { data: `data:${MIME[ext]};base64,${bytes.toString('base64')}`, file: path.basename(file) };
  }
  return null;
}

async function patch(token, body) {
  const res = await fetch(API, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    const info = await res.json().catch(() => ({}));
    return { ok: false, retryAfter: Number(info.retry_after) || 60, error: 'rate limited' };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, error: `HTTP ${res.status} ${text.slice(0, 120)}` };
  }
  return { ok: true, user: await res.json() };
}

(async () => {
  const accounts = [
    { token: config.token, name: config.botName },
    ...config.fleet,
  ].filter((a) => a.token);

  if (!accounts.length) {
    console.error('No bot accounts configured.');
    process.exit(1);
  }

  console.log(`${accounts.length} account(s)${DRY_RUN ? '  [dry run]' : ''}\n`);
  let changed = 0;

  for (const [i, account] of accounts.entries()) {
    const index = i + 1;
    const avatar = readImage('avatar', index);
    const banner = readImage('banner', index);
    const label = account.name || `#${index}`;

    if (!avatar && !banner) {
      console.log(`  ${index}. ${label}: no assets/avatar-${index}.* — skipped`);
      continue;
    }

    const body = {};
    if (avatar) body.avatar = avatar.data;
    if (banner) body.banner = banner.data;
    const files = [avatar?.file, banner?.file].filter(Boolean).join(' + ');

    if (DRY_RUN) {
      console.log(`  ${index}. ${label}: would apply ${files}`);
      continue;
    }

    const result = await patch(account.token, body);
    if (result.ok) {
      console.log(`  ${index}. ${result.user.username}: applied ${files}`);
      changed += 1;
    } else if (result.retryAfter) {
      // Stop rather than continue: the rest would fail the same way, and half
      // an applied set is worse than none.
      console.error(`  ${index}. ${label}: rate limited, retry in ${Math.ceil(result.retryAfter)}s — stopping`);
      break;
    } else {
      console.error(`  ${index}. ${label}: ${result.error}`);
    }
    // Space the requests out; these endpoints are strict.
    if (i < accounts.length - 1) await new Promise((r) => setTimeout(r, 1500));
  }

  if (!DRY_RUN) console.log(`\n${changed}/${accounts.length} updated.`);
})();
