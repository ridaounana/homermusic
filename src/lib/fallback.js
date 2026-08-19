'use strict';

/**
 * Finds the same song on a different source after playback fails.
 *
 * A single source failing is routine rather than exceptional: YouTube refuses
 * datacenter IPs ("Sign in to confirm you're not a bot"), and SoundCloud
 * returns 404 for the stream of Go+ / label-restricted uploads. Both cases
 * resolve fine at search time and only break when the stream is fetched, so
 * the failure always surfaces as a dead track rather than an empty search.
 * Retrying the same song elsewhere turns that dead end into playable audio.
 */

// ytmsearch and ytsearch are the same upstream: if YouTube refuses one it will
// refuse the other, so a family retires as a unit rather than per prefix.
const FAMILIES = [
  { name: 'soundcloud', prefixes: ['scsearch'] },
  { name: 'youtube', prefixes: ['ytmsearch', 'ytsearch'] },
  { name: 'deezer', prefixes: ['dzsearch'] },
  { name: 'applemusic', prefixes: ['amsearch'] },
];

// Each attempt costs a search plus a stream fetch, so cap it - a track nobody
// can play should fail fast rather than stall the queue.
const MAX_ATTEMPTS = 4;

// Two failures from one family means the source itself is refusing us (a
// blocked IP, a disabled source) rather than one bad upload, so stop asking it.
const FAILURES_PER_FAMILY = 2;

/** Which family a track came from, or null if it is not one we can retry. */
function familyOf(track) {
  const name = String(track?.info?.sourceName || '').toLowerCase();
  if (!name) return null;
  if (name.includes('soundcloud')) return 'soundcloud';
  if (name.includes('youtube')) return 'youtube';
  if (name.includes('deezer')) return 'deezer';
  if (name.includes('apple')) return 'applemusic';
  return null;
}

/**
 * "Artist Title" with the noise that throws off a cross-source match removed.
 * A YouTube title like "Daft Punk - One More Time (Official Video) [HD]" has
 * to become something SoundCloud can match.
 */
function buildQuery(track) {
  const info = track?.info || {};
  const title = String(info.title || '')
    .replace(/\((?:[^)]*\b(?:official|music|lyric|audio|video|hd|4k|remaster(?:ed)?)\b[^)]*)\)/gi, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const author = String(info.author || '').replace(/\s*-\s*topic$/i, '').trim();
  // A YouTube title is usually "Artist - Title" already; repeating the author
  // then skews the match, so only prepend it when it is not already there.
  const hasAuthor = author && title.toLowerCase().includes(author.toLowerCase());
  return (hasAuthor ? title : `${author} ${title}`).replace(/\s+/g, ' ').trim();
}

/** Comparable word set: lowercase, punctuation stripped, short words dropped. */
function keywords(text) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return new Set(words);
}

/**
 * Is `candidate` plausibly the same song as `original`?
 *
 * Without this the retry walks away from what was asked for: a weak search
 * returns whatever is top of the list, that result fails too, and the next
 * round searches using *its* title. Two hops in, "CAMEMBERT" had become
 * "CRITALITY IRELIA! YES, YOU READ IT RIGHT!". Playing an unrelated song is
 * worse than admitting the track could not be played.
 */
function isSameSong(original, candidate) {
  // Match on the TITLE's words specifically. Pooling title and artist together
  // lets a different song by the right artist through: "CAMEMBERT" by ZKR
  // scored exactly 0.5 against "GTS" by Zkr on the artist alone.
  const wanted = keywords(original?.title);
  // Compare against title AND author, because sources split them differently -
  // SoundCloud files the same track as "ElGrandeToto - Mghayer" by "Acoustician".
  const got = keywords(`${candidate?.title || ''} ${candidate?.author || ''}`);

  if (!wanted.size) {
    // Title is all very short words ("Up", "OK"); nothing to score, so require
    // the titles to be the same once punctuation and case are removed.
    const plain = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    return Boolean(plain(original?.title)) && plain(original?.title) === plain(candidate?.title);
  }

  let hits = 0;
  for (const word of wanted) if (got.has(word)) hits += 1;
  return hits / wanted.size >= 0.5;
}

/** Families that have failed enough times to be considered unavailable. */
function deadFamilies(failures) {
  const counts = new Map();
  for (const f of failures) {
    if (!f?.family) continue;
    counts.set(f.family, (counts.get(f.family) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= FAILURES_PER_FAMILY)
    .map(([name]) => name);
}

/**
 * Finds the same song somewhere that will actually stream.
 *
 * `origin` must always be the track the user asked for, never the previous
 * fallback - the query is rebuilt from it every round, so passing the last
 * failure instead lets the search drift away from the request.
 *
 * `failures` is the list of { uri, family } that already failed for this song.
 * The family the origin came from is retried first unless it looks dead: a
 * SoundCloud 404 is usually one restricted upload, and a different upload of
 * the same song commonly plays, so retiring the whole source on one failure
 * would throw away the best match. Returns { track, source } or null.
 */
async function findAlternative(player, origin, requester, failures = []) {
  const query = buildQuery(origin);
  if (!query) return null;

  const failedUris = new Set(failures.map((f) => f?.uri).filter(Boolean));
  failedUris.add(origin?.info?.uri);
  const dead = deadFamilies(failures);

  const originFamily = familyOf(origin);
  const ordered = [
    ...FAMILIES.filter((f) => f.name === originFamily),
    ...FAMILIES.filter((f) => f.name !== originFamily),
  ].filter((f) => !dead.includes(f.name));

  for (const family of ordered) {
    for (const prefix of family.prefixes) {
      let result;
      try {
        result = await player.search({ query: `${prefix}:${query}` }, requester);
      } catch {
        continue; // source disabled or unreachable - try the next one
      }
      const hit = (result?.tracks || []).find(
        (t) => t?.info?.uri
          && !failedUris.has(t.info.uri)
          && isSameSong(origin?.info, t.info),
      );
      if (hit) return { track: hit, source: family.name };
    }
  }
  return null;
}

module.exports = {
  findAlternative, familyOf, buildQuery, deadFamilies, isSameSong,
  MAX_ATTEMPTS, FAILURES_PER_FAMILY, FAMILIES,
};
