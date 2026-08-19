'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { requirePlayer, fail } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder().setName('clear')
    .setDescription('Clear the queue (keeps the current track playing)').setDMPermission(false),
  async execute(interaction, ctx) {
    const found = await requirePlayer(interaction, ctx);
    if (!found) return;
    const { player } = found;
    const count = player.queue.tracks.length;
    if (!count) return fail(interaction, ctx.config, 'The queue is already empty.');
    await player.queue.splice(0, count);
    return interaction.reply({ embeds: [embeds.ok(ctx.config, `🗑️ Cleared **${count}** track(s).`)] });
  },
};
