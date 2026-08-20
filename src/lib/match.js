'use strict';

/**
 * Picks the recording that was actually asked for.
 *
 * Searching YouTube for "artist title" does not reliably return the song. AI
 * covers, "sped up", "slowed + reverb" and lyric-video re-uploads are uploaded
 * in bulk and routinely outrank the real master, so taking the first result
 * plays something that is not the track.
 *
 * Spotify hands over two things that settle it: an exact duration and an ISRC,
 * the unique id of a specific recording. A cover is a different recording, so
 * it has a different ISRC and almost never lands within a couple of seconds of
 * the original's length.
 */

// Words that mark a different recording of the same song. Only counted when
// the requested title does not contain them - asking for a remix should still
// find the remix.
const VARIANT_WORDS = [
  'ai cover', 'ai-cover', 'cover', 'remix', 'bootleg', 'mashup', 'flip',
  'sped up', 'spedup', 'speed up', 'slowed', 'reverb', 'nightcore', 'daycore',
  'karaoke', 'instrumental', 'acapella', 'a cappella', '8d audio', '8d',
  'live', 'concert', 'tribute', 'in the style of', 'made popular by',
  'lyrics video', 'lyric video', 'reaction', 'tutorial', 'loop', 'extended',
];

const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));

/** Variant words present in the candidate but not asked for. */
function unwantedVariants(wantTitle, candidateText) {
  const wanted = norm(wantTitle);
  const got = norm(candidateText);
  return VARIANT_WORDS.filter((w) => got.includes(norm(w)) && !wanted.includes(norm(w)));
}

/** Fraction of the requested title's words present in the candidate. */
function titleOverlap(wantTitle, candidate) {
  const want = words(wantTitle);
  if (!want.size) return 0;
  const got = words(`${candidate.title || ''} ${candidate.author || ''}`);
  let hits = 0;
  for (const w of want) if (got.has(w)) hits += 1;
  return hits / want.size;
}

function authorMatches(wantAuthor, candidateAuthor) {
  const a = norm(wantAuthor);
  const b = norm(candidateAuthor).replace(/\s+topic$/, ''); // "Artist - Topic"
  if (!a || !b) return false;
  if (a === b) return true;
  // Featured artists mean one side is often a prefix of the other.
  return a.includes(b) || b.includes(a);
}

/**
 * Scores one candidate. Higher is better; null means reject outright.
 * `want` is { title, author, duration, isrc }.
 */
/** Lavalink's REST calls it `length`; lavalink-client maps it to `duration`. */
function lengthOf(info) {
  const v = Number.isFinite(info?.duration) ? info.duration : info?.length;
  return Number.isFinite(v) ? v : NaN;
}

function score(want, info) {
  if (!info?.title) return null;

  // An exact ISRC match is the same recording by definition - nothing else can
  // outrank it, and no penalty should be able to discard it.
  if (want.isrc && info.isrc && String(want.isrc).toUpperCase() === String(info.isrc).toUpperCase()) {
    return 1000;
  }

  const overlap = titleOverlap(want.title, info);
  // Too little of the requested title survived - this is a different song.
  if (overlap < 0.5) return null;

  let points = overlap * 100;

  const candidateLength = lengthOf(info);
  if (Number.isFinite(want.duration) && want.duration > 0 && Number.isFinite(candidateLength)) {
    const delta = Math.abs(candidateLength - want.duration);
    if (delta <= 2000) points += 120;
    else if (delta <= 5000) points += 70;
    else if (delta <= 10000) points += 20;
    else if (delta > 30000) points -= 120; // a very different length is a different cut
    else points -= 40;
  }

  if (authorMatches(want.author, info.author)) points += 90;
  // YouTube's auto-generated "Artist - Topic" channels carry the label upload.
  if (/\s-\s*topic$/i.test(String(info.author || ''))) points += 60;

  // The decisive one for AI covers: heavily penalised, never silently chosen.
  const variants = unwantedVariants(want.title, `${info.title} ${info.author}`);
  points -= variants.length * 150;

  if (info.isStream) points -= 100; // a radio stream is not the track

  return points;
}

/**
 * Best candidate, or null when nothing is close enough.
 * `minScore` keeps a bad field from being played just because it is the least
 * bad - reporting a failure beats playing an AI cover.
 */
function pickBest(want, candidates, { minScore = 0 } = {}) {
  let best = null;
  let bestScore = -Infinity;
  for (const track of candidates || []) {
    const points = score(want, track?.info);
    if (points === null) continue;
    if (points > bestScore) { bestScore = points; best = track; }
  }
  return bestScore >= minScore ? best : null;
}

/** Search terms to try, best-discriminating first. */
function queries(want) {
  const out = [];
  // An ISRC identifies one recording, so YouTube Music returns the master.
  if (want.isrc) out.push(`"${want.isrc}"`);
  const title = String(want.title || '').trim();
  const author = String(want.author || '').trim();
  if (author && title) out.push(`${author} ${title}`);
  if (title) out.push(title);
  return out;
}

module.exports = {
  pickBest, score, queries, titleOverlap, authorMatches, unwantedVariants,
  lengthOf, VARIANT_WORDS,
};
