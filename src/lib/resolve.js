'use strict';
const { TrackSymbol, UnresolvedTrackSymbol } = require('lavalink-client');
const { pickBest, queries } = require('./match');
const ytbridge = require('./ytbridge');

/**
 * Builds a queued track that finds the right recording when it plays.
 *
 * lavalink-client's own resolver takes the first search result in two of its
 * branches, and its first branch searches `info.uri` and accepts result #1 with
 * no checking at all. For a Spotify track that means the query goes back to
 * Spotify, whatever comes out is played, and an AI cover wins as easily as the
 * master.
 *
 * This replaces `resolve` with one that searches by ISRC first, scores every
 * candidate (see match.js) and refuses to settle for a poor one. The library's
 * own resolver stays as the last resort, so behaviour degrades rather than
 * breaks if none of the searches produce anything usable.
 */
function buildSmartTrack(manager, want, requester, { search = null } = {}) {
  // No uri and no sourceName: both send lavalink-client down its unchecked
  // branches. Everything needed for matching is in the remaining fields.
  const track = manager.utils.buildUnresolvedTrack({
    title: want.title,
    author: want.author,
    duration: want.duration,
    artworkUrl: want.artworkUrl,
    isrc: want.isrc,
  }, requester);

  const fallbackResolve = track.resolve.bind(track);

  track.resolve = async function resolve(player) {
    const platform = search || player.LavalinkManager?.options?.playerOptions?.defaultSearchPlatform;

    for (const query of queries(want)) {
      let result;
      try {
        result = await player.search({ query, source: platform }, requester);
      } catch {
        continue;
      }
      const best = pickBest(want, result?.tracks || []);
      if (!best) continue;

      // When YouTube is refusing this host, fetch the file up front rather than
      // letting playback fail and recovering afterwards. Recovering works, but
      // it costs an exception, a queue advance and a replacement per track -
      // which on a long playlist is what looked like skipping and spam.
      let chosen = best;
      if (ytbridge.ready() && ytbridge.degraded()) {
        const local = await ytbridge.toLocalTrack(player, best, { info: { ...want } })
          .catch(() => null);
        if (local) chosen = local;
      }

      // Same in-place swap the library performs: the queue holds this object,
      // so it has to become the resolved track rather than be replaced.
      for (const prop of Object.getOwnPropertyNames(this)) delete this[prop];
      delete this[UnresolvedTrackSymbol];
      Object.defineProperty(this, TrackSymbol, { configurable: true, value: true });
      Object.assign(this, chosen);

      // Keep the artwork Spotify gave us; a YouTube match often has none.
      if (want.artworkUrl && this.info && !this.info.artworkUrl) {
        this.info.artworkUrl = want.artworkUrl;
      }
      this.requester = requester;
      return this;
    }

    return fallbackResolve(player);
  };

  return track;
}

module.exports = { buildSmartTrack };
