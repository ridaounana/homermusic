'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { fail, getOrCreatePlayer } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder().setName('join')
    .setDescription('Bring the bot into your voice channel').setDMPermission(false),
  async execute(interaction, ctx) {
    if (!interaction.member?.voice?.channel) return fail(interaction, ctx.config, 'Join a voice channel first.');
    try {
      const player = await getOrCreatePlayer(interaction, ctx);
      if (player.voiceChannelId !== interaction.member.voice.channel.id) {
        await player.changeVoiceState?.({ voiceChannelId: interaction.member.voice.channel.id })
          ?? player.connect({ voiceChannelId: interaction.member.voice.channel.id });
      }
      return interaction.reply({
        embeds: [embeds.ok(ctx.config, `👋 Joined ${interaction.member.voice.channel}.`)],
      });
    } catch (err) {
      return fail(interaction, ctx.config, err.message);
    }
  },
};
