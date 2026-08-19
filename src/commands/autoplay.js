'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { requirePlayer } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder().setName('autoplay')
    .setDescription('Keep playing similar tracks when the queue runs out')
    .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(false))
    .setDMPermission(false),

  async execute(interaction, ctx) {
    const found = await requirePlayer(interaction, ctx);
    if (!found) return;
    const { player } = found;
    const current = Boolean(player.get('autoplay'));
    const next = interaction.options.getBoolean('enabled') ?? !current;
    player.set('autoplay', next);
    return interaction.reply({
      embeds: [embeds.ok(ctx.config, next
        ? '♾️ Autoplay **on** — I\'ll keep the music going when the queue empties.'
        : '♾️ Autoplay **off**.')],
    });
  },
};
