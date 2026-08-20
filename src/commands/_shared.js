'use strict';
const { MessageFlags } = require('discord.js');
const embeds = require('../lib/embeds');
const { checkControl, botCanJoin } = require('../lib/permissions');

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

/** Reply with a red embed, ephemeral. Used everywhere a command bails out. */
function fail(interaction, config, message) {
  const payload = { embeds: [embeds.error(config, message)], ...EPHEMERAL };
  return interaction.deferred || interaction.replied
    ? interaction.editReply({ embeds: payload.embeds })
    : interaction.reply(payload);
}

/**
 * The standard preamble for every playback command:
 * resolve the player, verify the caller may control it, and hand both back.
 * Returns null if it already replied with an error.
 */
async function requirePlayer(interaction, { client, config, store }, options = {}) {
  const player = client.lavalink.getPlayer(interaction.guildId);
  const settings = store.guild(interaction.guildId);
  const denied = checkControl(interaction, player, settings, options);
  if (denied) {
    await fail(interaction, config, denied);
    return null;
  }
  return { player, settings };
}

/**
 * Creates and connects a player, or returns the existing one.
 *
 * Discord allows a bot exactly one voice connection per server, so a session
 * already running in another channel cannot simply be joined. Returning it
 * regardless - which is what this used to do - queued the caller's song into a
 * channel they were not in, so they never heard it and were told nothing.
 *
 * If everyone has left the channel the bot is sitting in, it follows the caller
 * instead: nobody is listening there, so there is nothing to interrupt.
 */
async function getOrCreatePlayer(interaction, { client, config, store }) {
  const voice = interaction.member?.voice?.channel;
  const existing = client.lavalink.getPlayer(interaction.guildId);

  if (existing) {
    const sameChannel = !existing.voiceChannelId || existing.voiceChannelId === voice?.id;
    if (sameChannel) return existing;

    const busy = interaction.guild?.channels?.cache?.get(existing.voiceChannelId);
    const listeners = busy?.members?.filter?.((m) => !m.user.bot)?.size ?? 0;

    if (listeners > 0) {
      throw new Error(
        `I'm already playing in **${busy?.name || 'another channel'}** for `
        + `${listeners} ${listeners === 1 ? 'person' : 'people'}. Discord only lets me be in one `
        + 'voice channel per server at a time — join them, or wait until they finish.',
      );
    }

    // Abandoned session: move rather than refuse.
    if (voice) {
      const problem = botCanJoin(voice, interaction.guild.members.me);
      if (problem) throw new Error(problem);
      existing.voiceChannelId = voice.id;
      existing.textChannelId = interaction.channelId;
      await existing.connect();
      return existing;
    }
    return existing;
  }

  if (!voice) return null;

  const problem = botCanJoin(voice, interaction.guild.members.me);
  if (problem) throw new Error(problem);

  const settings = store.guild(interaction.guildId);
  const player = client.lavalink.createPlayer({
    guildId: interaction.guildId,
    voiceChannelId: voice.id,
    textChannelId: interaction.channelId,
    selfDeaf: true,
    selfMute: false,
    volume: settings.defaultVolume ?? config.player.defaultVolume,
  });

  if (!player.connected) await player.connect();
  return player;
}

module.exports = { EPHEMERAL, fail, requirePlayer, getOrCreatePlayer };
