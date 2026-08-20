'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { requirePlayer, fail } = require('./_shared');
const { commandPath } = require('../lib/namespace');

module.exports = {
  data: new SlashCommandBuilder().setName('pause').setDescription('Pause playback').setDMPermission(false),
  async execute(interaction, ctx) {
    const found = await requirePlayer(interaction, ctx);
    if (!found) return;
    const { player } = found;
    if (player.paused) return fail(interaction, ctx.config, `Already paused — use \`${commandPath(ctx.config, 'resume')}\`.`);
    await player.pause();
    return interaction.reply({ embeds: [embeds.ok(ctx.config, '⏸️ Paused.')] });
  },
};
