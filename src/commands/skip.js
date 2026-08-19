'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { trackLink } = require('../lib/format');
const { requirePlayer, fail } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('skip').setDescription('Skip the current track')
    .addIntegerOption((o) => o.setName('to')
      .setDescription('Skip ahead to this queue position').setMinValue(1).setRequired(false))
    .setDMPermission(false),

  async execute(interaction, ctx) {
    const found = await requirePlayer(interaction, ctx);
    if (!found) return;
    const { player } = found;
    const current = player.queue.current;
    const to = interaction.options.getInteger('to');

    if (to) {
      if (to > player.queue.tracks.length) {
        return fail(interaction, ctx.config, `There are only ${player.queue.tracks.length} tracks queued.`);
      }
      await player.skip(to);
      return interaction.reply({ embeds: [embeds.ok(ctx.config, `⏭️ Jumped to position **${to}**.`)] });
    }

    if (!player.queue.tracks.length && !player.get('autoplay')) {
      await player.stopPlaying(true, false);
      return interaction.reply({ embeds: [embeds.ok(ctx.config, '⏭️ Skipped — queue is empty now.')] });
    }

    await player.skip();
    return interaction.reply({
      embeds: [embeds.ok(ctx.config, `⏭️ Skipped ${current ? trackLink(current) : 'the track'}.`)],
    });
  },
};
