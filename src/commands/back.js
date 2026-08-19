'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { requirePlayer, fail } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder().setName('back').setDescription('Play the previous track').setDMPermission(false),
  async execute(interaction, ctx) {
    const found = await requirePlayer(interaction, ctx);
    if (!found) return;
    const { player } = found;
    const previous = player.queue.previous?.[0];
    if (!previous) return fail(interaction, ctx.config, 'No previous track in history.');
    await player.queue.add(previous, 0);
    await player.skip();
    return interaction.reply({ embeds: [embeds.ok(ctx.config, '⏮️ Playing the previous track.')] });
  },
};
