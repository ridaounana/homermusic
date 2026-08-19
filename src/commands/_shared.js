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

/** Creates and connects a player, or returns the existing one. */
async function getOrCreatePlayer(interaction, { client, config, store }) {
  const existing = client.lavalink.getPlayer(interaction.guildId);
  if (existing) return existing;

  const voice = interaction.member?.voice?.channel;
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
