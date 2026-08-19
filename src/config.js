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

  botName: process.env.BOT_NAME || 'Music',
  embedColor: parseInt((process.env.EMBED_COLOR || '9B59B6').replace('#', ''), 16),

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
  },

  dataFile: process.env.DATA_FILE || path.resolve(process.cwd(), 'data', 'guilds.json'),
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
