'use strict';
const { SlashCommandBuilder, ComponentType } = require('discord.js');
const embeds = require('../lib/embeds');
const { describeFailure } = require('../lib/linkhelp');
const { searchRows } = require('../lib/controls');
const { duration, trackLink } = require('../lib/format');
const { fail, getOrCreatePlayer, EPHEMERAL } = require('./_shared');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search and pick from the top 5 results')
    .addStringOption((o) => o.setName('query').setDescription('What to search for').setRequired(true))
    .addStringOption((o) => o.setName('source').setDescription('Where to search')
      .addChoices(
        { name: 'YouTube Music', value: 'ytmsearch' },
        { name: 'YouTube', value: 'ytsearch' },
        { name: 'SoundCloud', value: 'scsearch' },
        { name: 'Spotify', value: 'spsearch' },
      ).setRequired(false))
    .setDMPermission(false),

  async execute(interaction, ctx) {
    const { config } = ctx;
    await interaction.deferReply();

    if (!interaction.member?.voice?.channel) {
      return fail(interaction, config, 'Join a voice channel first.');
    }

    let player;
    try {
      player = await getOrCreatePlayer(interaction, ctx);
    } catch (err) {
      return fail(interaction, config, err.message);
    }

    const query = interaction.options.getString('query', true);
    const source = interaction.options.getString('source') || config.player.defaultSearch;

    const result = await player.search({ query, source }, interaction.user).catch(() => null);
    const tracks = (result?.tracks || []).slice(0, 5);
    if (!tracks.length) {
      const why = describeFailure(query);
      return fail(interaction, config, why || `No results for **${query}**.`);
    }

    const list = tracks.map((t, i) =>
      `\`${i + 1}.\` ${trackLink(t)} — \`${duration(t.info?.duration, t.info?.isStream)}\``).join('\n');

    const message = await interaction.editReply({
      embeds: [embeds.base(config).setAuthor({ name: `Results for "${query}"` }).setDescription(list)
        .setFooter({ text: 'Pick one within 30 seconds' })],
      components: searchRows(tracks.length),
    });

    try {
      const choice = await message.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 30000,
        filter: (i) => i.user.id === interaction.user.id && i.customId.startsWith('search:'),
      });

      if (choice.customId === 'search:cancel') {
        return choice.update({ embeds: [embeds.ok(config, 'Search cancelled.')], components: [] });
      }

      const index = Number(choice.customId.split(':')[2]);
      const track = tracks[index];
      if (!track) return choice.update({ components: [] });

      await player.queue.add(track);
      if (!player.playing && !player.paused) await player.play();

      await choice.update({
        embeds: [embeds.added(config, track, player.queue.tracks.length || 1)],
        components: [],
      });
    } catch {
      await interaction.editReply({
        embeds: [embeds.ok(config, 'Search timed out.')],
        components: [],
      }).catch(() => {});
    }
  },
};
