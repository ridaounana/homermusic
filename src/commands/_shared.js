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
 * The player this command should act on.
 *
 * With a fleet, "the player for this guild" is ambiguous - there can be one per
 * channel. The caller's own voice channel picks it, so a command can never
 * reach a session someone else is listening to. Without a fleet this is exactly
 * the old behaviour.
 */
function resolvePlayer(interaction, { client, fleet }) {
  const voiceChannelId = interaction.member?.voice?.channel?.id;
  if (fleet) {
    const found = fleet.playerFor(interaction.guildId, voiceChannelId);
    return found?.player || null;
  }
  return client.lavalink.getPlayer(interaction.guildId);
}

/**
 * The standard preamble for every playback command:
 * resolve the player, verify the caller may control it, and hand both back.
 * Returns null if it already replied with an error.
 */
async function requirePlayer(interaction, ctx, options = {}) {
  const { client, config, store, fleet } = ctx;
  // Which session this command acts on is decided by the caller's own voice
  // channel, not by the guild. With several instances running, resolving by
  // guild would let somebody in one channel stop the music in another.
  const player = resolvePlayer(interaction, ctx);
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
async function getOrCreatePlayer(interaction, ctx) {
  const { client, config, store, fleet } = ctx;
  const voice = interaction.member?.voice?.channel;

  // ------------------------------------------------------------- with a fleet
  if (fleet) {
    const instance = fleet.acquire(interaction.guildId, voice?.id);
    if (!instance) {
      const busy = fleet.busyChannels(interaction.guildId)
        .map((b) => `<#${b.channelId}>`)
        .join(', ');
      // Distinguish "everyone is listening to something" from "the extra bots
      // were never invited here" - the fix for each is completely different.
      const uninvited = fleet.notInvited(interaction.guildId);
      const hint = uninvited.length
        ? `
-# ${uninvited.length} more (${uninvited.join(', ')}) are running but not in this server yet.`
        : '';
      throw new Error(
        `All ${fleet.membersOf(interaction.guildId).length} instances here are in use`
        + `${busy ? ` — ${busy}` : ''}. Discord allows a bot one voice channel per `
        + `server, so one has to finish before another channel can start.${hint}`,
      );
    }

    const existing = instance.manager.getPlayer(interaction.guildId);
    if (existing && existing.voiceChannelId === voice?.id) return existing;
    if (!voice) return null;

    // The permission that matters belongs to the instance being sent in, not to
    // whichever account received the command. Homer 2 can easily be missing
    // Connect somewhere Homer has it.
    const me = instance.client.guilds.cache.get(interaction.guildId)?.members?.me;
    const problem = botCanJoin(voice, me);
    if (problem) throw new Error(`${instance.name}: ${problem}`);

    const settings = store.guild(interaction.guildId);
    const player = existing || instance.manager.createPlayer({
      guildId: interaction.guildId,
      voiceChannelId: voice.id,
      textChannelId: interaction.channelId,
      selfDeaf: true,
      selfMute: false,
      volume: settings.defaultVolume ?? config.player.defaultVolume,
    });
    // acquire() only hands back an instance that is free or already here, so
    // this can move an idle one to the caller without interrupting anybody.
    player.voiceChannelId = voice.id;
    player.textChannelId = interaction.channelId;
    if (!player.connected) await player.connect();
    player.set('instanceName', instance.name);
    return player;
  }

  // --------------------------------------------------- single bot, as before
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

module.exports = { EPHEMERAL, fail, requirePlayer, getOrCreatePlayer, resolvePlayer };
