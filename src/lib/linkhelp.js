'use strict';

/**
 * Turns a failed lookup into an explanation of what actually went wrong.
 *
 * "No results for <url>" is misleading for a link: the track was found, the
 * source simply refused to hand it over. Saying so — and saying what does work
 * — saves the user retrying the same link.
 */

const SPOTIFY = /(?:open\.spotify\.com|spotify:)(?:\/|:)?(?:intl-[a-z]{2}\/)?(track|album|playlist|artist)[/:]([A-Za-z0-9]+)/i;

/**
 * Spotify locked several Web API endpoints for applications created after
 * 2024-11-27. With app credentials alone:
 *   - a playlist's tracks cannot be read at all (401 on /items, and the
 *     playlist object comes back with its track list stripped),
 *   - Spotify's own generated playlists (the 37i9dQ… ids behind Discover
 *     Weekly, Daily Mix, Radio and the editorial charts) 404 outright,
 *   - the batch /tracks?ids= lookup is 403, which is what breaks albums.
 * Single track links are unaffected.
 */
function describeFailure(query) {
  const m = String(query || '').match(SPOTIFY);
  if (!m) return null;

  const kind = m[1].toLowerCase();
  const id = m[2];

  // Playlists and albums are resolved through the public embed before this is
  // ever reached, so getting here means the link itself could not be read.
  if (kind === 'playlist') {
    return 'Could not read that Spotify playlist. If it is **private**, Spotify '
      + 'does not show it to anyone who is not signed in as you — make it public, '
      + 'or paste the tracks individually.';
  }

  if (kind === 'album') {
    return 'Could not read that Spotify album. Check the link, or search the '
      + 'album by name instead.';
  }

  if (kind === 'artist') {
    return 'Artist links are not supported. Search the artist by name instead, '
      + 'or paste one of their track links.';
  }

  return null;
}

module.exports = { describeFailure, SPOTIFY };
