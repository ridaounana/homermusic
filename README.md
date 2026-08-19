# Music bot

A self-hosted Discord music bot in the Jockie/Musico mould: queue, filters,
saved playlists, DJ roles, autoplay, 24/7 mode and button controls on the
now-playing message.

**Architecture.** Two processes. [Lavalink](https://lavalink.dev) is a Java
audio node that fetches, decodes and streams audio to Discord. The Node bot
never touches an audio frame — it sends Lavalink instructions over
REST/WebSocket and renders the Discord side. That split is why one small VPS
can serve dozens of servers: the expensive part is isolated and restartable
without dropping your bot's gateway session.

- 25 slash commands
- Sources: YouTube, SoundCloud, Bandcamp, Twitch, Vimeo, direct audio URLs and internet radio
- Spotify / Apple Music / Deezer **links** resolve to a playable match (see below)
- Filters: bass boost, nightcore, vaporwave, 8D, karaoke, tremolo, vibrato, low pass
- Per-user saved playlists + a ⭐ button that saves the current track
- DJ role, per-guild settings, JSON storage with atomic writes — no database

## Quick start

```bash
npm install
cp .env.example .env      # fill in token, client id, lavalink password
npm run deploy            # register slash commands
npm start
```

Lavalink needs to be running first — see **DEPLOY.md** for the full VPS setup,
systemd unit, firewall rules and a troubleshooting table.

## Commands

**Playback** `/play` `/search` `/pause` `/resume` `/skip` `/back` `/stop` `/replay` `/seek` `/volume` `/join` `/leave`

**Queue** `/queue` `/nowplaying` `/loop` `/shuffle` `/remove` `/move` `/clear` `/autoplay`

**Sound** `/filter`

**Playlists** `/playlist save|play|list|show|delete`

**Admin** `/dj role` `/dj announce` `/dj settings` `/247`

Most of these are also buttons on the now-playing message.

## Who can control playback

1. Anyone with **Manage Server** always can.
2. If a DJ role is set, DJs can; everyone else can queue but not skip/stop/clear.
3. If no DJ role is set, anyone in the voice channel can.
4. Alone in the channel with the bot — you're the DJ.

Set it with `/dj role`. All of this lives in one function
(`src/lib/permissions.js → checkControl`) so the rules can't drift between
commands and buttons.

## Testing

```bash
npm run check      # parses every file, validates all 25 command definitions
npm run simulate   # 44 offline logic tests against a fake player
```

The simulation stubs discord.js and lavalink-client, so it runs with no token
and no Lavalink. It covers time parsing, the permission matrix, queue
operations, playlist round-trips and every button. It caught one real bug
while being written (`/seek 99:00` was rejected — minutes above 59 are valid
in `mm:ss`).

---

## About sources — read this once

**Spotify, Apple Music and Deezer do not permit third-party audio streaming.**
No bot streams from them, including the big ones. What LavaSrc does is read the
*metadata* from a link (title, artist, artwork) and find a matching track on a
source that can actually be streamed. If a Spotify link plays "the wrong
version", that's why.

**YouTube.** You chose to enable it knowing the position, so briefly for the
record: playing YouTube audio through a bot breaks YouTube's Terms of Service.
In September 2021 Google sent cease-and-desist letters to Groovy and Rythm —
together around 350 million users — and both shut down within weeks. Enforcement
is legal, not technical: nothing blocks you, right up until a letter arrives.

What that means in practice:

- Risk scales with visibility. A bot in your own servers is a very different
  proposition from a public bot advertised on bot lists.
- **Do not monetise it.** Selling premium tiers for YouTube playback is what
  turns "hobby project" into "commercial infringement" in a lawyer's reading.
- Keep `SoundCloud` and the rest enabled. If YouTube ever stops working, you
  change `DEFAULT_SEARCH=scsearch` and the bot keeps running.

The `youtube-source` plugin also ships `oauth` and `poToken` options that exist
to defeat YouTube's bot detection. **They are deliberately left out of
`application.yml`.** The plugin's own documentation warns they can get the
linked Google account terminated, and using them means knowingly evading an
access control rather than reading a public endpoint. If you add them later,
that's your call — use a burner account, never your main one.

## Project layout

```
src/
  index.js            entry point, command/event loaders, idle-leave logic
  config.js           env parsing and validation
  lavalink.js         Lavalink manager + all player events
  interactions.js     slash/button/autocomplete router
  store.js            guild settings + playlists (atomic JSON)
  commands/           one file per slash command (_shared.js is a helper)
  lib/
    permissions.js    the single source of truth for who may control playback
    embeds.js         every embed the bot sends
    controls.js       button rows
    format.js         durations, progress bar, safe markdown
    autoplay.js       related-track selection when the queue empties
    track.js          trims tracks before saving them
lavalink/
  application.yml     Lavalink server config with plugins
test/
  syntax-check.js     parse + command definition validation
  simulate.js         offline logic tests
```

## Tuning

| Setting | Default | Notes |
|---|---|---|
| `DEFAULT_SEARCH` | `ytmsearch` | YouTube Music gives cleaner results than plain YouTube for songs |
| `DEFAULT_VOLUME` | `80` | Lavalink clips above 100; 80 leaves headroom |
| `EMPTY_CHANNEL_TIMEOUT_MS` | `120000` | Leave 2 min after the channel empties |
| `IDLE_TIMEOUT_MS` | `300000` | Leave 5 min after the queue ends |
| `MAX_QUEUE_SIZE` | `1000` | Guards memory against someone queueing a 10k playlist |

`/247` overrides both timeouts for a server. It holds a voice connection open
permanently, which costs bandwidth even in silence — fine for one server, worth
thinking about across many.
