'use strict';
const { SlashCommandBuilder } = require('discord.js');
const embeds = require('../lib/embeds');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('Show every command').setDMPermission(false),

  async execute(interaction, { config }) {
    const embed = embeds.base(config)
      .setAuthor({ name: `${config.botName} — commands` })
      .addFields(
        {
          name: '▶️ Playback',
          value: '`/play` `/search` `/pause` `/resume` `/skip` `/back` `/stop` `/replay` `/seek` `/volume`',
        },
        {
          name: '📃 Queue',
          value: '`/queue` `/nowplaying` `/loop` `/shuffle` `/remove` `/move` `/clear` `/autoplay`',
        },
        {
          name: '🎛️ Sound',
          value: '`/filter` — bass boost, nightcore, vaporwave, 8D, karaoke, tremolo, vibrato, low pass',
        },
        {
          name: '💾 Playlists',
          value: '`/playlist save` `/playlist play` `/playlist list` `/playlist show` `/playlist delete`\nThe ⭐ button on the player saves a track to your **liked** playlist.',
        },
        {
          name: '⚙️ Server settings (Manage Server)',
          value: '`/dj role` `/dj announce` `/dj settings` `/247`',
        },
        {
          name: '🔗 Sources',
          value: 'Links from YouTube, SoundCloud, Bandcamp, Twitch, Vimeo and direct audio URLs. ' +
                 'Spotify, Apple Music and Deezer links are matched to a playable source.',
        }
      )
      .setFooter({ text: 'Tip: most controls are also buttons on the now-playing message.' });

    return interaction.reply({ embeds: [embed] });
  },
};
