'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { controlRows } = require('../lib/controls');
const { fail } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder().setName('nowplaying')
    .setDescription('Show what is playing right now').setDMPermission(false),

  async execute(interaction, { client, config }) {
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player?.queue?.current) return fail(interaction, config, 'Nothing is playing.');
    return interaction.reply({
      embeds: [embeds.nowPlaying(config, player, player.queue.current)],
      components: controlRows(player),
    });
  },
};
