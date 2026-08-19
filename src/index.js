'use strict';
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, Events, ActivityType } = require('discord.js');

const { config, validate } = require('./config');
const { Store } = require('./store');
const { setupLavalink } = require('./lavalink');
const { handleInteraction } = require('./interactions');

validate();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates, // required to see who is in voice
  ],
});

const store = new Store(config.dataFile);
client.config = config;
client.store = store;
client.commands = new Collection();

// ------------------------------------------------------------ command loading
const commandsDir = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsDir)
  .filter((f) => f.endsWith('.js') && !f.startsWith('_')); // _shared.js is a helper, not a command
for (const file of commandFiles) {
  const command = require(path.join(commandsDir, file));
  if (!command?.data?.name || typeof command.execute !== 'function') {
    console.warn(`[commands] skipping ${file}: missing "data" or "execute"`);
    continue;
  }
  client.commands.set(command.data.name, command);
}
console.log(`[commands] loaded ${client.commands.size}`);

setupLavalink(client, { config, store });

// ------------------------------------------------------------------- events
client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] logged in as ${c.user.tag}`);
  await client.lavalink.init({ id: c.user.id, username: c.user.username });
  c.user.setActivity('/play', { type: ActivityType.Listening });
});

client.on(Events.InteractionCreate, (interaction) => handleInteraction(client, interaction));

/**
 * Leave when the voice channel empties out, and cancel that timer if someone
 * comes back. Without this the bot sits in an empty channel burning bandwidth.
 */
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const guildId = oldState.guild?.id || newState.guild?.id;
  const player = client.lavalink?.getPlayer?.(guildId);
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
        const text = await client.channels.fetch(player.textChannelId).catch(() => null);
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
});

// ------------------------------------------------------------------ shutdown
function shutdown(signal) {
  console.log(`[bot] ${signal} received, shutting down`);
  try { store.flush(); } catch { /* ignore */ }
  try {
    for (const player of client.lavalink?.players?.values?.() || []) player.destroy().catch(() => {});
  } catch { /* ignore */ }
  client.destroy();
  process.exit(0);
}
process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (err) => console.error('[bot] unhandled rejection:', err));
process.on('uncaughtException', (err) => console.error('[bot] uncaught exception:', err));

client.login(config.token);
