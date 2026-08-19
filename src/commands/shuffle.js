'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { requirePlayer, fail } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the queue').setDMPermission(false),
  async execute(interaction, ctx) {
    const found = await requirePlayer(interaction, ctx);
    if (!found) return;
    const { player } = found;
    if (player.queue.tracks.length < 2) return fail(interaction, ctx.config, 'Need at least 2 queued tracks.');
    await player.queue.shuffle();
    return interaction.reply({
      embeds: [embeds.ok(ctx.config, `🔀 Shuffled **${player.queue.tracks.length}** tracks.`)],
    });
  },
};
