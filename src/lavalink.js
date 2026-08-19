'use strict';
const { LavalinkManager } = require('lavalink-client');
const embeds = require('./lib/embeds');
const { controlRows, disabledRows } = require('./lib/controls');
const { findNextTrack } = require('./lib/autoplay');
const { findAlternative, familyOf, MAX_ATTEMPTS } = require('./lib/fallback');

/**
 * Creates the Lavalink manager and wires every player event.
 *
 * The bot process itself never touches audio: Lavalink does the decoding and
 * streaming, we only send it instructions over REST/WebSocket. That separation
 * is why this design scales to hundreds of servers on a small VPS.
 */
function setupLavalink(client, { config, store }) {
  const manager = new LavalinkManager({
    nodes: [{
      id: config.lavalink.id,
      host: config.lavalink.host,
      port: config.lavalink.port,
      authorization: config.lavalink.authorization,
      secure: config.lavalink.secure,
      retryAmount: 10,
      retryDelay: 5000,
    }],
    sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
    autoSkip: true,
    client: { id: config.clientId, username: config.botName },
    playerOptions: {
      defaultSearchPlatform: config.player.defaultSearch,
      volumeDecrementer: 1,
      onDisconnect: { autoReconnect: true, destroyPlayer: false },
      onEmptyQueue: { destroyAfterMs: config.player.idleTimeoutMs || undefined },
      useUnresolvedData: true,
    },
    queueOptions: { maxPreviousTracks: config.player.maxPreviousTracks },
  });

  client.lavalink = manager;

  // Voice state + server updates must be forwarded raw for voice to connect.
  client.on('raw', (d) => manager.sendRawData(d));

  // ------------------------------------------------------------- node events
  manager.nodeManager
    .on('connect', (node) => console.log(`[lavalink] node "${node.id}" connected`))
    .on('reconnecting', (node) => console.warn(`[lavalink] node "${node.id}" reconnecting…`))
    .on('disconnect', (node, reason) =>
      console.warn(`[lavalink] node "${node.id}" disconnected: ${JSON.stringify(reason)}`))
    .on('error', (node, error) => console.error(`[lavalink] node "${node.id}" error:`, error?.message || error));

  // ----------------------------------------------------------- helper: notify
  async function announce(player, payload) {
    const settings = store.guild(player.guildId);
    if (!settings.announceTracks) return null;
    try {
      const channel = await client.channels.fetch(player.textChannelId);
      if (!channel?.isTextBased?.()) return null;
      return await channel.send(payload);
    } catch {
      return null;
    }
  }

  /** Replace the previous now-playing message so channels don't fill with them. */
  async function clearLastNowPlaying(player) {
    const previous = player.get('npMessage');
    if (!previous) return;
    try {
      await previous.edit({ components: disabledRows(player) });
    } catch { /* message deleted or too old */ }
    player.set('npMessage', null);
  }

  /**
   * Remove a now-playing message for a track that never actually played.
   *
   * Lavalink emits trackStart before the stream is fetched, so a track that
   * fails still announces itself first. Leaving those behind is what turns one
   * `/play` into a wall of embeds while the source retry works through
   * candidates - the message describes something nobody ever heard.
   */
  async function dropLastNowPlaying(player) {
    const previous = player.get('npMessage');
    if (!previous) return;
    try {
      await previous.delete();
    } catch {
      try { await previous.edit({ components: disabledRows(player) }); } catch { /* gone */ }
    }
    player.set('npMessage', null);
  }

  // ----------------------------------------------------------- player events
  manager
    .on('trackStart', async (player, track) => {
      player.set('idleSince', null);
      // Playback really started, so any in-flight source retry is resolved.
      player.set('fallbackFailures', null);
      await clearLastNowPlaying(player);
      const message = await announce(player, {
        embeds: [embeds.nowPlaying(config, player, track)],
        components: controlRows(player),
      });
      if (message) player.set('npMessage', message);
    })

    .on('trackEnd', async (player) => {
      await clearLastNowPlaying(player);
    })

    .on('trackError', async (player, track, payload) => {
      console.error(`[player] track error in ${player.guildId}:`, payload?.exception?.message || payload);
      const title = track?.info?.title || 'that track';

      // This track announced itself on trackStart but never produced audio, so
      // take its message down rather than leaving a trail of them.
      await dropLastNowPlaying(player);

      // One source failing is routine, so look for the same song elsewhere
      // before giving up. The failure list is cleared on trackStart, which only
      // fires once playback genuinely begins - so a fallback that also fails
      // leaves the list intact and the next candidate gets tried instead.
      const failures = player.get('fallbackFailures') || [];
      const nextFailures = [...failures, { uri: track?.info?.uri, family: familyOf(track) }];
      player.set('fallbackFailures', nextFailures);

      if (nextFailures.length <= MAX_ATTEMPTS) {
        const alt = await findAlternative(player, track, track?.requester, nextFailures)
          .catch(() => null);
        if (alt) {
          console.log(`[player] retrying "${title}" on ${alt.source}`);
          try {
            await player.play({ clientTrack: alt.track });
            return;
          } catch (e) {
            console.error('[player] fallback play failed:', e?.message || e);
          }
        }
      }

      player.set('fallbackFailures', null);
      await announce(player, {
        embeds: [embeds.error(config, `Couldn't play **${title}** on any source — skipping it.`)],
      });
    })

    .on('trackStuck', async (player, track) => {
      console.warn(`[player] track stuck in ${player.guildId}, skipping`);
      try { await player.skip(); } catch { /* queue may already be empty */ }
    })

    .on('queueEnd', async (player) => {
      // A source retry is in flight: the queue only looks empty because the
      // failed track was dropped. Announcing "queue finished" here is what put
      // one between every retry, and letting autoplay fire would queue an
      // unrelated song mid-recovery. idleSince is still set so that a recovery
      // which never succeeds still lets the idle timer leave the channel.
      if ((player.get('fallbackFailures') || []).length) {
        player.set('idleSince', Date.now());
        return;
      }

      await clearLastNowPlaying(player);

      // Autoplay keeps things going when nobody queues anything else.
      if (player.get('autoplay')) {
        const last = player.queue.previous?.[0] || player.get('lastTrack');
        const next = await findNextTrack(player, last, { search: config.player.defaultSearch });
        if (next) {
          await player.queue.add(next);
          if (!player.playing) await player.play();
          return;
        }
      }

      const settings = store.guild(player.guildId);
      if (settings.twentyFourSeven) return; // stay put on purpose

      player.set('idleSince', Date.now());
      await announce(player, {
        embeds: [embeds.ok(config, '⏹️ Queue finished. I\'ll leave shortly if nothing else is added.')],
      });
    })

    .on('playerDestroy', async (player) => {
      await clearLastNowPlaying(player);
    });

  // Remember the last track so autoplay has a seed even after the queue clears.
  manager.on('trackStart', (player, track) => player.set('lastTrack', track));

  return manager;
}

module.exports = { setupLavalink };
