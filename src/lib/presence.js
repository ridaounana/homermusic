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
function buildPresence(config, { nowPlaying = null } = {}) {
  // What is actually playing beats the idle line. With several accounts pooled
  // this turns the member list into a status board: each bot advertises its own
  // track, so you can see which are busy without opening a channel.
  const text = String(nowPlaying || config?.presence?.text || '').trim().slice(0, MAX_NAME);
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


/**
 * The line for a track: "Title — Artist", trimmed to what Discord accepts.
 */
function describeTrack(track) {
  const info = track?.info || {};
  const title = String(info.title || '').trim();
  if (!title) return null;
  const author = String(info.author || '').trim();
  const line = author ? `${title} — ${author}` : title;
  return line.length > MAX_NAME ? `${line.slice(0, MAX_NAME - 1)}…` : line;
}

// Discord allows roughly 5 presence updates per 20s per connection. A track
// change is far slower than that, but a skip spree is not, so updates are
// coalesced: the newest state always wins and nothing queues up behind it.
const MIN_INTERVAL_MS = 5000;
const throttle = new WeakMap();

/**
 * Shows `track` as this client's status, or the idle line when null.
 *
 * Safe to call as often as events fire - it applies the latest state at most
 * once per interval rather than sending one update per call.
 */
function setNowPlaying(client, config, track) {
  if (!client?.user) return;
  const desired = track ? describeTrack(track) : null;

  let state = throttle.get(client);
  if (!state) {
    state = { timer: null, lastAt: 0, desired: null };
    throttle.set(client, state);
  }
  state.desired = desired;

  const send = () => {
    state.timer = null;
    state.lastAt = Date.now();
    const payload = buildPresence(config, { nowPlaying: state.desired });
    if (!payload || !client.user) return;
    try {
      client.user.setPresence(payload);
    } catch (e) {
      console.warn('[presence] could not update:', e?.message || e);
    }
  };

  const since = Date.now() - state.lastAt;
  if (since >= MIN_INTERVAL_MS) return send();
  if (state.timer) return undefined; // one is already scheduled; it will pick up
  state.timer = setTimeout(send, MIN_INTERVAL_MS - since);
  if (state.timer.unref) state.timer.unref();
  return undefined;
}

/** True when this account still has something playing somewhere. */
function stillPlaying(client) {
  for (const player of client?.lavalink?.players?.values?.() || []) {
    if (player?.queue?.current) return true;
  }
  return false;
}

module.exports = {
  buildPresence, setNowPlaying, describeTrack, stillPlaying,
  activityType, TYPES, MAX_NAME, MIN_INTERVAL_MS,
};
