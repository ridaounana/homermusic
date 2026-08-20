'use strict';
const { parseLink, readEmbed } = require('./spotify');

/**
 * One way in for every kind of playlist link, whatever service it came from.
 *
 * The two services need opposite handling, and mixing them into the generic
 * search path is what made playlists unpredictable:
 *
 *   Spotify   Nothing on Spotify is playable by a bot, so a playlist is only a
 *             list of names. Each one is matched on YouTube when it plays.
 *             Its contents cannot be read through the Web API at all, so they
 *             come from the public embed widget.
 *
 *   YouTube   Already playable. Lavalink reads the playlist directly and the
 *             tracks are used as they are, with no searching or matching.
 *
 * Both return the same shape, so the command does not care which it got.
 */

// youtube.com/playlist?list=..., youtu.be/...?list=..., music.youtube.com, and
// a watch url carrying a list= (including the RD... auto-generated mixes).
const YOUTUBE_LIST = /[?&]list=([A-Za-z0-9_-]+)/i;
const YOUTUBE_HOST = /(?:^|\/\/|\.)(?:youtube\.com|youtu\.be|music\.youtube\.com)\//i;

/** What kind of collection a query is, or null if it is not one. */
function detect(query) {
  const text = String(query || '').trim();
  if (!text) return null;

  const spotify = parseLink(text);
  if (spotify && (spotify.kind === 'playlist' || spotify.kind === 'album')) {
    return { service: 'spotify', kind: spotify.kind, id: spotify.id, url: text };
  }

  if (YOUTUBE_HOST.test(text)) {
    const list = YOUTUBE_LIST.exec(text);
    if (list) {
      // RD/RDMM/RDCLAK are YouTube's auto-generated radio stations. They load
      // like a playlist but are a station seeded from one video, so the name is
      // worth distinguishing when it is shown.
      const radio = /^RD/i.test(list[1]);
      return { service: 'youtube', kind: radio ? 'radio' : 'playlist', id: list[1], url: text };
    }
  }

  return null;
}

/**
 * Resolves a collection into a common shape:
 *   { name, service, kind, url, tracks, truncated, needsMatching }
 *
 * `needsMatching` says whether the entries are names to look up (Spotify) or
 * real playable tracks (YouTube). Returns null when nothing could be read.
 */
async function resolve(query, { player, requester } = {}) {
  const found = detect(query);
  if (!found) return null;

  if (found.service === 'spotify') {
    const data = await readEmbed(found.kind, found.id);
    if (!data?.tracks?.length) return null;
    return {
      name: data.name,
      artist: data.artist,
      artworkUrl: data.artworkUrl,
      service: 'spotify',
      kind: found.kind,
      url: found.url,
      truncated: Boolean(data.truncated),
      needsMatching: true,
      tracks: data.tracks,
    };
  }

  // YouTube: Lavalink loads it, and the results are already playable.
  if (!player) return null;
  const result = await player.search({ query: found.url }, requester).catch(() => null);
  if (result?.loadType !== 'playlist' || !result.tracks?.length) return null;

  return {
    name: result.playlist?.name || result.pluginInfo?.name || 'YouTube playlist',
    artist: '',
    artworkUrl: result.tracks[0]?.info?.artworkUrl,
    service: 'youtube',
    kind: found.kind,
    url: found.url,
    truncated: false,
    needsMatching: false,
    tracks: result.tracks,
  };
}

module.exports = { detect, resolve, YOUTUBE_LIST, YOUTUBE_HOST };
