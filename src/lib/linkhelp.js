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

  if (kind === 'playlist') {
    const generated = /^37i9dQ/i.test(id);
    return generated
      ? 'Spotify **generated** playlists (Discover Weekly, Daily Mix, Radio, '
        + 'the editorial charts) cannot be read through the API at all — Spotify '
        + 'blocks them for third-party apps.\nPaste a **track** link, or an '
        + 'ordinary playlist you or someone else made, and I can work with that.'
      : 'Spotify no longer lets apps read the contents of a playlist without '
        + 'signing in as a Spotify user, so I cannot see what is in it.\n'
        + 'Track links work fine, and YouTube or SoundCloud playlists work too.';
  }

  if (kind === 'album') {
    return 'Spotify is refusing the bulk track lookup this album needs.\n'
      + 'A single **track** link works, as does searching the album by name.';
  }

  if (kind === 'artist') {
    return 'Artist links are not supported. Search the artist by name instead, '
      + 'or paste one of their track links.';
  }

  return null;
}

module.exports = { describeFailure, SPOTIFY };
