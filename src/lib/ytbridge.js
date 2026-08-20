'use strict';
const { YoutubeAudioCache } = require('./ytdlp');

/**
 * Decides whether a YouTube track should be played through Lavalink or fetched
 * with yt-dlp first, and remembers which of those is currently working.
 *
 * yt-dlp started as a recovery step: let Lavalink try, and re-fetch the video
 * when it failed. That is right when failures are occasional. It is wrong when
 * YouTube is refusing this IP outright, because then *every* track has to fail
 * before it can play - and each failure means an exception, a queue advance by
 * autoSkip, a recovery search and a replacement fighting for the same slot.
 * A 25-track playlist did that 25 times, which is what made playback look like
 * it was skipping and spamming.
 *
 * So failures are counted. Once YouTube has refused twice, it is treated as
 * degraded and YouTube tracks are fetched with yt-dlp *before* Lavalink is
 * asked to play them - no failure, no recovery, no queue churn. The state
 * expires so a temporary block does not permanently disable the fast path.
 */

// Two failures in a row is a blocked IP, not one bad video.
const FAILURES_TO_DEGRADE = 2;
// YouTube blocks lift on their own, so retry the direct path periodically.
const RECHECK_AFTER_MS = 10 * 60 * 1000;

const state = {
  cache: null,
  server: null,
  failures: 0,
  degradedSince: 0,
};

function configure({ cache = null, server = null } = {}) {
  state.cache = cache;
  state.server = server;
}

/** yt-dlp is installed and the loopback file server is up. */
function ready() {
  return Boolean(state.cache?.available?.() && state.server);
}

function degraded() {
  if (!state.degradedSince) return false;
  if (Date.now() - state.degradedSince > RECHECK_AFTER_MS) {
    // Give Lavalink another chance; if it is still blocked the next failure
    // puts us straight back here.
    state.degradedSince = 0;
    state.failures = 0;
    return false;
  }
  return true;
}

function recordFailure() {
  state.failures += 1;
  if (state.failures >= FAILURES_TO_DEGRADE && !state.degradedSince) {
    state.degradedSince = Date.now();
    console.warn('[ytbridge] YouTube playback is failing — fetching with yt-dlp up front');
  }
}

function recordSuccess() {
  if (state.degradedSince) console.log('[ytbridge] YouTube playback is working again');
  state.failures = 0;
  state.degradedSince = 0;
}

/**
 * Turns a YouTube track into a locally served one, or null.
 *
 * `display` supplies what the listener should see. Lavalink reads the local
 * file as an anonymous http track, so its title and artwork come from the
 * container rather than YouTube; playback runs from `encoded`, so overriding
 * the info fields only changes what is shown.
 */
async function toLocalTrack(player, track, display = null) {
  if (!ready()) return null;

  const videoId = YoutubeAudioCache.videoId(track);
  if (!videoId) return null;

  const name = await state.cache.fetch(videoId).catch(() => null);
  if (!name) return null;

  const result = await player
    .search({ query: state.server.urlFor(name) }, track?.requester)
    .catch(() => null);
  const local = result?.tracks?.[0];
  if (!local) return null;

  const from = display?.info || display || track?.info || {};
  Object.assign(local.info, {
    title: from.title ?? local.info.title,
    author: from.author ?? local.info.author,
    artworkUrl: from.artworkUrl ?? local.info.artworkUrl,
    uri: from.uri ?? local.info.uri,
    duration: Number.isFinite(from.duration) ? from.duration : local.info.duration,
    sourceName: 'youtube',
  });
  local.requester = track?.requester ?? display?.requester;
  return local;
}

module.exports = {
  configure, ready, degraded, recordFailure, recordSuccess, toLocalTrack,
  FAILURES_TO_DEGRADE, RECHECK_AFTER_MS, _state: state,
};
