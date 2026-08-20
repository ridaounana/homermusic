'use strict';
const fs = require('fs');
const path = require('path');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile(path.resolve(process.cwd(), '.env'));

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v, d) => (v === undefined ? d : /^(1|true|yes|on)$/i.test(String(v)));

const config = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.CLIENT_ID || '',
  guildId: process.env.GUILD_ID || '',
  // GUILD_ID accepts several ids, so a bot in more than one server can register
  // to all of them instantly instead of waiting on global propagation.
  guildIds: String(process.env.GUILD_ID || '')
    .split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),

  botName: process.env.BOT_NAME || 'Music',
  // Every command is registered under this one name, so a server full of music
  // bots does not give you six identical /play entries to choose between.
  // Blank registers them flat, the way it worked before.
  commandNamespace: (process.env.COMMAND_NAMESPACE ?? 'homer').trim().toLowerCase(),
  commandNamespaceDescription:
    process.env.COMMAND_NAMESPACE_DESC || 'Music: play, queue, filters, playlists',

  // The "Listening to …" line under the bot's name. Discord clears presence on
  // a shard reconnect, so index.js re-applies this rather than setting it once.
  presence: {
    text: process.env.PRESENCE_TEXT ?? 'CHAOS - JEAN',
    // listening | playing | watching | competing | custom
    type: process.env.PRESENCE_TYPE || 'listening',
    status: process.env.PRESENCE_STATUS || 'online',
    refreshMs: num(process.env.PRESENCE_REFRESH_MS, 600000),
  },
  embedColor: parseInt((process.env.EMBED_COLOR || '9B59B6').replace('#', ''), 16),
  // Shown in the footer of the now-playing and queue embeds. Set empty to drop it.
  brandFooter: process.env.BRAND_FOOTER ?? 'built for chaos333 community',

  lavalink: {
    host: process.env.LAVALINK_HOST || '127.0.0.1',
    port: num(process.env.LAVALINK_PORT, 2333),
    authorization: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
    secure: bool(process.env.LAVALINK_SECURE, false),
    id: process.env.LAVALINK_NODE_ID || 'main',
  },

  player: {
    // ytsearch | ytmsearch | scsearch | spsearch | dzsearch | amsearch
    defaultSearch: process.env.DEFAULT_SEARCH || 'ytmsearch',
    defaultVolume: num(process.env.DEFAULT_VOLUME, 80),
    maxVolume: num(process.env.MAX_VOLUME, 200),
    // Leave the voice channel after this long with nobody in it (ms). 0 = never.
    emptyChannelTimeoutMs: num(process.env.EMPTY_CHANNEL_TIMEOUT_MS, 120000),
    // Leave after the queue has been empty this long (ms). 0 = never.
    idleTimeoutMs: num(process.env.IDLE_TIMEOUT_MS, 300000),
    maxQueueSize: num(process.env.MAX_QUEUE_SIZE, 1000),
    maxPreviousTracks: num(process.env.MAX_PREVIOUS_TRACKS, 25),
    // Delete the previous now-playing message instead of greying it out, so
    // a long queue leaves one live embed rather than one per track.
    cleanNowPlaying: bool(process.env.CLEAN_NOW_PLAYING, true),
  },

  // Read album metadata straight from Spotify. LavaSrc cannot: it follows up
  // with a batch /tracks?ids= call that Spotify now returns 403 for, which
  // fails the whole album. Same credentials as lavalink/application.yml.
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID || '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
    market: process.env.SPOTIFY_MARKET || 'FR',
  },

  dataFile: process.env.DATA_FILE || path.resolve(process.cwd(), 'data', 'guilds.json'),

  // Fetches YouTube audio with yt-dlp when Lavalink's own YouTube source
  // cannot play it, and serves the file back over loopback. Disabled unless
  // YTDLP_PATH points at a real binary - see src/lib/ytdlp.js for why.
  ytdlp: {
    enabled: bool(process.env.YTDLP_ENABLED, true),
    bin: process.env.YTDLP_PATH || '',
    // yt-dlp will not take a JS runtime from PATH; it needs an explicit path
    // to a version it considers current, or every download 403s.
    nodePath: process.env.YTDLP_NODE || '',
    cacheDir: process.env.YT_CACHE_DIR || path.resolve(process.cwd(), 'data', 'ytcache'),
    cacheMaxBytes: num(process.env.YT_CACHE_MAX_MB, 2048) * 1024 * 1024,
    port: num(process.env.YT_CACHE_PORT, 2444),
    timeoutMs: num(process.env.YTDLP_TIMEOUT_MS, 90000),
  },
};

function validate() {
  const missing = [];
  if (!config.token) missing.push('DISCORD_TOKEN');
  if (!config.clientId) missing.push('CLIENT_ID');
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  }
}

module.exports = { config, validate };
