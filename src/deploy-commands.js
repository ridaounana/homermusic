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

// `npm run deploy -- --global` registers once for every server the bot is in,
// now and in future, at the cost of up to an hour to propagate. Without it the
// listed guilds are registered directly, which is instant.
const GLOBAL = process.argv.includes('--global');

(async () => {
  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    if (GLOBAL) {
      await rest.put(Routes.applicationCommands(config.clientId), { body });
      console.log(`Registered ${count} global commands (up to 1h to propagate).`);

      // A guild copy shadows the global one, so leaving stale guild
      // registrations behind means servers keep serving the old commands.
      for (const id of config.guildIds) {
        await rest.put(Routes.applicationGuildCommands(config.clientId, id), { body: [] });
        console.log(`  cleared guild-specific commands in ${id}`);
      }
    } else if (config.guildIds.length) {
      for (const id of config.guildIds) {
        await rest.put(Routes.applicationGuildCommands(config.clientId, id), { body });
        console.log(`Registered ${count} commands to guild ${id} (instant).`);
      }
    } else {
      await rest.put(Routes.applicationCommands(config.clientId), { body });
      console.log(`Registered ${count} global commands (up to 1h to propagate).`);
    }
    console.log(describe());
  } catch (err) {
    console.error('Registration failed:', err?.rawError?.message || err?.message || err);
    if (err?.status === 403) {
      console.error('Missing Access usually means the bot is not in that server, '
        + 'or was invited without the applications.commands scope.');
    }
    process.exit(1);
  }
})();
