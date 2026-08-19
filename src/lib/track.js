'use strict';

/**
 * Trim a Lavalink track down to what we need to re-resolve it later.
 * Storing the whole object would bloat the data file with base64 blobs that
 * expire anyway, so playlists keep the URL and re-search on load.
 */
function stripTrack(track) {
  return {
    encoded: track.encoded,
    info: {
      title: track.info?.title,
      author: track.info?.author,
      uri: track.info?.uri,
      duration: track.info?.duration,
      identifier: track.info?.identifier,
      sourceName: track.info?.sourceName,
      artworkUrl: track.info?.artworkUrl,
      isStream: track.info?.isStream,
    },
  };
}

module.exports = { stripTrack };
