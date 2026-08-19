'use strict';
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const ID = {
  BACK: 'music:back',
  PAUSE: 'music:pause',
  SKIP: 'music:skip',
  STOP: 'music:stop',
  LOOP: 'music:loop',
  SHUFFLE: 'music:shuffle',
  QUEUE: 'music:queue',
  VOL_DOWN: 'music:voldown',
  VOL_UP: 'music:volup',
  LIKE: 'music:like',
};

/** Two rows of playback controls shown under the now-playing message. */
function controlRows(player) {
  const paused = Boolean(player?.paused);
  const looping = player?.repeatMode && player.repeatMode !== 'off';

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(ID.BACK).setEmoji('⏮️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(ID.PAUSE).setEmoji(paused ? '▶️' : '⏸️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(ID.SKIP).setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(ID.STOP).setEmoji('⏹️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(ID.LOOP).setEmoji('🔁')
      .setStyle(looping ? ButtonStyle.Success : ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(ID.VOL_DOWN).setEmoji('🔉').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(ID.VOL_UP).setEmoji('🔊').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(ID.SHUFFLE).setEmoji('🔀').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(ID.QUEUE).setEmoji('📃').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(ID.LIKE).setEmoji('⭐').setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2];
}

/** Same layout, every button dead — used when a track ends. */
function disabledRows(player) {
  return controlRows(player).map((row) => {
    for (const component of row.components) component.setDisabled(true);
    return row;
  });
}

/** Numbered picker for /search results. */
function searchRows(count) {
  const digits = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
  const row = new ActionRowBuilder();
  for (let i = 0; i < Math.min(count, 5); i++) {
    row.addComponents(
      new ButtonBuilder().setCustomId(`search:pick:${i}`).setEmoji(digits[i]).setStyle(ButtonStyle.Secondary)
    );
  }
  const cancel = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('search:cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
  );
  return [row, cancel];
}

function queueNavRows(page, pages) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`queue:page:${page - 1}`).setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary).setDisabled(page <= 1),
    new ButtonBuilder().setCustomId(`queue:page:${page + 1}`).setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary).setDisabled(page >= pages)
  )];
}

module.exports = { ID, controlRows, disabledRows, searchRows, queueNavRows };
