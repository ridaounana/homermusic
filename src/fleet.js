'use strict';
const { Client, GatewayIntentBits } = require('discord.js');
const { setupLavalink } = require('./lavalink');

/**
 * Several bot accounts, one process, one Lavalink.
 *
 * Discord allows a bot exactly one voice connection per server, so serving two
 * voice channels at once needs two bot *accounts*. There is no API to create
 * one, so they are provisioned by hand and pooled here; the fleet decides which
 * account serves a request, and nobody has to know which one they got.
 *
 * Only the primary registers slash commands. Every command it receives is
 * routed to whichever instance owns the caller's voice channel, so one channel
 * cannot reach another channel's session - which is what stops somebody
 * stopping music they are not listening to. Buttons need no routing: a
 * component interaction is delivered to the account that posted the message.
 *
 * One Lavalink hosts them all. Each account opens its own session, verified
 * against the live node before this was built.
 */
class Fleet {
  constructor({ config, store, ytCache = null, ytServer = null, commands, spotify = null }) {
    this.config = config;
    this.store = store;
    this.ytCache = ytCache;
    this.ytServer = ytServer;
    this.commands = commands;
    this.spotify = spotify;
    this.instances = [];
  }

  /** Logs every configured account in. A bad token is skipped, not fatal. */
  async start({ onInteraction }) {
    const accounts = [
      { token: this.config.token, name: this.config.botName, primary: true },
      ...this.config.fleet,
    ];

    for (const [index, account] of accounts.entries()) {
      if (!account.token) continue;
      const instance = this._build(account, index);
      try {
        await instance.client.login(account.token);
        instance.ready = true;
        this.instances.push(instance);
      } catch (err) {
        // One dead token must not stop the rest of the fleet coming up.
        console.error(`[fleet] ${account.name || `#${index}`} could not log in:`,
          err?.message || err);
        try { instance.client.destroy(); } catch { /* never logged in */ }
      }
    }

    // Commands only exist on the primary, but every account handles the
    // buttons on messages it posted itself.
    for (const instance of this.instances) {
      instance.client.on('interactionCreate', (interaction) => onInteraction(instance, interaction));
    }

    return this.instances.length;
  }

  _build(account, index) {
    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
    });

    const instance = {
      index,
      primary: Boolean(account.primary),
      name: account.name || `${this.config.botName} ${index + 1}`,
      client,
      manager: null,
      ready: false,
    };

    client.config = this.config;
    client.store = this.store;
    client.commands = this.commands;
    client.spotify = this.spotify;
    client.fleet = this;
    client.instance = instance;

    instance.manager = setupLavalink(client, {
      config: this.config,
      store: this.store,
      ytCache: this.ytCache,
      ytServer: this.ytServer,
    });

    client.once('ready', async (c) => {
      instance.name = account.name || c.user.username;
      console.log(`[fleet] ${instance.name} ready${instance.primary ? ' (primary, owns the commands)' : ''}`);
      await instance.manager.init({ id: c.user.id, username: c.user.username });
    });

    return instance;
  }

  get primary() {
    return this.instances.find((i) => i.primary) || this.instances[0] || null;
  }

  get size() {
    return this.instances.length;
  }

  /** Every instance currently holding a player in this guild. */
  active(guildId) {
    return this.instances
      .map((instance) => ({ instance, player: instance.manager?.getPlayer?.(guildId) || null }))
      .filter((entry) => entry.player);
  }

  /** The instance sitting in this exact voice channel, if any. */
  ownerOf(guildId, voiceChannelId) {
    if (!voiceChannelId) return null;
    return this.active(guildId)
      .find(({ player }) => player.voiceChannelId === voiceChannelId) || null;
  }

  /**
   * Which player a command should act on.
   *
   * The caller's own voice channel decides it. When they are not in one and
   * exactly one session is running, that session is used - so `/queue` and
   * `/nowplaying` still work from a text channel on a quiet server. With
   * several running it is ambiguous, so nothing is returned rather than
   * guessing and touching the wrong channel's music.
   */
  playerFor(guildId, voiceChannelId) {
    const owner = this.ownerOf(guildId, voiceChannelId);
    if (owner) return owner;

    const running = this.active(guildId);
    return running.length === 1 ? running[0] : null;
  }

  /** Instances that are actually a member of this server. */
  membersOf(guildId) {
    return this.instances.filter((i) => i.ready && i.client?.guilds?.cache?.has?.(guildId));
  }

  /**
   * An instance to serve this channel: the one already there, else any that is
   * free in this guild. Null when every instance is busy elsewhere.
   *
   * Membership is checked, not assumed. An account that has been given a token
   * but never invited logs in perfectly well and looks idle, so without this it
   * would be handed out and then fail to join a server it is not in.
   */
  acquire(guildId, voiceChannelId) {
    const owner = this.ownerOf(guildId, voiceChannelId);
    if (owner) return owner.instance;
    return this.membersOf(guildId).find((i) => !i.manager?.getPlayer?.(guildId)) || null;
  }

  /** Accounts that are logged in but not invited to this server. */
  notInvited(guildId) {
    return this.instances
      .filter((i) => i.ready && !i.client?.guilds?.cache?.has?.(guildId))
      .map((i) => i.name);
  }

  /** Channels this guild's instances are busy in, for the "all in use" reply. */
  busyChannels(guildId) {
    return this.active(guildId).map(({ instance, player }) => ({
      name: instance.name,
      channelId: player.voiceChannelId,
    }));
  }

  destroyAll() {
    for (const instance of this.instances) {
      try {
        for (const player of instance.manager?.players?.values?.() || []) {
          player.destroy().catch(() => {});
        }
      } catch { /* ignore */ }
      try { instance.client.destroy(); } catch { /* ignore */ }
    }
  }
}

module.exports = { Fleet };
