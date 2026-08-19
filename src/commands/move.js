'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { trackLink } = require('../lib/format');
const { requirePlayer, fail } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder().setName('move').setDescription('Move a queued track to another position')
    .addIntegerOption((o) => o.setName('from').setDescription('Current position').setMinValue(1).setRequired(true))
    .addIntegerOption((o) => o.setName('to').setDescription('New position').setMinValue(1).setRequired(true))
    .setDMPermission(false),

  async execute(interaction, ctx) {
    const found = await requirePlayer(interaction, ctx);
    if (!found) return;
    const { player } = found;
    const size = player.queue.tracks.length;
    const from = interaction.options.getInteger('from', true);
    const to = interaction.options.getInteger('to', true);

    if (from > size || to > size) return fail(interaction, ctx.config, `Only **${size}** track(s) queued.`);
    if (from === to) return fail(interaction, ctx.config, 'That track is already there.');

    const [track] = await player.queue.remove(from - 1);
    if (!track) return fail(interaction, ctx.config, 'Could not find that track.');
    await player.queue.add(track, to - 1);

    return interaction.reply({
      embeds: [embeds.ok(ctx.config, `↕️ Moved ${trackLink(track)} to position **${to}**.`)],
    });
  },
};
