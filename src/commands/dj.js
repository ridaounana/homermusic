'use strict';
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const embeds = require('../lib/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('dj').setDescription('Configure who can control playback')
    .addSubcommand((s) => s.setName('role').setDescription('Set the DJ role')
      .addRoleOption((o) => o.setName('role').setDescription('Leave empty to clear').setRequired(false)))
    .addSubcommand((s) => s.setName('settings').setDescription('Show the current music settings'))
    .addSubcommand((s) => s.setName('announce').setDescription('Toggle now-playing messages')
      .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction, { config, store }) {
    const sub = interaction.options.getSubcommand();
    const settings = store.guild(interaction.guildId);

    if (sub === 'role') {
      const role = interaction.options.getRole('role');
      store.setGuild(interaction.guildId, { djRoleId: role?.id || null });
      store.flush();
      return interaction.reply({
        embeds: [embeds.ok(config, role
          ? `🎧 DJ role set to ${role}. Everyone else can still queue tracks, but only DJs (and Manage Server) can skip, stop or clear while others are listening.`
          : '🎧 DJ role cleared — anyone in the voice channel can control playback.')],
      });
    }

    if (sub === 'announce') {
      const enabled = interaction.options.getBoolean('enabled', true);
      store.setGuild(interaction.guildId, { announceTracks: enabled });
      store.flush();
      return interaction.reply({
        embeds: [embeds.ok(config, `📢 Now-playing announcements **${enabled ? 'on' : 'off'}**.`)],
      });
    }

    return interaction.reply({
      embeds: [embeds.base(config).setAuthor({ name: 'Music settings' }).addFields(
        { name: 'DJ role', value: settings.djRoleId ? `<@&${settings.djRoleId}>` : 'None (everyone)', inline: true },
        { name: '24/7 mode', value: settings.twentyFourSeven ? 'On' : 'Off', inline: true },
        { name: 'Announcements', value: settings.announceTracks ? 'On' : 'Off', inline: true },
        { name: 'Default volume', value: `${settings.defaultVolume ?? config.player.defaultVolume}%`, inline: true },
      )],
    });
  },
};
