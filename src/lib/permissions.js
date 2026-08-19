'use strict';
const { PermissionFlagsBits } = require('discord.js');

/**
 * Who is allowed to control playback.
 *
 * Rules, in order:
 *   1. Anyone with Manage Server always can.
 *   2. If a DJ role is configured, DJs can.
 *   3. If no DJ role is configured, anyone in the same voice channel can.
 *   4. Alone in the channel with the bot? You're the DJ by default.
 */
function isDj(interaction, settings) {
  const member = interaction.member;
  if (!member) return false;

  if (member.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return true;
  if (settings?.djRoleId && member.roles?.cache?.has?.(settings.djRoleId)) return true;
  if (settings?.djRoleId) return false;
  return true;
}

/** True when the user is the only human in the bot's voice channel. */
function isAloneWithBot(interaction, player) {
  const channel = interaction.member?.voice?.channel;
  if (!channel || !player || channel.id !== player.voiceChannelId) return false;
  const humans = channel.members?.filter?.((m) => !m.user.bot);
  return (humans?.size ?? 0) <= 1;
}

/**
 * Central guard. Returns null when allowed, or a user-facing reason string.
 * Every playback command runs through this so the rules can't drift apart.
 */
function checkControl(interaction, player, settings, { requireSameChannel = true, requirePlayer = true } = {}) {
  const voice = interaction.member?.voice?.channel;

  if (!voice) return 'Join a voice channel first.';
  if (requirePlayer && !player) return 'Nothing is playing right now.';

  if (requireSameChannel && player && player.voiceChannelId && voice.id !== player.voiceChannelId) {
    return `You need to be in <#${player.voiceChannelId}> to control playback.`;
  }

  if (isAloneWithBot(interaction, player)) return null;
  if (isDj(interaction, settings)) return null;

  if (settings?.requesterOnlyControls) {
    const requesterId = player?.queue?.current?.requester?.id;
    if (requesterId && requesterId === interaction.user.id) return null;
  }

  return settings?.djRoleId
    ? `Only <@&${settings.djRoleId}> can do that while others are listening.`
    : 'You do not have permission to do that.';
}

/** Permissions the bot itself needs in the voice channel before joining. */
function botCanJoin(voiceChannel, botMember) {
  const perms = voiceChannel.permissionsFor?.(botMember);
  if (!perms) return 'I cannot read my permissions for that channel.';
  if (!perms.has(PermissionFlagsBits.Connect)) return `I do not have permission to join ${voiceChannel}.`;
  if (!perms.has(PermissionFlagsBits.Speak)) return `I do not have permission to speak in ${voiceChannel}.`;
  if (voiceChannel.full && !perms.has(PermissionFlagsBits.MoveMembers)) {
    return `${voiceChannel} is full.`;
  }
  return null;
}

module.exports = { isDj, isAloneWithBot, checkControl, botCanJoin };
