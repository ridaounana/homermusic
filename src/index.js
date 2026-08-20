'use strict';
const fs = require('fs');
const path = require('path');
const { Collection, Events } = require('discord.js');

const { config, validate } = require('./config');
const { Store } = require('./store');
const { Fleet } = require('./fleet');
const { handleInteraction } = require('./interactions');
const { YoutubeAudioCache } = require('./lib/ytdlp');
const { createCacheServer } = require('./lib/ytserve');
const ytbridge = require('./lib/ytbridge');
const { buildPresence } = require('./lib/presence');
const { SpotifyClient } = require('./lib/spotify');

validate();

const store = new Store(config.dataFile);

// ------------------------------------------------------------ command loading
const commands = new Collection();
const commandsDir = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsDir)
  .filter((f) => f.endsWith('.js') && !f.startsWith('_')); // _shared.js is a helper, not a command
for (const file of commandFiles) {
  const command = require(path.join(commandsDir, file));
  if (!command?.data?.name || typeof command.execute !== 'function') {
    console.warn(`[commands] skipping ${file}: missing "data" or "execute"`);
    continue;
  }
  commands.set(command.data.name, command);
}
console.log(`[commands] loaded ${commands.size}`);

// ------------------------------------------------------- yt-dlp audio cache
// Shared by every instance: a track fetched for one is instant for the others.
let ytCache = null;
let ytServer = null;
if (config.ytdlp.enabled && config.ytdlp.bin) {
  ytCache = new YoutubeAudioCache({
    bin: config.ytdlp.bin,
    nodePath: config.ytdlp.nodePath,
    dir: config.ytdlp.cacheDir,
    maxBytes: config.ytdlp.cacheMaxBytes,
    timeoutMs: config.ytdlp.timeoutMs,
  });
  if (ytCache.available()) {
    ytServer = createCacheServer({ dir: config.ytdlp.cacheDir, port: config.ytdlp.port });
    ytServer.listen().catch((e) => console.error('[ytserve] failed to listen:', e?.message || e));
    ytCache.evict().catch(() => {});
    // A killed process leaves scratch files that look cached but are not.
    ytCache.sweepPartials().catch(() => {});
  } else {
    console.warn(`[ytdlp] ${config.ytdlp.bin} is not executable — YouTube recovery disabled`);
    ytCache = null;
  }
}

ytbridge.configure({ cache: ytCache, server: ytServer, mode: config.ytdlp.youtubeMode });
if (ytCache) console.log(`[ytbridge] youtube audio via yt-dlp: ${config.ytdlp.youtubeMode}`);

// ------------------------------------------------------------------ spotify
const spotify = new SpotifyClient({
  clientId: config.spotify.clientId,
  clientSecret: config.spotify.clientSecret,
  market: config.spotify.market,
});
if (spotify.enabled()) console.log('[spotify] album lookup enabled');

// -------------------------------------------------------------------- fleet
// One process, several bot accounts. Discord allows a bot one voice connection
// per server, so serving two channels at once needs two accounts.
const fleet = new Fleet({ config, store, ytCache, ytServer, commands, spotify });

// ----------------------------------------------------------------- presence
// Discord drops the presence whenever a shard reconnects and never restores it,
// so setting it once at startup leaves the bot blank after the first hiccup.
function applyPresence(client) {
  const payload = buildPresence(config);
  if (!payload || !client?.user) return;
  try {
    client.user.setPresence(payload);
  } catch (e) {
    console.warn('[bot] could not set presence:', e?.message || e);
  }
}

let presenceTimer = null;

/**
 * Leave when the voice channel empties out, and cancel that timer if someone
 * comes back. Without this an instance sits in an empty channel burning
 * bandwidth - and, now that instances are pooled, stays unavailable to whoever
 * wants one next.
 */
function watchEmptyChannel(instance, oldState) {
  const guildId = oldState.guild?.id;
  const player = instance.manager?.getPlayer?.(guildId);
  if (!player) return;

  const settings = store.guild(guildId);
  if (settings.twentyFourSeven) return;

  const channel = oldState.guild.channels.cache.get(player.voiceChannelId);
  if (!channel) return;

  const humans = channel.members.filter((m) => !m.user.bot).size;
  const existingTimer = player.get('emptyTimer');

  if (humans === 0) {
    if (existingTimer || !config.player.emptyChannelTimeoutMs) return;
    const timer = setTimeout(async () => {
      const stillEmpty = channel.members.filter((m) => !m.user.bot).size === 0;
      if (!stillEmpty) return;
      try {
        const text = await instance.client.channels.fetch(player.textChannelId).catch(() => null);
        await text?.send?.({ content: '👋 Left the channel — everyone was gone.' });
      } catch { /* channel may be gone */ }
      player.destroy().catch(() => {});
    }, config.player.emptyChannelTimeoutMs);
    if (timer.unref) timer.unref();
    player.set('emptyTimer', timer);
  } else if (existingTimer) {
    clearTimeout(existingTimer);
    player.set('emptyTimer', null);
  }
}

(async () => {
  const started = await fleet.start({
    onInteraction: (instance, interaction) => handleInteraction(instance, interaction, { fleet }),
  });

  if (!started) {
    console.error('[fleet] no bot account could log in — check DISCORD_TOKEN');
    process.exit(1);
  }

  for (const instance of fleet.instances) {
    instance.client.once(Events.ClientReady, () => applyPresence(instance.client));
    instance.client.on(Events.ShardResume, () => applyPresence(instance.client));
    instance.client.on(Events.ShardReady, () => applyPresence(instance.client));
    instance.client.on(Events.VoiceStateUpdate, (oldState) => watchEmptyChannel(instance, oldState));
  }

  if (config.presence.text && config.presence.refreshMs > 0) {
    presenceTimer = setInterval(
      () => fleet.instances.forEach((i) => applyPresence(i.client)),
      config.presence.refreshMs,
    );
    if (presenceTimer.unref) presenceTimer.unref();
  }

  console.log(`[fleet] ${started} instance(s) online — up to ${started} voice channel(s) per server`);
})();

// ------------------------------------------------------------------ shutdown
function shutdown(signal) {
  console.log(`[bot] ${signal} received, shutting down`);
  try { store.flush(); } catch { /* ignore */ }
  try { if (presenceTimer) clearInterval(presenceTimer); } catch { /* ignore */ }
  try { fleet.destroyAll(); } catch { /* ignore */ }
  try { ytServer?.close?.(); } catch { /* ignore */ }
  process.exit(0);
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (err) => console.error('[bot] unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('[bot] uncaught exception:', err));
