'use strict';

/**
 * Autoplay: when the queue runs dry, keep the vibe going.
 *
 * Strategy, cheapest first:
 *   1. Ask the source for related tracks (YouTube/Spotify style radio seeds).
 *   2. Fall back to searching the artist name.
 * Anything already played recently is filtered out so it doesn't loop
 * between two songs forever.
 */
async function findNextTrack(player, lastTrack, { search = 'ytmsearch' } = {}) {
  if (!lastTrack?.info) return null;

  const recent = new Set(
    [...(player.queue.previous || []), lastTrack]
      .map((t) => t?.info?.identifier)
      .filter(Boolean)
  );

  const attempts = [];

  // 1. Native "related" radio, when the source supports it.
  if (lastTrack.info.identifier && /youtube/i.test(lastTrack.info.sourceName || '')) {
    attempts.push({
      query: `https://www.youtube.com/watch?v=${lastTrack.info.identifier}&list=RD${lastTrack.info.identifier}`,
      source: undefined,
    });
  }

  // 2. Artist search.
  if (lastTrack.info.author) {
    attempts.push({ query: lastTrack.info.author, source: search });
  }

  for (const attempt of attempts) {
    try {
      const res = await player.search(attempt, lastTrack.requester);
      const candidates = (res?.tracks || []).filter((t) => t?.info?.identifier && !recent.has(t.info.identifier));
      if (candidates.length) {
        // Skip the first couple — they're usually the same song again.
        const pool = candidates.slice(0, 15);
        return pool[Math.floor(Math.random() * pool.length)];
      }
    } catch { /* try the next strategy */ }
  }

  return null;
}

module.exports = { findNextTrack };
