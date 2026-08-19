'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { requirePlayer, fail } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder().setName('resume').setDescription('Resume playback').setDMPermission(false),
  async execute(interaction, ctx) {
    const found = await requirePlayer(interaction, ctx);
    if (!found) return;
    const { player } = found;
    if (!player.paused) return fail(interaction, ctx.config, 'Nothing is paused.');
    await player.resume();
    return interaction.reply({ embeds: [embeds.ok(ctx.config, '▶️ Resumed.')] });
  },
};
