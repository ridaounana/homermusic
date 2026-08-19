'use strict';
const { MessageFlags } = require('discord.js');
const embeds = require('./lib/embeds');
const { ID, controlRows, queueNavRows } = require('./lib/controls');
const { checkControl } = require('./lib/permissions');
const { stripTrack } = require('./lib/track');

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

async function handleInteraction(client, interaction) {
  const { config, store } = client;

  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      return await command.execute(interaction, { client, config, store });
    }

    if (interaction.isAutocomplete()) {
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) return await command.autocomplete(interaction, { client, config, store });
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith('music:')) {
        return await handleControlButton(client, interaction);
      }
      if (interaction.customId.startsWith('queue:page:')) {
        return await handleQueuePage(client, interaction);
      }
      // search:* buttons are handled by the collector inside /search
      return;
    }
  } catch (err) {
    console.error('[interaction] error:', err);
    const payload = { embeds: [embeds.error(config, 'Something broke handling that.')], ...EPHEMERAL };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch { /* interaction expired */ }
  }
}

/** Playback buttons under the now-playing embed. */
async function handleControlButton(client, interaction) {
  const { config, store } = client;
  const player = client.lavalink.getPlayer(interaction.guildId);
  const settings = store.guild(interaction.guildId);

  if (!player) {
    return interaction.reply({ embeds: [embeds.error(config, 'Nothing is playing.')], ...EPHEMERAL });
  }

  const denied = checkControl(interaction, player, settings);
  if (denied) {
    return interaction.reply({ embeds: [embeds.error(config, denied)], ...EPHEMERAL });
  }

  let notice = null;

  switch (interaction.customId) {
    case ID.PAUSE:
      if (player.paused) { await player.resume(); notice = '▶️ Resumed'; }
      else { await player.pause(); notice = '⏸️ Paused'; }
      break;

    case ID.SKIP:
      if (!player.queue.tracks.length && !player.get('autoplay')) {
        await player.stopPlaying(true, false);
        notice = '⏭️ Skipped — nothing left in the queue';
      } else {
        await player.skip();
        notice = '⏭️ Skipped';
      }
      break;

    case ID.BACK: {
      const previous = player.queue.previous?.[0];
      if (!previous) { notice = 'Nothing to go back to.'; break; }
      await player.queue.add(previous, 0);
      await player.skip();
      notice = '⏮️ Playing the previous track';
      break;
    }

    case ID.STOP:
      await player.destroy();
      return interaction.reply({ embeds: [embeds.ok(config, '⏹️ Stopped and cleared the queue.')] });

    case ID.LOOP: {
      const next = player.repeatMode === 'off' ? 'track' : player.repeatMode === 'track' ? 'queue' : 'off';
      await player.setRepeatMode(next);
      notice = `Loop: **${embeds.labelRepeat(next)}**`;
      break;
    }

    case ID.SHUFFLE:
      if (player.queue.tracks.length < 2) { notice = 'Not enough tracks to shuffle.'; break; }
      await player.queue.shuffle();
      notice = `🔀 Shuffled ${player.queue.tracks.length} tracks`;
      break;

    case ID.VOL_UP:
    case ID.VOL_DOWN: {
      const step = 10;
      const target = interaction.customId === ID.VOL_UP
        ? Math.min(config.player.maxVolume, player.volume + step)
        : Math.max(0, player.volume - step);
      await player.setVolume(target);
      notice = `🔊 Volume **${target}%**`;
      break;
    }

    case ID.QUEUE:
      return interaction.reply({ embeds: [embeds.queuePage(config, player, 1)], ...EPHEMERAL });

    case ID.LIKE: {
      const track = player.queue.current;
      if (!track) { notice = 'Nothing playing.'; break; }
      const liked = store.getPlaylist(interaction.user.id, 'liked')?.tracks || [];
      const already = liked.some((t) => t.info?.uri === track.info?.uri);
      if (already) { notice = '⭐ Already in your **liked** playlist.'; break; }
      store.savePlaylist(interaction.user.id, 'liked', [...liked, stripTrack(track)]);
      store.flush();
      notice = `⭐ Saved to your **liked** playlist (${liked.length + 1} tracks). Load it with \`/playlist play liked\`.`;
      break;
    }

    default:
      return;
  }

  // Refresh the now-playing message so the buttons reflect the new state.
  try {
    await interaction.update({
      embeds: [embeds.nowPlaying(config, player, player.queue.current)],
      components: controlRows(player),
    });
    if (notice) await interaction.followUp({ content: notice, ...EPHEMERAL });
  } catch {
    if (notice) await interaction.reply({ content: notice, ...EPHEMERAL }).catch(() => {});
  }
}

async function handleQueuePage(client, interaction) {
  const { config } = client;
  const player = client.lavalink.getPlayer(interaction.guildId);
  if (!player) {
    return interaction.reply({ embeds: [embeds.error(config, 'Nothing is playing.')], ...EPHEMERAL });
  }
  const page = Number(interaction.customId.split(':')[2]) || 1;
  const pages = Math.max(1, Math.ceil(player.queue.tracks.length / 10));
  await interaction.update({
    embeds: [embeds.queuePage(config, player, page)],
    components: queueNavRows(Math.min(Math.max(1, page), pages), pages),
  });
}

module.exports = { handleInteraction, EPHEMERAL };
