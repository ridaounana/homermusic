'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { requirePlayer } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder().setName('loop').setDescription('Set the loop mode')
    .addStringOption((o) => o.setName('mode').setDescription('What to loop').setRequired(true)
      .addChoices(
        { name: 'Off', value: 'off' },
        { name: 'Current track', value: 'track' },
        { name: 'Whole queue', value: 'queue' },
      ))
    .setDMPermission(false),

  async execute(interaction, ctx) {
    const found = await requirePlayer(interaction, ctx);
    if (!found) return;
    const mode = interaction.options.getString('mode', true);
    await found.player.setRepeatMode(mode);
    return interaction.reply({
      embeds: [embeds.ok(ctx.config, `Loop set to **${embeds.labelRepeat(mode)}**.`)],
    });
  },
};
