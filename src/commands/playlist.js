'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { duration, trackLink, totalQueueDuration, truncate } = require('../lib/format');
const { fail, getOrCreatePlayer } = require('./_shared');
const { stripTrack } = require('../lib/track');

const MAX_PLAYLISTS = 25;
const MAX_TRACKS = 500;

module.exports = {
  data: new SlashCommandBuilder().setName('playlist').setDescription('Save and load your own playlists')
    .addSubcommand((s) => s.setName('save')
      .setDescription('Save the current queue as a playlist')
      .addStringOption((o) => o.setName('name').setDescription('Playlist name').setRequired(true).setMaxLength(40)))
    .addSubcommand((s) => s.setName('play')
      .setDescription('Queue one of your playlists')
      .addStringOption((o) => o.setName('name').setDescription('Playlist name')
        .setRequired(true).setAutocomplete(true))
      .addBooleanOption((o) => o.setName('shuffle').setDescription('Shuffle it on load').setRequired(false)))
    .addSubcommand((s) => s.setName('list').setDescription('Show your saved playlists'))
    .addSubcommand((s) => s.setName('show')
      .setDescription('Show the tracks in a playlist')
      .addStringOption((o) => o.setName('name').setDescription('Playlist name')
        .setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('delete')
      .setDescription('Delete a playlist')
      .addStringOption((o) => o.setName('name').setDescription('Playlist name')
        .setRequired(true).setAutocomplete(true)))
    .setDMPermission(false),

  async autocomplete(interaction, { store }) {
    const typed = (interaction.options.getFocused() || '').toLowerCase();
    const choices = store.listPlaylists(interaction.user.id)
      .filter((p) => p.name.toLowerCase().includes(typed))
      .slice(0, 25)
      .map((p) => ({ name: `${p.name} (${p.tracks.length} tracks)`, value: p.name }));
    return interaction.respond(choices);
  },

  async execute(interaction, ctx) {
    const { client, config, store } = ctx;
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;

    // ------------------------------------------------------------------ save
    if (sub === 'save') {
      const player = client.lavalink.getPlayer(interaction.guildId);
      if (!player) return fail(interaction, config, 'Nothing is playing — there is no queue to save.');

      const tracks = [player.queue.current, ...player.queue.tracks].filter(Boolean).map(stripTrack);
      if (!tracks.length) return fail(interaction, config, 'The queue is empty.');

      const name = interaction.options.getString('name', true).trim();
      const existing = store.getPlaylist(userId, name);
      if (!existing && store.listPlaylists(userId).length >= MAX_PLAYLISTS) {
        return fail(interaction, config, `You have hit the limit of ${MAX_PLAYLISTS} playlists. Delete one first.`);
      }

      store.savePlaylist(userId, name, tracks.slice(0, MAX_TRACKS));
      store.flush();
      return interaction.reply({
        embeds: [embeds.ok(config,
          `💾 Saved **${truncate(name, 40)}** — ${tracks.length} track(s)${existing ? ' *(overwrote the old one)*' : ''}.`)],
      });
    }

    // ------------------------------------------------------------------ play
    if (sub === 'play') {
      const name = interaction.options.getString('name', true);
      const playlist = store.getPlaylist(userId, name);
      if (!playlist) return fail(interaction, config, `You have no playlist called **${truncate(name, 40)}**.`);
      if (!interaction.member?.voice?.channel) return fail(interaction, config, 'Join a voice channel first.');

      await interaction.deferReply();

      let player;
      try {
        player = await getOrCreatePlayer(interaction, ctx);
      } catch (err) {
        return fail(interaction, config, err.message);
      }

      // Saved tracks may be stale (deleted videos, expired encodings), so
      // re-resolve each one by URL and skip whatever no longer exists.
      const resolved = [];
      const missing = [];
      for (const saved of playlist.tracks) {
        try {
          const res = await player.search(
            { query: saved.info?.uri || `${saved.info?.author} ${saved.info?.title}` },
            interaction.user
          );
          if (res?.tracks?.length) resolved.push(res.tracks[0]);
          else missing.push(saved.info?.title || 'unknown');
        } catch {
          missing.push(saved.info?.title || 'unknown');
        }
      }

      if (!resolved.length) {
        return fail(interaction, config, 'None of the tracks in that playlist could be loaded any more.');
      }

      if (interaction.options.getBoolean('shuffle')) {
        for (let i = resolved.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [resolved[i], resolved[j]] = [resolved[j], resolved[i]];
        }
      }

      await player.queue.add(resolved);
      if (!player.playing && !player.paused) await player.play();

      const note = missing.length
        ? `\n*${missing.length} track(s) could not be loaded and were skipped.*`
        : '';
      return interaction.editReply({
        embeds: [embeds.ok(config,
          `▶️ Queued **${truncate(playlist.name, 40)}** — ${resolved.length} track(s), ` +
          `\`${duration(totalQueueDuration(resolved))}\`.${note}`)],
      });
    }

    // ------------------------------------------------------------------ list
    if (sub === 'list') {
      const all = store.listPlaylists(userId);
      if (!all.length) {
        return fail(interaction, config, 'You have no saved playlists. Queue some music and use `/playlist save`.');
      }
      const lines = all
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((p) => `• **${truncate(p.name, 40)}** — ${p.tracks.length} track(s)`);
      return interaction.reply({
        embeds: [embeds.base(config).setAuthor({ name: `${interaction.user.username}'s playlists` })
          .setDescription(lines.join('\n'))],
      });
    }

    // ------------------------------------------------------------------ show
    if (sub === 'show') {
      const playlist = store.getPlaylist(userId, interaction.options.getString('name', true));
      if (!playlist) return fail(interaction, config, 'No playlist by that name.');
      const lines = playlist.tracks.slice(0, 20).map((t, i) =>
        `\`${String(i + 1).padStart(2, ' ')}.\` ${trackLink(t)} — \`${duration(t.info?.duration, t.info?.isStream)}\``);
      const more = playlist.tracks.length > 20 ? `\n*…and ${playlist.tracks.length - 20} more*` : '';
      return interaction.reply({
        embeds: [embeds.base(config).setAuthor({ name: playlist.name })
          .setDescription(lines.join('\n') + more)
          .setFooter({ text: `${playlist.tracks.length} tracks · ${duration(totalQueueDuration(playlist.tracks))}` })],
      });
    }

    // ---------------------------------------------------------------- delete
    if (sub === 'delete') {
      const name = interaction.options.getString('name', true);
      const deleted = store.deletePlaylist(userId, name);
      store.flush();
      return deleted
        ? interaction.reply({ embeds: [embeds.ok(config, `🗑️ Deleted **${truncate(name, 40)}**.`)] })
        : fail(interaction, config, 'No playlist by that name.');
    }
  },
};
