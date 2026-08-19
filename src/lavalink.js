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
    // The send may still be in flight - trackError can arrive before Discord
    // has answered trackStart. Without waiting for it, npMessage is still null
    // here and the embed survives, which is what left duplicates behind.
    const pending = player.get('npPending');
    if (pending) { try { await pending; } catch { /* send failed, nothing to drop */ } }

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
      player.set('fallbackOrigin', null);
      await clearLastNowPlaying(player);

      // Keep the in-flight send so trackError can wait for it before deleting.
      const pending = announce(player, {
        embeds: [embeds.nowPlaying(config, player, track)],
        components: controlRows(player),
      });
      player.set('npPending', pending);
      const message = await pending;
      player.set('npPending', null);
      if (message) player.set('npMessage', message);
    })

    .on('trackEnd', async (player) => {
      await clearLastNowPlaying(player);
    })

    .on('trackError', async (player, track, payload) => {
      console.error(`[player] track error in ${player.guildId}:`, payload?.exception?.message || payload);
      // Record the retry state BEFORE any await. queueEnd fires as soon as the
      // failed track leaves the queue, and if it wins the race it sees no
      // recovery in progress and announces "queue finished" mid-retry.
      const failures = player.get('fallbackFailures') || [];
      const nextFailures = [...failures, { uri: track?.info?.uri, family: familyOf(track) }];
      player.set('fallbackFailures', nextFailures);

      // The song the user actually asked for. Every retry searches from this,
      // never from the previous fallback - otherwise the query drifts a little
      // further each round and ends up on an unrelated song.
      const origin = player.get('fallbackOrigin') || track;
      player.set('fallbackOrigin', origin);
      const title = origin?.info?.title || 'that track';

      // This track announced itself on trackStart but never produced audio, so
      // take its message down rather than leaving a trail of them.
      await dropLastNowPlaying(player);

      if (nextFailures.length <= MAX_ATTEMPTS) {
        const alt = await findAlternative(player, origin, track?.requester, nextFailures)
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
      player.set('fallbackOrigin', null);
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
      // unrelated song mid-recovery.
      //
      // Leaving the channel is handled by the manager's onEmptyQueue
      // destroyAfterMs, not from here, so returning early cannot strand the
      // bot in the channel - a recovery that never succeeds still times out.
      if ((player.get('fallbackFailures') || []).length) return;

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
