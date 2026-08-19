'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { parseTime, duration } = require('../lib/format');
const { requirePlayer, fail } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder().setName('seek')
    .setDescription('Jump to a position in the current track')
    .addStringOption((o) => o.setName('position')
      .setDescription('e.g. 1:30, 90, or 1m30s').setRequired(true))
    .setDMPermission(false),

  async execute(interaction, ctx) {
    const found = await requirePlayer(interaction, ctx);
    if (!found) return;
    const { player } = found;
    const track = player.queue.current;

    if (!track) return fail(interaction, ctx.config, 'Nothing is playing.');
    if (track.info?.isStream) return fail(interaction, ctx.config, 'You cannot seek in a live stream.');

    const ms = parseTime(interaction.options.getString('position', true));
    if (ms === null) return fail(interaction, ctx.config, 'Could not read that time. Try `1:30`, `90` or `1m30s`.');
    if (ms > (track.info?.duration || 0)) {
      return fail(interaction, ctx.config, `That is past the end of the track (\`${duration(track.info.duration)}\`).`);
    }

    await player.seek(ms);
    return interaction.reply({ embeds: [embeds.ok(ctx.config, `⏩ Jumped to \`${duration(ms)}\`.`)] });
  },
};
