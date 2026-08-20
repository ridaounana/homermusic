'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { describeFailure } = require('../lib/linkhelp');
const { fail, getOrCreatePlayer } = require('./_shared');
const { parseLink } = require('../lib/spotify');

const SOURCES = [
  { name: 'YouTube Music', value: 'ytmsearch' },
  { name: 'YouTube', value: 'ytsearch' },
  { name: 'SoundCloud', value: 'scsearch' },
  { name: 'Spotify', value: 'spsearch' },
  { name: 'Deezer', value: 'dzsearch' },
  { name: 'Apple Music', value: 'amsearch' },
];

/**
 * Resolves a Spotify album into queueable tracks.
 *
 * The tracks are built unresolved: each carries its title and artist and is
 * looked up on the normal search source at the moment it plays. Searching all
 * of them up front would mean one request per track before the first note.
 *
 * Returns { tracks } on success, { reason } when the link is a Spotify link we
 * cannot handle, or null when it is not a Spotify link at all.
 */
async function loadSpotifyAlbum(client, config, query, requester) {
  const link = parseLink(query);
  if (!link || link.kind !== 'album') return null;
  if (!client.spotify?.enabled()) return null;

  let album;
  try {
    album = await client.spotify.album(link.id);
  } catch (err) {
    console.error('[play] spotify album lookup failed:', err?.message || err);
    return { reason: `Could not read that album from Spotify (${err?.status || 'error'}).` };
  }
  if (!album?.tracks?.length) return { reason: 'That Spotify album came back empty.' };

  const tracks = album.tracks.map((t) => client.lavalink.utils.buildUnresolvedTrack({
    title: t.title,
    author: t.author,
    duration: t.duration,
    artworkUrl: t.artworkUrl,
    uri: t.url,
    isrc: t.isrc,
    sourceName: 'spotify',
  }, requester));

  return { name: album.name, artist: album.artist, tracks };
}

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
    const { config, store, client } = ctx;
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
      // A Spotify album fails inside LavaSrc on a batch endpoint Spotify now
      // forbids, even though the album itself reads fine. Do it ourselves.
      const album = await loadSpotifyAlbum(client, config, query, interaction.user);
      if (album?.tracks?.length) {
        const room = config.player.maxQueueSize - player.queue.tracks.length;
        if (room <= 0) return fail(interaction, config, `Queue is full (${config.player.maxQueueSize} tracks).`);
        const queued = album.tracks.slice(0, room);
        await player.queue.add(queued, playNext ? 0 : undefined);
        await interaction.editReply({
          embeds: [embeds.addedPlaylist(config, `${album.name} — ${album.artist}`, queued)],
        });
        if (!player.playing && !player.paused) await player.play();
        player.textChannelId = interaction.channelId;
        return undefined;
      }

      const why = album?.reason || describeFailure(query);
      return fail(interaction, config, why || `No results for **${query}**.`);
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
