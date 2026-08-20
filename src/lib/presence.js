'use strict';
const { ActivityType } = require('discord.js');

/**
 * The bot's presence line — the "Listening to …" under its name.
 *
 * A bot cannot reproduce the green Spotify card: album art, the progress bar
 * and the clickable track link come from Discord's Spotify account integration,
 * which is only wired up for user accounts. `ActivityType.Listening` renders
 * the same "Listening to <text>" line, and that is as close as a bot gets.
 *
 * Discord drops presence when a shard reconnects and does not restore it, so
 * whatever sets this has to re-apply it on resume rather than only at startup.
 */

const TYPES = {
  listening: ActivityType.Listening,
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  competing: ActivityType.Competing,
  custom: ActivityType.Custom,
};

// Discord truncates past this, and an over-long name is rejected outright.
const MAX_NAME = 128;

function activityType(name) {
  const key = String(name || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(TYPES, key) ? TYPES[key] : ActivityType.Listening;
}

/**
 * Builds the presence payload, or null when the text is blank - in which case
 * the caller should leave the presence alone rather than clearing it.
 */
function buildPresence(config) {
  const text = String(config?.presence?.text || '').trim().slice(0, MAX_NAME);
  if (!text) return null;

  const type = activityType(config?.presence?.type);
  const activity = { name: text, type };
  // A custom status carries its text in `state`; `name` is ignored by the
  // client and is conventionally "Custom Status".
  if (type === ActivityType.Custom) {
    activity.name = 'Custom Status';
    activity.state = text;
  }

  return { activities: [activity], status: config?.presence?.status || 'online' };
}

module.exports = { buildPresence, activityType, TYPES, MAX_NAME };
