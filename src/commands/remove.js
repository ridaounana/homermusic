'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { trackLink } = require('../lib/format');
const { requirePlayer, fail } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder().setName('remove').setDescription('Remove a track from the queue')
    .addIntegerOption((o) => o.setName('position')
      .setDescription('Queue position (see /queue)').setMinValue(1).setRequired(true))
    .setDMPermission(false),

  async execute(interaction, ctx) {
    const found = await requirePlayer(interaction, ctx);
    if (!found) return;
    const { player } = found;
    const position = interaction.options.getInteger('position', true);

    if (position > player.queue.tracks.length) {
      return fail(interaction, ctx.config, `There ${player.queue.tracks.length === 1 ? 'is' : 'are'} only **${player.queue.tracks.length}** track(s) queued.`);
    }

    const [removed] = await player.queue.remove(position - 1);
    return interaction.reply({
      embeds: [embeds.ok(ctx.config, `🗑️ Removed ${removed ? trackLink(removed) : `position ${position}`}.`)],
    });
  },
};
