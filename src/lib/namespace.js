'use strict';

/**
 * Folds every command into one branded top-level command.
 *
 * A server running several music bots ends up with five or six `/play` entries
 * in the command picker, and picking the right one is guesswork. Registering a
 * single `/<brand>` instead means typing the brand shows this bot and nothing
 * else, because no other bot owns that word.
 *
 * The command files are not written twice. Each one still defines an ordinary
 * top-level command; this converts that definition into a subcommand at
 * registration time, so `/play` and `/<brand> play` are the same code.
 *
 * Discord's shape, and the limits that come with it:
 *   command -> subcommand                     (a plain command)
 *   command -> subcommand group -> subcommand (a command that already had subcommands)
 * Nesting stops there, and a command may carry at most 25 options, which
 * subcommands and groups both count against.
 */

const SUBCOMMAND = 1;
const SUBCOMMAND_GROUP = 2;
const MAX_OPTIONS = 25;

// Discord rejects anything else, and the failure at registration is opaque.
const NAME_RE = /^[-_a-z0-9]{1,32}$/;

/** Fields that only make sense on a top-level command. */
function optionsOnly(json) {
  return (json.options || []).map((o) => ({ ...o }));
}

/**
 * One command definition -> a subcommand, or a group if it already nests.
 * Returns null for anything Discord would reject.
 */
function toOption(json) {
  if (!json?.name || !NAME_RE.test(json.name)) return null;
  const options = optionsOnly(json);
  const nests = options.some((o) => o.type === SUBCOMMAND || o.type === SUBCOMMAND_GROUP);

  return {
    type: nests ? SUBCOMMAND_GROUP : SUBCOMMAND,
    name: json.name,
    description: json.description || json.name,
    options,
  };
}

/**
 * Builds the single registered command. `commands` is the list of loaded
 * modules; order is preserved so the picker lists them predictably.
 */
function buildNamespacedCommand(commands, { name, description }) {
  if (!NAME_RE.test(String(name || ''))) {
    throw new Error(`COMMAND_NAMESPACE "${name}" is not a valid command name (lowercase, a-z 0-9 - _, max 32).`);
  }

  const options = [];
  for (const command of commands) {
    const json = typeof command?.data?.toJSON === 'function' ? command.data.toJSON() : null;
    const option = toOption(json);
    if (option) options.push(option);
  }

  if (options.length > MAX_OPTIONS) {
    // Failing here is much kinder than a rejected registration: the API error
    // does not say which limit was hit.
    throw new Error(
      `${options.length} commands exceeds Discord's limit of ${MAX_OPTIONS} subcommands on /${name}. `
      + 'Combine related commands into a subcommand group to make room.',
    );
  }

  return {
    name,
    description,
    options,
    dm_permission: false,
  };
}

/**
 * Which command module should handle an interaction.
 *
 * Modules stay keyed by their original top-level name, so a group like
 * `/brand playlist save` resolves to the `playlist` module - which still reads
 * `getSubcommand()` as `save` and needs no changes.
 */
function resolveCommandName(interaction, namespace) {
  if (!namespace || interaction.commandName !== namespace) return interaction.commandName;
  const group = interaction.options.getSubcommandGroup(false);
  if (group) return group;
  return interaction.options.getSubcommand(false) || interaction.commandName;
}

/** How a command should be written in user-facing text: `/brand play`. */
function commandPath(config, tail) {
  const brand = config?.commandNamespace;
  return brand ? `/${brand} ${tail}` : `/${tail}`;
}

module.exports = {
  buildNamespacedCommand, resolveCommandName, commandPath, toOption,
  MAX_OPTIONS, NAME_RE,
};
