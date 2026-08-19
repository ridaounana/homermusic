'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { fail, getOrCreatePlayer } = require('./_shared');

const SOURCES = [
  { name: 'YouTube Music', value: 'ytmsearch' },
  { name: 'YouTube', value: 'ytsearch' },
  { name: 'SoundCloud', value: 'scsearch' },
  { name: 'Spotify', value: 'spsearch' },
  { name: 'Deezer', value: 'dzsearch' },
  { name: 'Apple Music', value: 'amsearch' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play a track, playlist or link')
    .addStringOption((o) =>
      o.setName('query').setDescription('Song name or URL').setRequired(true))
    .addStringOption((o) =>
      o.setName('source').setDescription('Where to search (ignored for links)')
        .addChoices(...SOURCES).setRequired(false))
    .addBooleanOption((o) =>
      o.setName('next').setDescription('Put it at the front of the queue').setRequired(false))
    .setDMPermission(false),

  async execute(interaction, ctx) {
    const { config, store } = ctx;
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
    if (!player) return fail(interaction, config, 'Could not join your voice channel.');

    const query = interaction.options.getString('query', true);
    const source = interaction.options.getString('source') || config.player.defaultSearch;
    const playNext = interaction.options.getBoolean('next') || false;

    let result;
    try {
      result = await player.search({ query, source }, interaction.user);
    } catch (err) {
      console.error('[play] search failed:', err);
      return fail(interaction, config, 'Search failed — the audio node may be down. Try again in a moment.');
    }

    if (!result || !result.tracks?.length || result.loadType === 'error') {
      return fail(interaction, config, `No results for **${query}**.`);
    }

    const room = config.player.maxQueueSize - player.queue.tracks.length;
    if (room <= 0) return fail(interaction, config, `Queue is full (${config.player.maxQueueSize} tracks).`);

    if (result.loadType === 'playlist') {
      const tracks = result.tracks.slice(0, room);
      await player.queue.add(tracks, playNext ? 0 : undefined);
      await interaction.editReply({
        embeds: [embeds.addedPlaylist(config, result.playlist?.name || 'Playlist', tracks)],
      });
    } else {
      const track = result.tracks[0];
      await player.queue.add(track, playNext ? 0 : undefined);
      const position = playNext ? 1 : player.queue.tracks.length;
      await interaction.editReply({ embeds: [embeds.added(config, track, position)] });
    }

    if (!player.playing && !player.paused) await player.play();

    // Keep the text channel pointed at wherever the last command was used.
    player.textChannelId = interaction.channelId;
    store.guild(interaction.guildId);
  },
};
