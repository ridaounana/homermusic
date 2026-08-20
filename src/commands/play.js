'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { describeFailure } = require('../lib/linkhelp');
const { fail, getOrCreatePlayer } = require('./_shared');
const { detect, resolve: resolveCollection } = require('../lib/playlist');
const { buildSmartTrack, wrapYoutubeTrack } = require('../lib/resolve');

const SOURCES = [
  { name: 'YouTube Music', value: 'ytmsearch' },
  { name: 'YouTube', value: 'ytsearch' },
  { name: 'SoundCloud', value: 'scsearch' },
  { name: 'Spotify', value: 'spsearch' },
  { name: 'Deezer', value: 'dzsearch' },
  { name: 'Apple Music', value: 'amsearch' },
];

const SOURCE_LABEL = {
  spotify: '🟢 spotify → matched on YouTube',
  youtube: '🔴 youtube',
};

/**
 * Queues a playlist or album.
 *
 * Playlist links are handled before the ordinary search, not after it fails.
 * Going through the search first meant Lavalink was asked to load a Spotify
 * playlist it cannot read, and the error path then had to guess what the user
 * had actually pasted.
 *
 * The two services diverge here, and only here:
 *
 *   Spotify   a list of names. Each becomes a track that looks itself up on
 *             YouTube when it plays, scored so the official recording wins.
 *   YouTube   already playable, so the tracks are queued untouched.
 *
 * Returns true when it handled the query.
 */
async function queueCollection(interaction, ctx, { player, query, playNext }) {
  const { config, client } = ctx;
  if (!detect(query)) return false;

  const collection = await resolveCollection(query, {
    player,
    requester: interaction.user,
  }).catch((err) => {
    console.error('[play] collection resolve failed:', err?.message || err);
    return null;
  });

  if (!collection) {
    await fail(interaction, config,
      describeFailure(query) || 'Could not read that playlist.');
    return true;
  }

  const room = config.player.maxQueueSize - player.queue.tracks.length;
  if (room <= 0) {
    await fail(interaction, config, `Queue is full (${config.player.maxQueueSize} tracks).`);
    return true;
  }

  const wanted = collection.tracks.slice(0, room);

  // Spotify entries are names, so each becomes a track that matches itself on
  // YouTube at play time. One request now instead of a search per track.
  const queued = collection.needsMatching
    ? wanted.map((t) => buildSmartTrack(client.lavalink, {
      title: t.title,
      author: t.author,
      duration: t.duration,
      artworkUrl: t.artworkUrl,
      isrc: t.isrc,
    }, interaction.user))
    // Already playable, but still wrapped: it defers the "is YouTube refusing
    // us right now" decision to the moment each track plays, so a blocked host
    // is handled before playback rather than after it fails and reorders the
    // playlist.
    : wanted.map((t) => wrapYoutubeTrack(client.lavalink, t, interaction.user));

  await player.queue.add(queued, playNext ? 0 : undefined);

  const label = collection.artist
    ? `${collection.name} — ${collection.artist}`
    : collection.name;
  const notes = [];
  if (collection.truncated) notes.push('Spotify only exposes the first 100 tracks');
  if (collection.tracks.length > room) notes.push(`queue limit reached after ${room}`);

  await interaction.editReply({
    embeds: [embeds.addedPlaylist(config, label, wanted, {
      subtitle: collection.kind === 'radio' ? 'YouTube mix' : `${collection.service} ${collection.kind}`,
      source: SOURCE_LABEL[collection.service] || null,
      artworkUrl: collection.artworkUrl,
      note: notes.length ? notes.join(' · ') : null,
    })],
  });

  if (!player.playing && !player.paused) await player.play();
  player.textChannelId = interaction.channelId;
  return true;
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

    // Playlists and albums take their own route entirely.
    if (await queueCollection(interaction, ctx, { player, query, playNext })) {
      store.guild(interaction.guildId);
      return undefined;
    }

    let result;
    try {
      result = await player.search({ query, source }, interaction.user);
    } catch (err) {
      console.error('[play] search failed:', err);
      return fail(interaction, config, 'Search failed — the audio node may be down. Try again in a moment.');
    }

    if (!result || !result.tracks?.length || result.loadType === 'error') {
      return fail(interaction, config, describeFailure(query) || `No results for **${query}**.`);
    }

    const room = config.player.maxQueueSize - player.queue.tracks.length;
    if (room <= 0) return fail(interaction, config, `Queue is full (${config.player.maxQueueSize} tracks).`);

    if (result.loadType === 'playlist') {
      // A playlist the search turned up on its own - SoundCloud sets, for one.
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
