'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { requirePlayer } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder().setName('leave')
    .setDescription('Disconnect the bot from voice').setDMPermission(false),
  async execute(interaction, ctx) {
    const found = await requirePlayer(interaction, ctx);
    if (!found) return;
    await found.player.destroy();
    return interaction.reply({ embeds: [embeds.ok(ctx.config, '👋 Left the channel.')] });
  },
};
