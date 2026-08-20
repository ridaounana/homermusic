'use strict';
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const { config, validate } = require('./config');
const { buildNamespacedCommand } = require('./lib/namespace');

validate();

const commandsDir = path.join(__dirname, 'commands');
const commands = fs.readdirSync(commandsDir)
  .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
  .map((f) => require(path.join(commandsDir, f)))
  .filter((c) => c?.data?.name);

// One branded command holding everything, unless the namespace is turned off.
const body = config.commandNamespace
  ? [buildNamespacedCommand(commands, {
    name: config.commandNamespace,
    description: config.commandNamespaceDescription,
  })]
  : commands.map((c) => c.data.toJSON());

function describe() {
  if (!config.commandNamespace) return body.map((c) => `/${c.name}`).join('  ');
  const brand = config.commandNamespace;
  return body[0].options
    .map((o) => (o.type === 2
      ? o.options.map((s) => `/${brand} ${o.name} ${s.name}`).join('  ')
      : `/${brand} ${o.name}`))
    .join('  ');
}

const count = config.commandNamespace ? body[0].options.length : body.length;

(async () => {
  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    if (config.guildId) {
      await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body });
      console.log(`Registered ${count} commands to guild ${config.guildId} (instant).`);
    } else {
      await rest.put(Routes.applicationCommands(config.clientId), { body });
      console.log(`Registered ${count} global commands (up to 1h to propagate).`);
    }
    console.log(describe());
  } catch (err) {
    console.error('Registration failed:', err);
    process.exit(1);
  }
})();
