'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { describeFailure } = require('../lib/linkhelp');
const { fail, getOrCreatePlayer } = require('./_shared');
const { parseLink, readEmbed } = require('../lib/spotify');
const { buildSmartTrack } = require('../lib/resolve');

const SOURCES = [
  { name: 'YouTube Music', value: 'ytmsearch' },
  { name: 'YouTube', value: 'ytsearch' },
  { name: 'SoundCloud', value: 'scsearch' },
  { name: 'Spotify', value: 'spsearch' },
  { name: 'Deezer', value: 'dzsearch' },
  { name: 'Apple Music', value: 'amsearch' },
];

/**
 * Resolves a Spotify album or playlist into queueable tracks.
 *
 * Albums go through the Web API first: it gives ISRCs and exact durations.
 * Playlists cannot be read that way at all, and albums fall over on a batch
 * endpoint Spotify forbids, so both fall back to the public embed widget -
 * which is what actually makes playlist links work.
 *
 * Tracks are built unresolved: each carries its title and artist and is looked
 * up on the normal search source the moment it plays, so a 100-track playlist
 * costs one request rather than a hundred searches up front.
 *
 * Returns { name, artist, tracks, truncated } on success, { reason } when a
 * Spotify link cannot be read, or null when it is not a Spotify link.
 */
async function loadSpotifyCollection(client, query, requester) {
  const link = parseLink(query);
  if (!link || (link.kind !== 'album' && link.kind !== 'playlist')) return null;

  let data = null;

  if (link.kind === 'album' && client.spotify?.enabled()) {
    try {
      data = await client.spotify.album(link.id);
    } catch (err) {
      console.warn('[play] spotify album api failed, trying embed:', err?.message || err);
    }
  }

  if (!data) {
    data = await readEmbed(link.kind, link.id);
  }

  if (!data?.tracks?.length) {
    return {
      reason: link.kind === 'playlist'
        ? 'Could not read that Spotify playlist. Private playlists are not visible to bots.'
        : 'Could not read that Spotify album.',
    };
  }

  // Deliberately built through buildSmartTrack rather than the raw
  // buildUnresolvedTrack: passing the Spotify uri or sourceName sends
  // lavalink-client down a branch that plays search result #1 unchecked, which
  // is how AI covers end up playing instead of the track.
  const tracks = data.tracks.map((t) => buildSmartTrack(client.lavalink, {
    title: t.title,
    author: t.author,
    duration: t.duration,
    artworkUrl: t.artworkUrl,
    isrc: t.isrc,
  }, requester));

  return { name: data.name, artist: data.artist, truncated: data.truncated, tracks };
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
      // LavaSrc cannot read Spotify albums or playlists any more, so resolve
      // them here before reporting a failure.
      const collection = await loadSpotifyCollection(client, query, interaction.user);
      if (collection?.tracks?.length) {
        const room = config.player.maxQueueSize - player.queue.tracks.length;
        if (room <= 0) return fail(interaction, config, `Queue is full (${config.player.maxQueueSize} tracks).`);
        const queued = collection.tracks.slice(0, room);
        await player.queue.add(queued, playNext ? 0 : undefined);
        const label = collection.artist
          ? `${collection.name} — ${collection.artist}`
          : collection.name;
        await interaction.editReply({
          embeds: [embeds.addedPlaylist(config, label, queued, {
            note: collection.truncated ? 'Spotify only exposes the first 100 tracks' : null,
          })],
        });
        if (!player.playing && !player.paused) await player.play();
        player.textChannelId = interaction.channelId;
        return undefined;
      }

      const why = collection?.reason || describeFailure(query);
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
