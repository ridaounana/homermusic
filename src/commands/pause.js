'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { requirePlayer, fail } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder().setName('pause').setDescription('Pause playback').setDMPermission(false),
  async execute(interaction, ctx) {
    const found = await requirePlayer(interaction, ctx);
    if (!found) return;
    const { player } = found;
    if (player.paused) return fail(interaction, ctx.config, 'Already paused — use `/resume`.');
    await player.pause();
    return interaction.reply({ embeds: [embeds.ok(ctx.config, '⏸️ Paused.')] });
  },
};
