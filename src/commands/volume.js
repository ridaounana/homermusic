'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { requirePlayer, fail } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder().setName('volume').setDescription('Set or show the volume')
    .addIntegerOption((o) => o.setName('percent')
      .setDescription('0-200').setMinValue(0).setMaxValue(1000).setRequired(false))
    .setDMPermission(false),

  async execute(interaction, ctx) {
    const found = await requirePlayer(interaction, ctx);
    if (!found) return;
    const { player } = found;
    const value = interaction.options.getInteger('percent');

    if (value === null) {
      return interaction.reply({ embeds: [embeds.ok(ctx.config, `🔊 Volume is **${player.volume}%**.`)] });
    }
    if (value > ctx.config.player.maxVolume) {
      return fail(interaction, ctx.config, `Max volume is **${ctx.config.player.maxVolume}%**.`);
    }

    await player.setVolume(value);
    const warning = value > 100 ? '\n*Above 100% can distort — 100 is the clean maximum.*' : '';
    return interaction.reply({ embeds: [embeds.ok(ctx.config, `🔊 Volume set to **${value}%**.${warning}`)] });
  },
};
