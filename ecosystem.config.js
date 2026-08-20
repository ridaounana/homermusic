'use strict';
const fs = require('fs');
const path = require('path');

/**
 * pm2 process definitions.   pm2 start ecosystem.config.js
 *
 * Discord allows a bot exactly one voice connection per server, so one bot
 * cannot play in two voice channels of the same server at the same time. No
 * setting changes that - the only way to serve two channels at once is to run
 * a second bot, with its own Discord application and token. This is why the
 * big music bots ship as "Name (1)", "Name (2)", and so on.
 *
 * Each extra instance is a file named `.env.2`, `.env.3`, ... next to `.env`.
 * They are picked up automatically, so adding one needs no code change.
 *
 * An extra instance MUST have its own:
 *   DISCORD_TOKEN, CLIENT_ID   - a separate application in the Discord portal
 *   COMMAND_NAMESPACE          - e.g. homer2, otherwise both register /homer
 *                                and the picker shows two identical entries
 *   DATA_FILE                  - separate storage, or they overwrite each other
 *   YT_CACHE_PORT              - one loopback port each
 *
 * Everything else - the Lavalink node included - is shared. One Lavalink
 * handles many players; only the Discord gateway connection has to be separate.
 */

const extras = fs.readdirSync(__dirname)
  .filter((f) => /^\.env\.\d+$/.test(f))
  .sort((a, b) => Number(a.split('.').pop()) - Number(b.split('.').pop()));

const base = {
  script: 'src/index.js',
  cwd: __dirname,
  autorestart: true,
  max_restarts: 20,
  restart_delay: 5000,
  max_memory_restart: '400M',
};

module.exports = {
  apps: [
    { ...base, name: 'music-bot', env: { NODE_ENV: 'production' } },
    ...extras.map((file) => ({
      ...base,
      name: `music-bot-${file.split('.').pop()}`,
      // src/config.js reads ENV_FILE when set, so each instance loads its own.
      env: { NODE_ENV: 'production', ENV_FILE: path.join(__dirname, file) },
    })),
  ],
};
