'use strict';
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const { config, validate } = require('./config');

validate();

const commandsDir = path.join(__dirname, 'commands');
const body = fs.readdirSync(commandsDir)
  .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
  .map((f) => require(path.join(commandsDir, f)))
  .filter((c) => c?.data?.name)
  .map((c) => c.data.toJSON());

(async () => {
  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    if (config.guildId) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
      console.log(`Registered ${body.length} commands to guild ${config.guildId} (instant).`);
    } else {
      await rest.put(Routes.applicationCommands(config.clientId), { body });
      console.log(`Registered ${body.length} global commands (up to 1h to propagate).`);
    }
    console.log(body.map((c) => `/${c.name}`).join('  '));
  } catch (err) {
    console.error('Registration failed:', err);
    process.exit(1);
  }
})();
