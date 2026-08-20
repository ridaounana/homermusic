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

Everything is registered under **one branded command**, set by
`COMMAND_NAMESPACE` (default `homer`):

**Playback** `/homer play` `search` `pause` `resume` `skip` `back` `stop` `replay` `seek` `volume` `join` `leave`

**Queue** `/homer queue` `nowplaying` `loop` `shuffle` `remove` `move` `clear` `autoplay`

**Sound** `/homer filter`

**Playlists** `/homer playlist save|play|list|show|delete`

**Admin** `/homer dj role` `dj announce` `dj settings` `247`

Most of these are also buttons on the now-playing message.

### Why one command instead of 25

A server running several music bots ends up with five or six identical `/play`
entries in the picker and no way to tell them apart. Registering a single
`/homer` means typing the brand shows this bot and nothing else, because no
other bot owns that word.

The command files are unchanged — each still defines a normal top-level
command, and `src/lib/namespace.js` folds them into subcommands at registration
time. Set `COMMAND_NAMESPACE=` (empty) to go back to flat `/play`, `/skip` and
the rest without touching any code.

One limit worth knowing: Discord allows **25 options per command**, and
subcommands and groups both count against it. There are exactly 25 today, so a
26th command means folding related ones into a group first. `npm run deploy`
fails with that message rather than letting the API reject it opaquely.

## Playing in more than one channel at once

**Discord allows a bot exactly one voice connection per server.** Homer cannot
be in two voice channels of the same server at the same time, and no setting
changes that — it is how Discord works, and it is why the big music bots ship
as "Name (1)", "Name (2)" and so on.

If someone asks for music while a session is running elsewhere, Homer says which
channel is busy and how many people are listening, rather than silently queueing
into a channel they are not in. If that channel has emptied out, it moves to
them instead.

To genuinely serve two channels at once, run a second instance:

1. Create a second application in the Discord Developer Portal, get its token,
   and invite it to the server.
2. Copy `.env` to `.env.2` and change **at least** these:

   ```ini
   DISCORD_TOKEN=<the second bot's token>
   CLIENT_ID=<the second bot's application id>
   COMMAND_NAMESPACE=homer2      # or both register /homer and collide
   DATA_FILE=./data/guilds2.json # or they overwrite each other's settings
   YT_CACHE_PORT=2445            # one loopback port each
   ```

3. `pm2 start ecosystem.config.js` — `.env.2`, `.env.3` … are picked up
   automatically as `music-bot-2`, `music-bot-3`. Then run
   `ENV_FILE=$PWD/.env.2 npm run deploy` to register its commands.

One Lavalink serves them all; only the Discord gateway connection has to be
separate. Each instance costs about 100 MB of RAM.

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
npm run simulate   # 98 offline logic tests against a fake player
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

### What Spotify links actually work

All of them: track, album and playlist. Getting there needs two different
routes, because Spotify locked several Web API endpoints for applications
created after **2024-11-27**.

| Link | How it is read |
|---|---|
| Track | LavaSrc, unchanged |
| Album | `albums/{id}` read directly by the bot. LavaSrc loads the album then calls the batch `/tracks?ids=` endpoint purely for artwork, and that endpoint is now `403` — which failed the whole album. |
| Playlist | the public **embed widget**, `open.spotify.com/embed/playlist/{id}` |

The Web API genuinely cannot serve playlist contents to an app: `/items` answers
`401 Valid user authentication required` and the playlist object arrives with
its track list stripped. But `open.spotify.com/embed/...` is the widget Spotify
serves to anonymous browsers, and it ships the whole track list as JSON inside
the page — no credentials, no login, the same data the web player shows anyone.
That is what makes playlist links work, generated ones (`37i9dQ…`, Discover
Weekly, Daily Mix, Radio) included.

Two things to know about it:

- **The embed caps at 100 tracks.** A longer playlist queues the first 100 and
  the reply says so.
- **It parses Spotify's own page**, so it is more fragile than an API. Every
  step is defensive and a miss returns null, falling back to the ordinary
  "couldn't read that" path rather than throwing.

Album and playlist tracks are queued *unresolved*: each carries its title and
artist and is looked up on the normal search source the moment it plays, so a
100-track playlist costs one request rather than a hundred searches up front.

`SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` in `.env` improve album accuracy
(ISRCs, exact durations, full track lists past 100). Playlists need neither.

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

### When YouTube resolves a track but won't play it

Searching YouTube and *streaming* from it are separate problems. Lavalink
regularly finds a track and then cannot fetch a single byte of it: every client
gets refused with "Sign in to confirm you're not a bot", a SABR-only format, or
a cipher it can't extract from the player JS. From a datacenter IP this comes
and goes on its own — it is rate limiting, not a permanent ban, so don't
reconfigure anything on the strength of one bad run.

When it happens the bot re-fetches **that same video** with `yt-dlp`, caches the
audio, and plays the local file (`src/lib/ytdlp.js` → `src/lib/ytserve.js`). It
only ever runs for the track being played, never for a whole queued playlist,
and only after Lavalink's own attempt has failed — so nothing changes on the
fast path. Only if that fails too does the bot look for the song on another
source.

Two details decide whether this works:

- **yt-dlp needs an explicit JS runtime.** It will not take one from `PATH`.
  Without `YTDLP_NODE` pointing at a Node it considers current it reports
  `node (unavailable)` and every download 403s — which looks exactly like an IP
  ban. Node 22 works; the system Node 20 on a shared box may not.
- **The `android` client is the one that works** for audio. yt-dlp's automatic
  choice 403s and `web,tv` answers "The page needs to be reloaded". It is
  normally ranked last because it caps *video* at ~360p, which is irrelevant
  here.

Set `YTDLP_PATH` and `YTDLP_NODE` to switch it on; leave `YTDLP_PATH` blank and
the bot behaves exactly as it did before. Cached audio is capped by
`YT_CACHE_MAX_MB` and evicted least-recently-used.

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
    fallback.js       finds the same song elsewhere when playback fails
    ytdlp.js          fetches YouTube audio with yt-dlp, caches it on disk
    ytserve.js        serves that cache to Lavalink over loopback
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
