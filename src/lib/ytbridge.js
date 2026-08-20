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
 * asked to play them - no failure, no recovery, no queue churn.
 *
 * Recovery is by expiry alone, deliberately. The obvious alternative - clear
 * the state when a YouTube track plays successfully - cannot tell a real stream
 * from a cached file, because a cached file is given YouTube's name and artwork
 * so that it displays correctly. Worse, lavalink-client resolves the *next*
 * track before the current one reports starting, so any shared flag describes
 * the wrong track. Every cached play then cleared the state and the following
 * track went back to failing. A timer has none of those failure modes: after
 * the window the direct path is simply tried again, and if YouTube is still
 * refusing, two failures put it back.
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
  // always | auto | never
  mode: 'always',
};

function configure({ cache = null, server = null, mode = 'always' } = {}) {
  state.cache = cache;
  state.server = server;
  state.mode = ['always', 'auto', 'never'].includes(mode) ? mode : 'always';
}

/**
 * Should this YouTube track be fetched with yt-dlp instead of streamed by
 * Lavalink?
 *
 * `always` is the default because Lavalink's YouTube source and yt-dlp are not
 * equally reliable from a datacenter IP: the plugin gets refused by every
 * client for long stretches, while yt-dlp keeps working. Waiting for failures
 * before switching means each switch costs a dead track, a queue advance and a
 * reordered playlist - and the state then has to be un-set, which is where it
 * kept going wrong. Fetching up front every time removes the decision.
 *
 * Lavalink still does everything else: search, decoding, filters, the voice
 * connection. Only the fetching of YouTube audio moves.
 *
 * `auto` keeps the old behaviour of only stepping in once YouTube has refused
 * twice, for hosts where the direct path is reliable and the ~2s and disk of a
 * fetch are not worth paying by default.
 */
function shouldBypass() {
  if (!ready() || state.mode === 'never') return false;
  if (state.mode === 'always') return true;
  return degraded();
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

  const name = await state.cache.fetch(videoId).catch((e) => {
    console.warn(`[ytbridge] fetch threw for ${videoId}:`, e?.message || e);
    return null;
  });
  if (!name) {
    // Falling back means handing Lavalink a track that will very likely fail,
    // so it is worth saying which video and not just silently degrading.
    console.warn(`[ytbridge] could not cache ${videoId} — falling back to Lavalink`);
    return null;
  }

  const result = await player
    .search({ query: state.server.urlFor(name) }, track?.requester)
    .catch((e) => {
      console.warn(`[ytbridge] loading cached ${name} failed:`, e?.message || e);
      return null;
    });
  const local = result?.tracks?.[0];
  if (!local) {
    console.warn(`[ytbridge] Lavalink would not load cached ${name}`);
    return null;
  }

  const from = display?.info || display || track?.info || {};
  Object.assign(local.info, {
    title: from.title ?? local.info.title,
    author: from.author ?? local.info.author,
    artworkUrl: from.artworkUrl ?? local.info.artworkUrl,
    uri: from.uri ?? local.info.uri,
    duration: Number.isFinite(from.duration) ? from.duration : local.info.duration,
    sourceName: 'youtube',
  });
  // The display fields above make this look like a YouTube track, which is the
  // point - but it must not be mistaken for evidence that YouTube is working,
  // or every cached track would clear the degraded state and the next one would
  // go back to failing first.
  local.info.ytdlpCached = true;
  local.requester = track?.requester ?? display?.requester;
  return local;
}

module.exports = {
  configure, ready, degraded, shouldBypass, recordFailure, recordSuccess,
  toLocalTrack, FAILURES_TO_DEGRADE, RECHECK_AFTER_MS, _state: state,
};
