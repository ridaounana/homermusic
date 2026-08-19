'use strict';
const { EmbedBuilder } = require('discord.js');
const { duration, progressBar, trackLink, truncate, totalQueueDuration } = require('./format');

const SOURCE_ICONS = {
  youtube: '🔴', youtubemusic: '🔴', soundcloud: '🟠', bandcamp: '🔵',
  spotify: '🟢', applemusic: '⚪', deezer: '🟣', twitch: '🟣', http: '🌐',
};

function sourceTag(track) {
  const name = String(track?.info?.sourceName || '').toLowerCase();
  return `${SOURCE_ICONS[name] || '🎵'} ${name || 'unknown'}`;
}

function base(config) {
  return new EmbedBuilder().setColor(config.embedColor);
}

function error(config, message) {
  return base(config).setColor(0xED4245).setDescription(`❌ ${message}`);
}

function ok(config, message) {
  return base(config).setDescription(message);
}

function nowPlaying(config, player, track) {
  const info = track?.info || {};
  const position = player?.position || 0;
  const embed = base(config)
    .setAuthor({ name: 'Now playing' })
    .setDescription(
      `### ${trackLink(track)}\n` +
      `by **${truncate(info.author || 'Unknown', 50)}**`
    )
    .addFields(
      {
        name: '​',
        value: info.isStream
          ? '🔴 **Live stream**'
          : `\`${duration(position)}\` ${progressBar(position, info.duration)} \`${duration(info.duration)}\``,
      },
      { name: 'Requested by', value: track?.requester ? `<@${track.requester.id}>` : 'Unknown', inline: true },
      { name: 'Volume', value: `${player?.volume ?? 0}%`, inline: true },
      { name: 'Loop', value: labelRepeat(player?.repeatMode), inline: true }
    );

  if (info.artworkUrl) embed.setThumbnail(info.artworkUrl);

  const upNext = player?.queue?.tracks?.[0];
  if (upNext) embed.setFooter({ text: `Up next: ${truncate(upNext.info?.title, 60)}` });

  return embed;
}

function labelRepeat(mode) {
  if (mode === 'track') return '🔂 Track';
  if (mode === 'queue') return '🔁 Queue';
  return 'Off';
}

function added(config, track, positionInQueue) {
  const embed = base(config)
    .setDescription(`➕ Queued ${trackLink(track)} — \`${duration(track.info?.duration, track.info?.isStream)}\``)
    .setFooter({ text: `Position ${positionInQueue} · ${sourceTag(track)}` });
  if (track.info?.artworkUrl) embed.setThumbnail(track.info.artworkUrl);
  return embed;
}

function addedPlaylist(config, playlistName, tracks) {
  return base(config)
    .setDescription(
      `➕ Queued **${truncate(playlistName, 70)}** — ${tracks.length} tracks, ` +
      `\`${duration(totalQueueDuration(tracks))}\` total`
    );
}

function queuePage(config, player, page, perPage = 10) {
  const tracks = player.queue.tracks;
  const pages = Math.max(1, Math.ceil(tracks.length / perPage));
  const current = Math.min(Math.max(1, page), pages);
  const slice = tracks.slice((current - 1) * perPage, current * perPage);

  const lines = slice.map((t, i) => {
    const n = (current - 1) * perPage + i + 1;
    return `\`${String(n).padStart(2, ' ')}.\` ${trackLink(t)} — \`${duration(t.info?.duration, t.info?.isStream)}\``;
  });

  const nowLine = player.queue.current
    ? `**Now:** ${trackLink(player.queue.current)}\n\n`
    : '';

  return base(config)
    .setAuthor({ name: 'Queue' })
    .setDescription(nowLine + (lines.length ? lines.join('\n') : '*Queue is empty — add something with `/play`.*'))
    .setFooter({
      text: `Page ${current}/${pages} · ${tracks.length} in queue · ` +
            `${duration(totalQueueDuration(tracks))} remaining · Loop: ${labelRepeat(player.repeatMode)}`,
    });
}

module.exports = { base, error, ok, nowPlaying, added, addedPlaylist, queuePage, labelRepeat, sourceTag };
