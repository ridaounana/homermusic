'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { queueNavRows } = require('../lib/controls');
const { fail } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder().setName('queue').setDescription('Show the queue')
    .addIntegerOption((o) => o.setName('page').setDescription('Page number').setMinValue(1).setRequired(false))
    .setDMPermission(false),

  async execute(interaction, { client, config }) {
    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player) return fail(interaction, config, 'Nothing is playing.');
    const pages = Math.max(1, Math.ceil(player.queue.tracks.length / 10));
    const page = Math.min(Math.max(1, interaction.options.getInteger('page') || 1), pages);
    return interaction.reply({
      embeds: [embeds.queuePage(config, player, page)],
      components: pages > 1 ? queueNavRows(page, pages) : [],
    });
  },
};
