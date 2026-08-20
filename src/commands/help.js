'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');
const { commandPath } = require('../lib/namespace');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show every command').setDMPermission(false),

  async execute(interaction, { config }) {
    // Rendered from the namespace so the help text always matches what is
    // actually registered, whether that is /homer play or a flat /play.
    const list = (...names) => names.map((n) => `\`${commandPath(config, n)}\``).join(' ');

    const embed = embeds.base(config)
      .setAuthor({ name: `${config.botName} — commands` })
      .setDescription(config.commandNamespace
        ? `Everything lives under \`/${config.commandNamespace}\`, so it never collides `
          + 'with the other music bots on this server.'
        : null)
      .addFields(
        {
          name: '▶️ Playback',
          value: list('play', 'search', 'pause', 'resume', 'skip', 'back', 'stop', 'replay', 'seek', 'volume'),
        },
        {
          name: '📃 Queue',
          value: list('queue', 'nowplaying', 'loop', 'shuffle', 'remove', 'move', 'clear', 'autoplay'),
        },
        {
          name: '🎛️ Sound',
          value: `${list('filter')} — bass boost, nightcore, vaporwave, 8D, karaoke, tremolo, vibrato, low pass`,
        },
        {
          name: '💾 Playlists',
          value: `${list('playlist save', 'playlist play', 'playlist list', 'playlist show', 'playlist delete')}\n`
            + 'The ⭐ button on the player saves a track to your **liked** playlist.',
        },
        {
          name: '⚙️ Server settings (Manage Server)',
          value: list('dj role', 'dj announce', 'dj settings', '247'),
        },
        {
          name: '🔗 Sources',
          value: 'Links from YouTube, SoundCloud, Bandcamp, Twitch, Vimeo and direct audio URLs. '
            + 'Spotify, Apple Music and Deezer links are matched to a playable source.',
        }
      )
      .setFooter({ text: 'Tip: most controls are also buttons on the now-playing message.' });

    return interaction.reply({ embeds: [embed] });
  },
};
