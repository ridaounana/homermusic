'use strict';
const { LavalinkManager } = require('lavalink-client');
const embeds = require('./lib/embeds');
const { controlRows, disabledRows } = require('./lib/controls');
const { findNextTrack } = require('./lib/autoplay');
const { findAlternative, familyOf, MAX_ATTEMPTS } = require('./lib/fallback');
const { YoutubeAudioCache } = require('./lib/ytdlp');
const ytbridge = require('./lib/ytbridge');

/**
 * Creates the Lavalink manager and wires every player event.
 *
 * The bot process itself never touches audio: Lavalink does the decoding and
 * streaming, we only send it instructions over REST/WebSocket. That separation
 * is why this design scales to hundreds of servers on a small VPS.
 */
function setupLavalink(client, { config, store, ytCache = null, ytServer = null }) {
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

  /**
   * Retires the previous now-playing message.
   *
   * Deleting rather than greying out matters on a long queue: a 50-track
   * playlist otherwise leaves 50 dead embeds behind it, and the one that is
   * actually playing scrolls away. Set CLEAN_NOW_PLAYING=false to keep the old
   * behaviour of leaving them in place with their buttons disabled.
   *
   * `force` deletes regardless of that setting, for a track that announced
   * itself and then failed to produce any audio.
   */
  async function clearLastNowPlaying(player, { force = false } = {}) {
    // The send may still be in flight - a track can fail before Discord has
    // answered trackStart. Without waiting, npMessage is still null here and
    // the embed survives.
    const pending = player.get('npPending');
    if (pending) { try { await pending; } catch { /* send failed, nothing to clear */ } }

    const previous = player.get('npMessage');
    if (!previous) return;
    player.set('npMessage', null);

    const remove = force || config.player.cleanNowPlaying;
    try {
      if (remove) await previous.delete();
      else await previous.edit({ components: disabledRows(player) });
    } catch {
      // Already gone, or deleting was refused - fall back to disabling it so a
      // stale message never keeps working buttons.
      if (remove) {
        try { await previous.edit({ components: disabledRows(player) }); } catch { /* gone */ }
      }
    }
  }

  const dropLastNowPlaying = (player) => clearLastNowPlaying(player, { force: true });

  /**
   * Re-fetches a failed YouTube track with yt-dlp and plays the cached file.
   *
   * Lavalink loads the local file as an anonymous http track, so its title and
   * artwork come from the container rather than YouTube. The display fields are
   * copied back off the original track - playback runs from `encoded`, so the
   * overrides only affect what people see. Returns true if it is now playing.
   */
  async function playFromYoutubeCache(player, origin, failed) {
    if (!ytbridge.ready()) return false;
    // Only worth trying once per song; a second failure means the file itself
    // is not playable, not that YouTube was blocking us.
    if (player.get('ytdlpTried')) return false;
    player.set('ytdlpTried', true);

    const local = await ytbridge.toLocalTrack(player, failed || origin, origin)
      .catch(() => null);
    if (!local) return false;

    try {
      // Same autoSkip hazard as any other replacement - go through the guard.
      await playReplacement(player, origin, local);
      console.log(`[ytdlp] playing "${origin?.info?.title || local.info.title}" from cache`);
      return true;
    } catch (e) {
      console.error('[ytdlp] local playback failed:', e?.message || e);
      return false;
    }
  }

  /**
   * Plays a replacement for a track that failed, without fighting autoSkip.
   *
   * Lavalink follows a track exception with a trackEnd carrying
   * reason "loadFailed". lavalink-client handles that by advancing the queue -
   * the next song becomes current - and starting it. Our recovery search takes
   * long enough that this has usually already happened by the time an
   * alternative is found.
   *
   * Calling play() at that point overwrites the song autoSkip just started, so
   * it is consumed without ever being heard and two now-playing messages appear
   * for one slot. That is the "it skips songs and posts three times" behaviour.
   *
   * So: if the player has already moved on, queue the replacement at the front
   * instead. Nothing is lost - it plays right after the song already running -
   * and only one now-playing message exists at a time.
   */
  async function playReplacement(player, origin, replacement) {
    const current = player.queue.current;
    const failedUri = origin?.info?.uri;
    const movedOn = Boolean(
      current
      && player.playing
      && current.info?.uri
      && current.info.uri !== failedUri,
    );

    if (movedOn) {
      await player.queue.add(replacement, 0);
      console.log('[player] queued the replacement next; autoSkip had already moved on');
      return;
    }
    await player.play({ clientTrack: replacement });
  }

  // ----------------------------------------------------------- player events
  manager
    .on('trackStart', async (player, track) => {
      player.set('idleSince', null);
      // Playback really started, so any in-flight source retry is resolved.
      player.set('fallbackFailures', null);
      player.set('fallbackOrigin', null);
      player.set('ytdlpTried', null);
      // Playback worked, so the direct YouTube path is healthy again.
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
      // Count YouTube refusals so the next tracks skip the failing path
      // entirely instead of each having to fail first.
      if (familyOf(track) === 'youtube') ytbridge.recordFailure();

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

      // Before looking at other sources, try to play this exact video by
      // fetching it with yt-dlp. Lavalink resolving a YouTube track but being
      // unable to stream it is the common case, and swapping to a SoundCloud
      // re-upload when the real track is obtainable is a worse answer.
      const localTrack = await playFromYoutubeCache(player, origin, track).catch(() => null);
      if (localTrack) return;

      if (nextFailures.length <= MAX_ATTEMPTS) {
        const alt = await findAlternative(player, origin, track?.requester, nextFailures)
          .catch(() => null);
        if (alt) {
          console.log(`[player] retrying "${title}" on ${alt.source}`);
          try {
            await playReplacement(player, origin, alt.track);
            return;
          } catch (e) {
            console.error('[player] fallback play failed:', e?.message || e);
          }
        }
      }

      player.set('fallbackFailures', null);
      player.set('fallbackOrigin', null);
      player.set('ytdlpTried', null);
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
