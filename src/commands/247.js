'use strict';
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../lib/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('247')
    .setDescription('Keep the bot in voice even when idle or alone')
    .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction, { config, store }) {
    const enabled = interaction.options.getBoolean('enabled', true);
    store.setGuild(interaction.guildId, { twentyFourSeven: enabled });
    store.flush();
    return interaction.reply({
      embeds: [embeds.ok(config, enabled
        ? '🕓 24/7 mode **on** — I will stay connected.\n*This holds a voice connection open permanently; it uses bandwidth even in silence.*'
        : '🕓 24/7 mode **off** — I will leave when idle.')],
    });
  },
};
