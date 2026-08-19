'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { requirePlayer, fail } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder().setName('replay')
    .setDescription('Restart the current track from the beginning').setDMPermission(false),
  async execute(interaction, ctx) {
    const found = await requirePlayer(interaction, ctx);
    if (!found) return;
    const { player } = found;
    if (!player.queue.current) return fail(interaction, ctx.config, 'Nothing is playing.');
    await player.seek(0);
    return interaction.reply({ embeds: [embeds.ok(ctx.config, '🔄 Back to the start.')] });
  },
};
