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

/**
 * Footer with the community tag, plus optional context in front of it.
 * Kept to the embeds people actually linger on - stamping it on every ack
 * would turn it into noise rather than branding. Setting BRAND_FOOTER empty
 * drops the tag and leaves the context, so the footer is never set to null.
 */
function setBrandFooter(embed, config, context) {
  const text = [context, config?.brandFooter].filter(Boolean).join('  •  ');
  return text ? embed.setFooter({ text }) : embed;
}

/**
 * Sets artwork only when it is a real http(s) URL.
 *
 * setThumbnail throws on a malformed value, and that would take down the whole
 * embed - a track with odd artwork should lose its picture, not its message.
 */
function setArtwork(embed, url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return embed;
  try {
    return embed.setThumbnail(url);
  } catch {
    return embed;
  }
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

  // One inline code span holds the timestamps and the bar together, so they
  // share a monospace grid and stay aligned instead of drifting apart.
  const timeline = info.isStream
    ? '`🔴  LIVE  ' + '▰'.repeat(16) + '`'
    : `\`${duration(position).padStart(5)} ${progressBar(position, info.duration)} ${duration(info.duration).padEnd(5)}\``;

  const stats = [
    `\`🔊 ${String(player?.volume ?? 0).padStart(3)}%\``,
    `\`${labelRepeat(player?.repeatMode)}\``,
    sourceTag(track),
  ].join('   ');

  const upNext = player?.queue?.tracks?.[0];
  const queueLen = player?.queue?.tracks?.length || 0;

  const embed = base(config)
    .setAuthor({ name: '♪   N O W   P L A Y I N G' })
    .setDescription(
      `## ${trackLink(track)}\n` +
      `-# ${truncate(info.author || 'Unknown', 60)}\n\n` +
      `${timeline}\n\n` +
      `${stats}\n` +
      (track?.requester ? `-# requested by <@${track.requester.id}>\n` : '') +
      (upNext
        ? `\n**⏭  Up next**\n${trackLink(upNext)}` +
          (queueLen > 1 ? `\n-# and ${queueLen - 1} more in the queue` : '')
        : '')
    );
  setBrandFooter(embed, config);

  setArtwork(embed, info.artworkUrl);

  return embed;
}

function labelRepeat(mode) {
  if (mode === 'track') return '🔂 track';
  if (mode === 'queue') return '🔁 queue';
  return '➡ no loop';
}

function added(config, track, positionInQueue) {
  const info = track.info || {};
  const embed = base(config)
    .setAuthor({ name: '＋   A D D E D   T O   Q U E U E' })
    .setDescription(
      `**${trackLink(track)}**\n` +
      `-# ${truncate(info.author || 'Unknown', 60)}\n\n` +
      `\`#${positionInQueue}\`   \`${duration(info.duration, info.isStream)}\`   ${sourceTag(track)}`
    );
  setArtwork(embed, info.artworkUrl);
  return embed;
}

function addedPlaylist(config, playlistName, tracks) {
  return base(config)
    .setAuthor({ name: '＋   A D D E D   T O   Q U E U E' })
    .setDescription(
      `**${truncate(playlistName, 70)}**\n` +
      `-# playlist\n\n` +
      `\`${tracks.length} tracks\`   \`${duration(totalQueueDuration(tracks))}\``
    );
}

function queuePage(config, player, page, perPage = 10) {
  const tracks = player.queue.tracks;
  const pages = Math.max(1, Math.ceil(tracks.length / perPage));
  const current = Math.min(Math.max(1, page), pages);
  const slice = tracks.slice((current - 1) * perPage, current * perPage);

  const lines = slice.map((t, i) => {
    const n = (current - 1) * perPage + i + 1;
    return `\`${String(n).padStart(2, ' ')}\`  ${trackLink(t)}\n` +
           `-# ${truncate(t.info?.author || 'Unknown', 40)} · ${duration(t.info?.duration, t.info?.isStream)}`;
  });

  const nowLine = player.queue.current
    ? `**▶  Now playing**\n${trackLink(player.queue.current)}\n\n**▤  Up next**\n`
    : '';

  const embed = base(config)
    .setAuthor({ name: '▤   Q U E U E' })
    .setDescription(
      nowLine + (lines.length
        ? lines.join('\n')
        : '-# Nothing queued — add something with `/play`.')
    );

  return setBrandFooter(embed, config,
    `${current}/${pages}  ·  ${tracks.length} queued  ·  ` +
    `${duration(totalQueueDuration(tracks))} left  ·  ${labelRepeat(player.repeatMode)}`);
}

module.exports = {
  base, error, ok, nowPlaying, added, addedPlaylist, queuePage,
  labelRepeat, sourceTag, setBrandFooter, setArtwork,
};
