'use strict';
/**
 * Offline logic tests. discord.js and lavalink-client are stubbed, so this
 * exercises real command code against a fake player - no token, no VPS.
 *   node test/simulate.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fmt = require('../src/lib/format');
const fallback = require('../src/lib/fallback');
const embeds = require('../src/lib/embeds');
const { checkControl, isDj } = require('../src/lib/permissions');
const { Store } = require('../src/store');
const { handleInteraction } = require('../src/interactions');

let passed = 0;
const lines = [];
const test = (name, fn) => Promise.resolve().then(fn)
  .then(() => { passed++; lines.push(`  PASS  ${name}`); })
  .catch((e) => { lines.push(`  FAIL  ${name}\n          ${e.message}`); process.exitCode = 1; });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'music-'));

const config = {
  botName: 'Test', embedColor: 0x9b59b6,
  brandFooter: 'built for chaos333 community',
  player: { defaultSearch: 'ytmsearch', defaultVolume: 80, maxVolume: 200, maxQueueSize: 1000 },
  dataFile: path.join(tmp, 'guilds.json'),
};

// ---------------------------------------------------------------- fake player
const makeTrack = (title, over = {}) => ({
  encoded: `enc_${title}`,
  info: {
    title, author: 'Artist', uri: `https://example.com/${encodeURIComponent(title)}`,
    identifier: title.replace(/\s/g, ''), duration: 210000, isStream: false,
    sourceName: 'youtube', ...over,
  },
  requester: { id: 'u1' },
});

function makePlayer(tracks = []) {
  const player = {
    guildId: 'g1', voiceChannelId: 'vc1', textChannelId: 'tc1',
    volume: 80, paused: false, playing: true, position: 60000,
    repeatMode: 'off', connected: true,
    _data: new Map(),
    get(k) { return this._data.get(k); },
    set(k, v) { this._data.set(k, v); },
    queue: {
      current: tracks[0] || null,
      tracks: tracks.slice(1),
      previous: [],
      add(t, at) {
        const items = Array.isArray(t) ? t : [t];
        if (at === undefined) this.tracks.push(...items);
        else this.tracks.splice(at, 0, ...items);
      },
      remove(i) { return this.tracks.splice(i, 1); },
      splice(i, n) { return this.tracks.splice(i, n); },
      shuffle() { this.tracks.reverse(); },
    },
    async play() { this.playing = true; },
    async pause() { this.paused = true; },
    async resume() { this.paused = false; },
    async skip(to) {
      if (to) this.queue.tracks.splice(0, to - 1);
      const next = this.queue.tracks.shift();
      if (this.queue.current) this.queue.previous.unshift(this.queue.current);
      this.queue.current = next || null;
    },
    async stopPlaying() { this.queue.current = null; this.playing = false; },
    async seek(ms) { this.position = ms; },
    async setVolume(v) { this.volume = v; },
    async setRepeatMode(m) { this.repeatMode = m; },
    async destroy() { this.destroyed = true; },
    async search({ query }) {
      if (query.includes('nothing')) return { loadType: 'empty', tracks: [] };
      if (query.includes('playlist')) {
        return { loadType: 'playlist', playlist: { name: 'Test Playlist' }, tracks: [makeTrack('P1'), makeTrack('P2')] };
      }
      return { loadType: 'search', tracks: [makeTrack(`Result for ${query}`), makeTrack('Second'), makeTrack('Third')] };
    },
    filterManager: {
      applied: [],
      async toggleBassboost() { this.applied.push('bass'); },
      async toggleNightcore() { this.applied.push('nightcore'); },
      async resetFilters() { this.applied = []; },
    },
  };
  return player;
}

function makeInteraction({ userId = 'u1', roles = [], manageGuild = false, inVoice = 'vc1', options = {} } = {}) {
  const captured = [];
  return {
    captured, guildId: 'g1', channelId: 'tc1',
    user: { id: userId, username: 'tester' },
    member: {
      voice: { channel: inVoice ? { id: inVoice, members: { filter: () => ({ size: 2 }) } } : null },
      permissions: { has: () => manageGuild },
      roles: { cache: { has: (r) => roles.includes(r) } },
    },
    guild: { members: { me: {} } },
    options: {
      getString: (n, req) => { const v = options[n] ?? null; if (req && v === null) throw new Error(`missing ${n}`); return v; },
      getInteger: (n) => (options[n] ?? null),
      getBoolean: (n) => (options[n] ?? null),
      getRole: (n) => (options[n] ?? null),
      getSubcommand: () => options.__sub,
      getFocused: () => options.__focused || '',
    },
    deferred: false, replied: false,
    isChatInputCommand: () => false, isButton: () => false, isAutocomplete: () => false,
    async deferReply() { this.deferred = true; },
    async reply(p) { captured.push(p); this.replied = true; },
    async editReply(p) { captured.push(p); },
    async followUp(p) { captured.push(p); },
    async update(p) { captured.push(p); },
    async respond(p) { captured.push(p); },
  };
}

const text = (i) => JSON.stringify(i.captured.at(-1));
const cmd = (name) => require(`../src/commands/${name}`);

(async () => {
  console.log('\nFORMATTING');

  await test('duration formats minutes and hours', () => {
    assert.strictEqual(fmt.duration(245000), '4:05');
    assert.strictEqual(fmt.duration(7325000), '2:02:05');
    assert.strictEqual(fmt.duration(0), '0:00');
    assert.strictEqual(fmt.duration(999, true), 'LIVE');
  });

  await test('parseTime accepts every documented format', () => {
    assert.strictEqual(fmt.parseTime('90'), 90000);
    assert.strictEqual(fmt.parseTime('1:30'), 90000);
    assert.strictEqual(fmt.parseTime('1:02:03'), 3723000);
    assert.strictEqual(fmt.parseTime('1m30s'), 90000);
    assert.strictEqual(fmt.parseTime('2h'), 7200000);
    // mm:ss may exceed 59 minutes - "99:00" means 99 minutes, not an error
    assert.strictEqual(fmt.parseTime('99:00'), 99 * 60 * 1000);
    assert.strictEqual(fmt.parseTime('120:30'), (120 * 60 + 30) * 1000);
  });

  await test('parseTime rejects nonsense instead of guessing', () => {
    assert.strictEqual(fmt.parseTime('banana'), null);
    assert.strictEqual(fmt.parseTime('1:99'), null);      // 99 seconds is not valid
    assert.strictEqual(fmt.parseTime('1:99:00'), null);   // 99 minutes inside h:mm:ss is not
    assert.strictEqual(fmt.parseTime(''), null);
  });

  await test('track titles with markdown characters cannot break the embed', () => {
    const link = fmt.trackLink(makeTrack('[BAD] (title)'));
    // Brackets must be escaped - an unescaped ] ends the label early.
    assert.ok(link.includes('\\[') && link.includes('\\]'), `unescaped brackets: ${link}`);
    // Parens must NOT be escaped. Discord does not treat ( ) as markdown, so a
    // backslash before them is not a recognised escape and renders literally.
    assert.ok(!link.includes('\\('), `parens should not be escaped: ${link}`);
    // A raw paren in the URL half would terminate the link early, so it is
    // percent-encoded instead.
    const url = link.slice(link.indexOf('](') + 2, -1);
    assert.ok(!url.includes('(') && !url.includes(')'), `raw paren in url: ${url}`);
    assert.ok(link.endsWith(')'), `link should close: ${link}`);
  });

  await test('progress bar keeps a fixed width at both ends', () => {
    // Fixed width matters: the bar shares an inline code span with the
    // timestamps, so any drift misaligns the whole line.
    for (const pos of [0, 1, 49, 50, 99, 100, 500]) {
      assert.strictEqual(fmt.progressBar(pos, 100, 10).length, 10, `width at ${pos}`);
    }
    assert.strictEqual(fmt.progressBar(0, 100, 10), '▱'.repeat(10));
    assert.strictEqual(fmt.progressBar(100, 100, 10), '▰'.repeat(10));
    // An unknown or zero duration must not produce a ragged bar.
    assert.strictEqual(fmt.progressBar(5, 0, 10).length, 10);
    assert.strictEqual(fmt.progressBar(5, undefined, 10).length, 10);
    // No emoji: they render at a different width and break the alignment.
    assert.ok(!/\p{Extended_Pictographic}/u.test(fmt.progressBar(50, 100, 10)));
  });

  await test('the community footer is applied, and can be turned off', () => {
    const { EmbedBuilder } = require('discord.js');
    const branded = embeds.setBrandFooter(new EmbedBuilder(), config).toJSON();
    assert.strictEqual(branded.footer.text, 'built for chaos333 community');

    const withContext = embeds.setBrandFooter(new EmbedBuilder(), config, '1/2').toJSON();
    assert.ok(withContext.footer.text.startsWith('1/2'), withContext.footer.text);
    assert.ok(withContext.footer.text.includes('built for chaos333 community'));

    // Blank BRAND_FOOTER must leave the footer unset rather than null, which
    // discord.js rejects.
    const off = embeds.setBrandFooter(new EmbedBuilder(), { brandFooter: '' }).toJSON();
    assert.strictEqual(off.footer, undefined);
    const offWithContext = embeds.setBrandFooter(new EmbedBuilder(), { brandFooter: '' }, '1/2').toJSON();
    assert.strictEqual(offWithContext.footer.text, '1/2');
  });

  console.log(lines.splice(0).join('\n'));
  console.log('\nSOURCE FALLBACK');

  // A player whose search() answers from a fixed map of prefix -> tracks.
  const makeSearchPlayer = (byPrefix) => ({
    searched: [],
    async search({ query }) {
      const prefix = query.slice(0, query.indexOf(':'));
      this.searched.push(query);
      return { tracks: byPrefix[prefix] || [] };
    },
  });

  await test('familyOf groups both YouTube prefixes under one source', () => {
    assert.strictEqual(fallback.familyOf(makeTrack('a', { sourceName: 'youtube' })), 'youtube');
    assert.strictEqual(fallback.familyOf(makeTrack('a', { sourceName: 'youtubemusic' })), 'youtube');
    assert.strictEqual(fallback.familyOf(makeTrack('a', { sourceName: 'soundcloud' })), 'soundcloud');
    assert.strictEqual(fallback.familyOf(makeTrack('a', { sourceName: 'bandcamp' })), null);
  });

  await test('buildQuery strips video noise and does not repeat the artist', () => {
    const q = fallback.buildQuery(makeTrack('Daft Punk - One More Time (Official Video) [HD]', {
      author: 'Daft Punk',
    }));
    assert.strictEqual(q, 'Daft Punk - One More Time');
    // "Artist - Topic" channels should not leak the suffix into the query.
    const q2 = fallback.buildQuery(makeTrack('One More Time', { author: 'Daft Punk - Topic' }));
    assert.strictEqual(q2, 'Daft Punk One More Time');
  });

  await test('an unrelated search result is rejected, not played', async () => {
    // The real regression: "CAMEMBERT" failed, the retry took whatever was top
    // of the results, and the bot played "CRITALITY IRELIA! YES, YOU READ IT
    // RIGHT!" instead. A wrong song is worse than an honest failure.
    const junk = makeTrack('CRITALITY IRELIA! YES, YOU READ IT RIGHT!', {
      author: 'Some Streamer', sourceName: 'soundcloud', uri: 'https://sc/junk',
    });
    const player = makeSearchPlayer({ scsearch: [junk], ytmsearch: [junk], ytsearch: [junk] });
    const wanted = makeTrack('CAMEMBERT', { author: 'ZKR', sourceName: 'youtube', uri: 'https://yt/1' });

    const found = await fallback.findAlternative(player, wanted, null,
      [{ uri: 'https://yt/1', family: 'youtube' }]);
    assert.strictEqual(found, null, 'must not accept an unrelated track');

    assert.ok(fallback.isSameSong({ title: 'CAMEMBERT', author: 'ZKR' },
      { title: 'CAMEMBERT (Clip Officiel)', author: 'ZKR' }), 'same song should match');
    assert.ok(!fallback.isSameSong({ title: 'CAMEMBERT', author: 'ZKR' },
      { title: 'Not the Answer You Seek', author: 'Someone' }), 'different song must not');

    // A different song by the RIGHT artist is still the wrong song. Scoring
    // title and artist in one pool let this through at exactly 0.5.
    assert.ok(!fallback.isSameSong({ title: 'CAMEMBERT', author: 'ZKR' },
      { title: 'GTS', author: 'Zkr' }), 'same artist is not the same song');

    // Sources split title/author differently, so the artist may legitimately
    // appear inside the candidate's title.
    assert.ok(fallback.isSameSong({ title: 'Mghayer', author: 'ElGrandeToto' },
      { title: 'ElGrandeToto - Mghayer', author: 'Acoustician' }), 'reshuffled credits should match');

    // Titles too short to yield keywords fall back to an exact comparison.
    assert.ok(fallback.isSameSong({ title: 'Up', author: 'X' }, { title: 'up!', author: 'Y' }));
    assert.ok(!fallback.isSameSong({ title: 'Up', author: 'X' }, { title: 'Down', author: 'X' }));
  });

  await test('every retry searches the original song, not the last failure', async () => {
    // Query drift: retry 1 found "Mghayer (Live Performance) (feat. Aykonz)",
    // and searching from THAT title walked further away each round.
    const live = makeTrack('Mghayer (Live Performance) (feat. Aykonz)', {
      author: 'Aloha Live', sourceName: 'soundcloud', uri: 'https://sc/live',
    });
    const player = makeSearchPlayer({ scsearch: [live] });
    const original = makeTrack('Mghayer', {
      author: 'ElGrandeToto', sourceName: 'youtube', uri: 'https://yt/orig',
    });

    await fallback.findAlternative(player, original, null,
      [{ uri: 'https://yt/orig', family: 'youtube' }]);
    // The query must be built from the original every time.
    assert.ok(player.searched.length, 'should have searched');
    for (const q of player.searched) {
      assert.ok(/mghayer/i.test(q), `query lost the song: ${q}`);
      assert.ok(!/live performance|aykonz/i.test(q), `query drifted: ${q}`);
    }
  });

  await test('one 404 retries the same source for a different upload', async () => {
    // A SoundCloud Go+ upload 404s, but another upload of the song plays.
    const other = makeTrack('Song', { sourceName: 'soundcloud', uri: 'https://sc/other' });
    const player = makeSearchPlayer({ scsearch: [other] });
    const failed = makeTrack('Song', { sourceName: 'soundcloud', uri: 'https://sc/gone' });

    const found = await fallback.findAlternative(player, failed, null,
      [{ uri: 'https://sc/gone', family: 'soundcloud' }]);
    assert.ok(found, 'should retry SoundCloud rather than abandon it');
    assert.strictEqual(found.source, 'soundcloud');
    assert.strictEqual(found.track.info.uri, 'https://sc/other');
  });

  await test('a source retires after repeated failures', async () => {
    const scTrack = makeTrack('Song', { sourceName: 'soundcloud', uri: 'https://sc/1' });
    const player = makeSearchPlayer({ scsearch: [scTrack] });
    const failed = makeTrack('Song', { sourceName: 'youtube', uri: 'https://yt/2' });

    const found = await fallback.findAlternative(player, failed, null, [
      { uri: 'https://yt/1', family: 'youtube' },
      { uri: 'https://yt/2', family: 'youtube' },
    ]);
    assert.ok(found, 'should move to SoundCloud');
    assert.strictEqual(found.source, 'soundcloud');
    assert.ok(!player.searched.some((q) => q.startsWith('yt')), 'a dead source must not be retried');
    assert.deepStrictEqual(
      fallback.deadFamilies([
        { family: 'youtube' }, { family: 'youtube' }, { family: 'soundcloud' },
      ]),
      ['youtube'],
    );
  });

  await test('findAlternative never returns a uri that already failed', async () => {
    const same = makeTrack('Song', { sourceName: 'soundcloud', uri: 'https://sc/same' });
    const player = makeSearchPlayer({ scsearch: [same] });
    const found = await fallback.findAlternative(player, same, null,
      [{ uri: 'https://sc/same', family: 'soundcloud' }]);
    assert.strictEqual(found, null, 'the failing uri must not be offered back');
  });

  await test('findAlternative gives up when every source is exhausted', async () => {
    const player = makeSearchPlayer({});
    const dead = fallback.FAMILIES.flatMap((f) => [
      { uri: `https://${f.name}/1`, family: f.name },
      { uri: `https://${f.name}/2`, family: f.name },
    ]);
    const found = await fallback.findAlternative(
      player, makeTrack('Song', { sourceName: 'youtube' }), null, dead,
    );
    assert.strictEqual(found, null);
    assert.strictEqual(player.searched.length, 0, 'no searches when all sources are dead');
  });

  await test('a search that throws does not abort the whole retry', async () => {
    const ytTrack = makeTrack('Song', { sourceName: 'youtube', uri: 'https://yt/ok' });
    const player = {
      searched: [],
      async search({ query }) {
        this.searched.push(query);
        if (query.startsWith('scsearch')) throw new Error('source down');
        return { tracks: [ytTrack] };
      },
    };
    const found = await fallback.findAlternative(
      player, makeTrack('Song', { sourceName: 'soundcloud', uri: 'https://sc/1' }), null,
      [{ uri: 'https://sc/1', family: 'soundcloud' }],
    );
    assert.ok(found, 'should fall through to the next source');
    assert.strictEqual(found.source, 'youtube');
  });

  console.log(lines.splice(0).join('\n'));
  console.log('\nSPOTIFY ALBUMS');

  const { SpotifyClient, parseLink } = require('../src/lib/spotify');

  // Stands in for the Spotify API. Records calls so the tests can assert that
  // the forbidden batch endpoint is never touched.
  function stubFetch(handler) {
    const calls = [];
    const real = global.fetch;
    global.fetch = async (url, opts = {}) => {
      calls.push(String(url));
      const r = handler(String(url), opts) || {};
      return {
        ok: r.status ? r.status < 400 : true,
        status: r.status || 200,
        json: async () => r.body,
      };
    };
    return { calls, restore: () => { global.fetch = real; } };
  }

  const TOKEN = { access_token: 'tok', expires_in: 3600 };
  const ALBUM = {
    name: 'Random Access Memories',
    artists: [{ name: 'Daft Punk' }],
    images: [{ url: 'https://i.example/art.jpg' }],
    external_urls: { spotify: 'https://open.spotify.com/album/abc' },
    tracks: {
      total: 2,
      items: [
        { name: 'Give Life Back to Music', artists: [{ name: 'Daft Punk' }], duration_ms: 274000, external_ids: { isrc: 'X1' } },
        { name: 'Doin\' it Right', artists: [{ name: 'Daft Punk' }, { name: 'Panda Bear' }], duration_ms: 251000 },
      ],
    },
  };

  await test('a Spotify link is parsed in all the forms Spotify hands out', () => {
    assert.deepStrictEqual(parseLink('https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa'),
      { kind: 'album', id: '4m2880jivSbbyEGAKfITCa' });
    // The app copies /intl-fr/ links, which a naive regex misses.
    assert.deepStrictEqual(parseLink('https://open.spotify.com/intl-fr/track/34prmUEDgxpFbHSszyFqpV?si=8'),
      { kind: 'track', id: '34prmUEDgxpFbHSszyFqpV' });
    assert.deepStrictEqual(parseLink('spotify:album:4m2880jivSbbyEGAKfITCa'),
      { kind: 'album', id: '4m2880jivSbbyEGAKfITCa' });
    assert.strictEqual(parseLink('https://youtube.com/watch?v=x'), null);
    assert.strictEqual(parseLink(''), null);
  });

  await test('an album reads without touching the forbidden batch endpoint', async () => {
    const stub = stubFetch((url) => (url.includes('/api/token') ? { body: TOKEN } : { body: ALBUM }));
    try {
      const sp = new SpotifyClient({ clientId: 'a', clientSecret: 'b', market: 'FR' });
      const album = await sp.album('abc');
      assert.strictEqual(album.name, 'Random Access Memories');
      assert.strictEqual(album.tracks.length, 2);
      assert.strictEqual(album.tracks[0].title, 'Give Life Back to Music');
      assert.strictEqual(album.tracks[0].isrc, 'X1');
      // Multiple artists are joined so the search query keeps both names.
      assert.strictEqual(album.tracks[1].author, 'Daft Punk, Panda Bear');
      assert.ok(album.tracks[0].artworkUrl, 'artwork comes from the album, not a per-track lookup');
      // The 403 that breaks LavaSrc.
      assert.ok(!stub.calls.some((u) => /\/tracks\?ids=/.test(u)),
        `must not call the batch endpoint: ${stub.calls.join(' ')}`);
      assert.ok(stub.calls.some((u) => u.includes('market=FR')), 'market should be passed');
    } finally { stub.restore(); }
  });

  await test('an album longer than one page is paged in', async () => {
    const first = { ...ALBUM, tracks: { total: 3, items: ALBUM.tracks.items } };
    const stub = stubFetch((url) => {
      if (url.includes('/api/token')) return { body: TOKEN };
      if (url.includes('/tracks?limit=')) {
        return { body: { items: [{ name: 'Contact', artists: [{ name: 'Daft Punk' }], duration_ms: 382000 }] } };
      }
      return { body: first };
    });
    try {
      const sp = new SpotifyClient({ clientId: 'a', clientSecret: 'b' });
      const album = await sp.album('abc');
      assert.strictEqual(album.tracks.length, 3, 'should have paged in the third track');
      assert.strictEqual(album.tracks[2].title, 'Contact');
    } finally { stub.restore(); }
  });

  await test('a short page stops the loop instead of spinning forever', async () => {
    // total lies about there being more; an empty page must end it.
    const lying = { ...ALBUM, tracks: { total: 999, items: ALBUM.tracks.items } };
    const stub = stubFetch((url) => {
      if (url.includes('/api/token')) return { body: TOKEN };
      if (url.includes('/tracks?limit=')) return { body: { items: [] } };
      return { body: lying };
    });
    try {
      const sp = new SpotifyClient({ clientId: 'a', clientSecret: 'b' });
      const album = await sp.album('abc');
      assert.strictEqual(album.tracks.length, 2);
    } finally { stub.restore(); }
  });

  await test('the token is cached, and dropped when Spotify rejects it', async () => {
    let tokenCalls = 0;
    const stub = stubFetch((url) => {
      if (url.includes('/api/token')) { tokenCalls += 1; return { body: TOKEN }; }
      return { body: ALBUM };
    });
    try {
      const sp = new SpotifyClient({ clientId: 'a', clientSecret: 'b' });
      await sp.album('abc');
      await sp.album('abc');
      assert.strictEqual(tokenCalls, 1, 'token should be reused across calls');
    } finally { stub.restore(); }

    const stub2 = stubFetch((url) => (url.includes('/api/token')
      ? { body: TOKEN }
      : { status: 401, body: { error: { status: 401 } } }));
    try {
      const sp = new SpotifyClient({ clientId: 'a', clientSecret: 'b' });
      await assert.rejects(() => sp.album('abc'), /401/);
      assert.strictEqual(sp._token, null, 'a 401 must clear the cached token');
    } finally { stub2.restore(); }
  });

  await test('a playlist is read from the public embed widget', async () => {
    // Spotify's Web API refuses playlist contents outright, but the embed the
    // web player serves to anonymous browsers carries the whole track list.
    const { readEmbed } = require('../src/lib/spotify');
    const page = (entity) => `<html><head></head><body>`
      + `<script id="__NEXT_DATA__" type="application/json">`
      + JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })
      + `</script></body></html>`;

    const entity = {
      name: 'ABAT∑RA',
      coverArt: { sources: [{ url: 'https://i.scdn.co/image/abc' }] },
      trackList: [
        { title: 'PILLAVE', subtitle: 'Shaw', duration: 153041, uri: 'spotify:track:6oAXsyL0b1vm5G43jcfNa6' },
        { title: 'FOTO', subtitle: 'Lvbel C5, ElGrandeToto, AKDO', duration: 130285, uri: 'spotify:track:68MyQ74n2P9F20sF0ojgVC' },
        { title: '', subtitle: 'nobody', duration: 1000, uri: 'spotify:track:zzz' },
      ],
    };
    const fetchImpl = async () => ({ ok: true, text: async () => page(entity) });

    const res = await readEmbed('playlist', 'abc', { fetchImpl });
    assert.strictEqual(res.name, 'ABAT∑RA');
    assert.strictEqual(res.tracks.length, 2, 'a title-less entry is dropped');
    assert.strictEqual(res.tracks[0].title, 'PILLAVE');
    assert.strictEqual(res.tracks[0].author, 'Shaw');
    assert.strictEqual(res.tracks[0].duration, 153041);
    // The uri must become a real link, not stay a spotify: uri.
    assert.strictEqual(res.tracks[0].url, 'https://open.spotify.com/track/6oAXsyL0b1vm5G43jcfNa6');
    assert.strictEqual(res.tracks[1].author, 'Lvbel C5, ElGrandeToto, AKDO');
    assert.strictEqual(res.artworkUrl, 'https://i.scdn.co/image/abc');
    assert.strictEqual(res.truncated, false);
  });

  await test('the 100-track embed cap is reported, not hidden', async () => {
    const { readEmbed, EMBED_MAX } = require('../src/lib/spotify');
    const entity = {
      name: 'Long one',
      trackList: Array.from({ length: EMBED_MAX }, (_, i) => ({
        title: `T${i}`, subtitle: 'A', duration: 1000, uri: `spotify:track:x${i}`,
      })),
    };
    const fetchImpl = async () => ({
      ok: true,
      text: async () => `<script id="__NEXT_DATA__" type="application/json">`
        + JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })
        + `</script>`,
    });
    const res = await readEmbed('playlist', 'abc', { fetchImpl });
    assert.strictEqual(res.tracks.length, EMBED_MAX);
    assert.strictEqual(res.truncated, true, 'the caller needs to know the list was clipped');
  });

  await test('a broken embed returns null so the caller can fall back', async () => {
    const { readEmbed } = require('../src/lib/spotify');
    const cases = [
      ['http error', async () => ({ ok: false, status: 404, text: async () => '' })],
      ['no __NEXT_DATA__', async () => ({ ok: true, text: async () => '<html>nope</html>' })],
      ['malformed json', async () => ({ ok: true, text: async () => '<script id="__NEXT_DATA__" type="application/json">{oops</script>' })],
      ['no entity', async () => ({ ok: true, text: async () => '<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>' })],
      ['empty track list', async () => ({ ok: true, text: async () => '<script id="__NEXT_DATA__" type="application/json">'
        + JSON.stringify({ props: { pageProps: { state: { data: { entity: { name: 'x', trackList: [] } } } } } }) + '</script>' })],
      ['network throw', async () => { throw new Error('offline'); }],
    ];
    for (const [label, fetchImpl] of cases) {
      assert.strictEqual(await readEmbed('playlist', 'x', { fetchImpl }), null, label);
    }
  });

  await test('no credentials means the album path stays switched off', () => {
    assert.strictEqual(new SpotifyClient({}).enabled(), false);
    assert.strictEqual(new SpotifyClient({ clientId: 'a' }).enabled(), false);
    assert.strictEqual(new SpotifyClient({ clientId: 'a', clientSecret: 'b' }).enabled(), true);
  });

  console.log(lines.splice(0).join('\n'));
  console.log('\nSPOTIFY LINK DIAGNOSTICS');

  const linkhelp = require('../src/lib/linkhelp');

  await test('an unreadable playlist points at the likely cause', () => {
    // Playlists resolve through the embed now, so reaching this message means
    // the link itself could not be read - most often a private playlist.
    const why = linkhelp.describeFailure(
      'https://open.spotify.com/playlist/37i9dQZF1E37SJ9QrLTfR0?si=62da35f32cfa43be');
    assert.ok(why, 'should explain the failure');
    assert.match(why, /private/i);
    assert.ok(!/no results/i.test(why), 'must not claim there were no results');
  });

  await test('the country-prefixed link format is recognised', () => {
    // Spotify hands out /intl-fr/ links from the app; missing that prefix would
    // silently fall back to the wrong message.
    const why = linkhelp.describeFailure('https://open.spotify.com/intl-fr/playlist/37i9dQZF1E37SJ9QrLTfR0');
    assert.ok(why);
    assert.match(why, /playlist/i);
    assert.ok(linkhelp.describeFailure('spotify:album:4m2880jivSbbyEGAKfITCa'), 'uri form too');
  });

  await test('albums and artists each get their own message', () => {
    assert.match(linkhelp.describeFailure('https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa'), /album/i);
    assert.match(linkhelp.describeFailure('https://open.spotify.com/artist/4tZwfgrHOc3mvqYlEYSvVi'), /Artist links/i);
  });

  await test('anything else falls through to the normal message', () => {
    for (const q of ['never gonna give you up', 'https://youtube.com/watch?v=x',
      'https://open.spotify.com/track/0DiWol3AO6WpXZgp0goxAV', '', null]) {
      assert.strictEqual(linkhelp.describeFailure(q), null, `should not explain: ${q}`);
    }
  });

  console.log(lines.splice(0).join('\n'));
  console.log('\nPRESENCE');

  const presence = require('../src/lib/presence');
  const { ActivityType } = require('discord.js');

  await test('the listening line is built as Discord expects', () => {
    const p = presence.buildPresence({ presence: { text: 'CHAOS - JEAN', type: 'listening' } });
    assert.strictEqual(p.activities.length, 1);
    assert.strictEqual(p.activities[0].name, 'CHAOS - JEAN');
    assert.strictEqual(p.activities[0].type, ActivityType.Listening);
    assert.strictEqual(p.status, 'online');
  });

  await test('a custom status carries its text in state, not name', () => {
    // Discord ignores `name` for custom activities and renders `state`; putting
    // the text in `name` shows nothing at all.
    const p = presence.buildPresence({ presence: { text: 'CHAOS - JEAN', type: 'custom', status: 'dnd' } });
    assert.strictEqual(p.activities[0].type, ActivityType.Custom);
    assert.strictEqual(p.activities[0].state, 'CHAOS - JEAN');
    assert.strictEqual(p.activities[0].name, 'Custom Status');
    assert.strictEqual(p.status, 'dnd');
  });

  await test('an unknown activity type falls back instead of breaking login', () => {
    for (const t of ['nonsense', '', undefined, null, 42]) {
      assert.strictEqual(
        presence.buildPresence({ presence: { text: 'x', type: t } }).activities[0].type,
        ActivityType.Listening, `type ${t}`);
    }
    assert.strictEqual(presence.activityType('WATCHING'), ActivityType.Watching);
    assert.strictEqual(presence.activityType(' Playing '), ActivityType.Playing);
  });

  await test('blank text leaves the presence alone rather than clearing it', () => {
    for (const text of ['', '   ', undefined, null]) {
      assert.strictEqual(presence.buildPresence({ presence: { text } }), null, `text ${text}`);
    }
    assert.strictEqual(presence.buildPresence({}), null);
    assert.strictEqual(presence.buildPresence(undefined), null);
  });

  await test('an over-long line is trimmed to what Discord accepts', () => {
    const p = presence.buildPresence({ presence: { text: 'z'.repeat(500) } });
    assert.strictEqual(p.activities[0].name.length, presence.MAX_NAME);
  });

  console.log(lines.splice(0).join('\n'));
  console.log('\nCOMMAND NAMESPACE');

  const ns = require('../src/lib/namespace');
  const allCommands = fs.readdirSync(path.join(__dirname, '..', 'src', 'commands'))
    .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
    .map((f) => require(path.join(__dirname, '..', 'src', 'commands', f)));

  await test('every command folds into one branded command', () => {
    const built = ns.buildNamespacedCommand(allCommands, { name: 'homer', description: 'Music' });
    assert.strictEqual(built.name, 'homer');
    assert.strictEqual(built.options.length, allCommands.length,
      'every command must appear exactly once');
    // Discord rejects anything past this and the API error does not say so.
    assert.ok(built.options.length <= ns.MAX_OPTIONS,
      `${built.options.length} exceeds Discord's ${ns.MAX_OPTIONS}-option limit`);
    const names = built.options.map((o) => o.name);
    assert.strictEqual(new Set(names).size, names.length, 'duplicate subcommand name');
    for (const n of names) assert.ok(ns.NAME_RE.test(n), `invalid subcommand name: ${n}`);
  });

  await test('commands that already nest become groups, not subcommands', () => {
    const built = ns.buildNamespacedCommand(allCommands, { name: 'homer', description: 'Music' });
    const byName = Object.fromEntries(built.options.map((o) => [o.name, o]));
    // Discord allows command -> group -> subcommand and no deeper, so /playlist
    // and /dj must arrive as groups or registration is rejected.
    for (const g of ['playlist', 'dj']) {
      assert.strictEqual(byName[g].type, 2, `${g} should be a subcommand group`);
      assert.ok(byName[g].options.length > 0);
      for (const sub of byName[g].options) {
        assert.strictEqual(sub.type, 1, `${g} ${sub.name} should be a subcommand`);
        assert.ok(!(sub.options || []).some((o) => o.type === 1 || o.type === 2),
          'nesting deeper than group -> subcommand is not allowed');
      }
    }
    assert.strictEqual(byName.play.type, 1, 'play should be a plain subcommand');
    assert.ok(byName.play.options.some((o) => o.name === 'query'), 'play keeps its query option');
  });

  await test('too many commands fails at build time, not at registration', () => {
    const many = Array.from({ length: ns.MAX_OPTIONS + 1 }, (_, i) => ({
      data: { toJSON: () => ({ name: `c${i}`, description: 'x', options: [] }) },
    }));
    assert.throws(() => ns.buildNamespacedCommand(many, { name: 'homer', description: 'M' }),
      /limit of 25/);
    assert.throws(() => ns.buildNamespacedCommand([], { name: 'Not Valid', description: 'M' }),
      /not a valid command name/);
  });

  await test('an interaction resolves to the module that owns it', () => {
    const fake = (name, group, sub) => ({
      commandName: name,
      options: { getSubcommandGroup: () => group, getSubcommand: () => sub },
    });
    // /homer play -> the play module
    assert.strictEqual(ns.resolveCommandName(fake('homer', null, 'play'), 'homer'), 'play');
    // /homer playlist save -> the playlist module, which still reads "save"
    assert.strictEqual(ns.resolveCommandName(fake('homer', 'playlist', 'save'), 'homer'), 'playlist');
    assert.strictEqual(ns.resolveCommandName(fake('homer', 'dj', 'role'), 'homer'), 'dj');
    // With the namespace off, the command name is used directly.
    assert.strictEqual(ns.resolveCommandName(fake('play', null, null), ''), 'play');
    // A stray command that is not ours must not be swallowed.
    assert.strictEqual(ns.resolveCommandName(fake('other', null, null), 'homer'), 'other');
  });

  await test('help text and hints follow the configured namespace', () => {
    assert.strictEqual(ns.commandPath({ commandNamespace: 'homer' }, 'play'), '/homer play');
    assert.strictEqual(ns.commandPath({ commandNamespace: 'homer' }, 'playlist save'), '/homer playlist save');
    assert.strictEqual(ns.commandPath({ commandNamespace: '' }, 'play'), '/play');
    assert.strictEqual(ns.commandPath({}, 'play'), '/play');
  });

  console.log(lines.splice(0).join('\n'));
  console.log('\nYOUTUBE VIA YT-DLP');

  const { YoutubeAudioCache } = require('../src/lib/ytdlp');
  const ytserve = require('../src/lib/ytserve');

  await test('a YouTube video id is recovered from id or url', () => {
    const yt = (over) => makeTrack('T', { sourceName: 'youtube', ...over });
    assert.strictEqual(YoutubeAudioCache.videoId(yt({ identifier: 'dQw4w9WgXcQ' })), 'dQw4w9WgXcQ');
    assert.strictEqual(YoutubeAudioCache.videoId(
      yt({ identifier: '', uri: 'https://www.youtube.com/watch?v=eBNWq-bYxWg' })), 'eBNWq-bYxWg');
    assert.strictEqual(YoutubeAudioCache.videoId(
      yt({ identifier: '', uri: 'https://youtu.be/FGBhQbmPwH8' })), 'FGBhQbmPwH8');
    // Non-YouTube tracks must not be routed through yt-dlp.
    assert.strictEqual(YoutubeAudioCache.videoId(
      makeTrack('T', { sourceName: 'soundcloud', identifier: 'dQw4w9WgXcQ' })), null);
    // A junk identifier must not become a shell argument.
    assert.strictEqual(YoutubeAudioCache.videoId(
      yt({ identifier: '../../etc/passwd', uri: 'https://x/y' })), null);
  });

  await test('the cache server only serves plain cache filenames', () => {
    const ok = ['dQw4w9WgXcQ.m4a', 'eBNWq-bYxWg.webm', 'FGBhQbmPwH8.mp4'];
    for (const n of ok) assert.ok(ytserve.NAME_RE.test(n), `should allow ${n}`);
    const bad = [
      '../../../etc/passwd', '..%2Fsecret', 'guilds.json', '.env',
      'dQw4w9WgXcQ', 'dQw4w9WgXcQ.m4a.part', 'sub/dir/file.m4a', '',
    ];
    for (const n of bad) assert.ok(!ytserve.NAME_RE.test(n), `should reject ${n}`);
  });

  await test('Range headers are parsed the way a seeking player sends them', () => {
    const size = 1000;
    assert.deepStrictEqual(ytserve.parseRange('bytes=0-499', size), { start: 0, end: 499 });
    // Open-ended: play from an offset to the end.
    assert.deepStrictEqual(ytserve.parseRange('bytes=500-', size), { start: 500, end: 999 });
    // Suffix form: the last N bytes.
    assert.deepStrictEqual(ytserve.parseRange('bytes=-200', size), { start: 800, end: 999 });
    // An end past EOF is clamped rather than rejected.
    assert.deepStrictEqual(ytserve.parseRange('bytes=900-99999', size), { start: 900, end: 999 });
    // Nonsense must fall through to a normal 200 response, not a bad 206.
    for (const bad of ['', 'bytes=', 'bytes=-', 'items=0-10', 'bytes=abc-def',
      'bytes=500-100', `bytes=${size}-`, null, undefined]) {
      assert.strictEqual(ytserve.parseRange(bad, size), null, `should reject ${bad}`);
    }
  });

  await test('the cache is disabled cleanly when yt-dlp is not installed', () => {
    assert.strictEqual(new YoutubeAudioCache({}).available(), false);
    assert.strictEqual(
      new YoutubeAudioCache({ bin: '/nonexistent/yt-dlp', dir: tmp }).available(), false);
  });

  console.log(lines.splice(0).join('\n'));
  console.log('\nPERMISSIONS');

  await test('with no DJ role, anyone in the voice channel can control', () => {
    const i = makeInteraction();
    assert.strictEqual(checkControl(i, makePlayer([makeTrack('A')]), { djRoleId: null }), null);
  });

  await test('with a DJ role, a non-DJ is refused', () => {
    const i = makeInteraction();
    const denied = checkControl(i, makePlayer([makeTrack('A')]), { djRoleId: 'dj1' });
    assert.match(denied, /Only <@&dj1>/);
  });

  await test('a DJ passes the same check', () => {
    const i = makeInteraction({ roles: ['dj1'] });
    assert.strictEqual(checkControl(i, makePlayer([makeTrack('A')]), { djRoleId: 'dj1' }), null);
  });

  await test('Manage Server always overrides the DJ role', () => {
    const i = makeInteraction({ manageGuild: true });
    assert.strictEqual(isDj(i, { djRoleId: 'dj1' }), true);
  });

  await test('someone in a different voice channel is refused', () => {
    const i = makeInteraction({ inVoice: 'other' });
    const denied = checkControl(i, makePlayer([makeTrack('A')]), {});
    assert.match(denied, /You need to be in/);
  });

  await test('someone in no voice channel is refused first', () => {
    const i = makeInteraction({ inVoice: null });
    assert.match(checkControl(i, makePlayer([makeTrack('A')]), {}), /Join a voice channel/);
  });

  console.log(lines.splice(0).join('\n'));
  console.log('\nSTORE');

  await test('guild settings default sensibly and persist', () => {
    const f = path.join(tmp, 'g.json');
    const s1 = new Store(f);
    const g = s1.guild('g1');
    assert.strictEqual(g.djRoleId, null);
    assert.strictEqual(g.announceTracks, true);
    s1.setGuild('g1', { djRoleId: 'dj1', twentyFourSeven: true });
    s1.flush();
    const s2 = new Store(f);
    assert.strictEqual(s2.guild('g1').djRoleId, 'dj1');
    assert.strictEqual(s2.guild('g1').twentyFourSeven, true);
  });

  await test('playlists save, list, reload and delete per user', () => {
    const f = path.join(tmp, 'p.json');
    const s1 = new Store(f);
    s1.savePlaylist('u1', 'Chill', [{ info: { title: 'A' } }]);
    s1.savePlaylist('u2', 'Chill', [{ info: { title: 'B' } }]);
    s1.flush();
    const s2 = new Store(f);
    assert.strictEqual(s2.listPlaylists('u1').length, 1);
    assert.strictEqual(s2.getPlaylist('u2', 'chill').tracks[0].info.title, 'B', 'lookup should be case-insensitive');
    assert.strictEqual(s2.deletePlaylist('u1', 'Chill'), true);
    assert.strictEqual(s2.getPlaylist('u1', 'Chill'), null);
  });

  console.log(lines.splice(0).join('\n'));
  console.log('\nCOMMANDS');

  const store = new Store(config.dataFile);
  const player = makePlayer([makeTrack('Current'), makeTrack('Next'), makeTrack('Third')]);
  const client = { lavalink: { getPlayer: () => player, createPlayer: () => player }, config, store };
  const ctx = { client, config, store };

  await test('/play queues a search result and reports its position', async () => {
    const i = makeInteraction({ options: { query: 'some song' } });
    await cmd('play.js').execute(i, ctx);
    // Assert on what the user is told, not on the wording, so the embed can be
    // restyled without breaking the test.
    const reply = text(i);
    assert.match(reply, /Result for some song/, `title missing: ${reply}`);
    assert.match(reply, /#3/, `queue position missing: ${reply}`);
    assert.strictEqual(player.queue.tracks.length, 3);
  });

  await test('/play handles a playlist load', async () => {
    const i = makeInteraction({ options: { query: 'a playlist' } });
    await cmd('play.js').execute(i, ctx);
    assert.match(text(i), /Test Playlist/);
  });

  await test('/play reports no results instead of failing silently', async () => {
    const i = makeInteraction({ options: { query: 'nothing at all' } });
    await cmd('play.js').execute(i, ctx);
    assert.match(text(i), /No results/);
  });

  await test('/play refuses when the user is not in voice', async () => {
    const i = makeInteraction({ inVoice: null, options: { query: 'x' } });
    await cmd('play.js').execute(i, ctx);
    assert.match(text(i), /Join a voice channel/);
  });

  await test('/seek rejects a position past the end of the track', async () => {
    const i = makeInteraction({ options: { position: '99:00' } });
    await cmd('seek.js').execute(i, ctx);
    assert.match(text(i), /past the end/);
  });

  await test('/seek rejects unparseable input', async () => {
    const i = makeInteraction({ options: { position: 'later' } });
    await cmd('seek.js').execute(i, ctx);
    assert.match(text(i), /Could not read that time/);
  });

  await test('/seek refuses on a live stream', async () => {
    const streamPlayer = makePlayer([makeTrack('Radio', { isStream: true })]);
    const i = makeInteraction({ options: { position: '0:30' } });
    await cmd('seek.js').execute(i, { ...ctx, client: { ...client, lavalink: { getPlayer: () => streamPlayer } } });
    assert.match(text(i), /cannot seek in a live stream/i);
  });

  await test('/seek works with a valid position', async () => {
    const i = makeInteraction({ options: { position: '1:30' } });
    await cmd('seek.js').execute(i, ctx);
    assert.strictEqual(player.position, 90000);
  });

  await test('/volume enforces the configured maximum', async () => {
    const i = makeInteraction({ options: { percent: 500 } });
    await cmd('volume.js').execute(i, ctx);
    assert.match(text(i), /Max volume/);
    assert.strictEqual(player.volume, 80, 'volume must not change on a rejected value');
  });

  await test('/volume warns above 100 but still applies it', async () => {
    const i = makeInteraction({ options: { percent: 150 } });
    await cmd('volume.js').execute(i, ctx);
    assert.strictEqual(player.volume, 150);
    assert.match(text(i), /distort/);
  });

  await test('/remove rejects a position beyond the queue', async () => {
    const i = makeInteraction({ options: { position: 999 } });
    await cmd('remove.js').execute(i, ctx);
    assert.match(text(i), /only/i);
  });

  await test('/move rejects moving a track onto itself', async () => {
    const i = makeInteraction({ options: { from: 1, to: 1 } });
    await cmd('move.js').execute(i, ctx);
    assert.match(text(i), /already there/);
  });

  await test('/move reorders the queue', async () => {
    const before = player.queue.tracks[0].info.title;
    const i = makeInteraction({ options: { from: 1, to: 2 } });
    await cmd('move.js').execute(i, ctx);
    assert.strictEqual(player.queue.tracks[1].info.title, before);
  });

  await test('/shuffle refuses with fewer than two tracks', async () => {
    const small = makePlayer([makeTrack('Only')]);
    const i = makeInteraction();
    await cmd('shuffle.js').execute(i, { ...ctx, client: { ...client, lavalink: { getPlayer: () => small } } });
    assert.match(text(i), /at least 2/);
  });

  await test('/loop sets the mode on the player', async () => {
    const i = makeInteraction({ options: { mode: 'queue' } });
    await cmd('loop.js').execute(i, ctx);
    assert.strictEqual(player.repeatMode, 'queue');
  });

  await test('/pause then /resume toggles cleanly and refuses double-pause', async () => {
    const a = makeInteraction();
    await cmd('pause.js').execute(a, ctx);
    assert.strictEqual(player.paused, true);
    const b = makeInteraction();
    await cmd('pause.js').execute(b, ctx);
    assert.match(text(b), /Already paused/);
    const c = makeInteraction();
    await cmd('resume.js').execute(c, ctx);
    assert.strictEqual(player.paused, false);
  });

  await test('/filter applies a supported filter', async () => {
    const i = makeInteraction({ options: { name: 'bassboost' } });
    await cmd('filter.js').execute(i, ctx);
    assert.ok(player.filterManager.applied.includes('bass'));
  });

  await test('/filter explains itself when a filter is unsupported', async () => {
    const i = makeInteraction({ options: { name: 'karaoke' } });
    await cmd('filter.js').execute(i, ctx);
    assert.match(text(i), /not supported/);
  });

  await test('/filter reset clears everything', async () => {
    const i = makeInteraction({ options: { name: 'reset' } });
    await cmd('filter.js').execute(i, ctx);
    assert.strictEqual(player.filterManager.applied.length, 0);
  });

  await test('/247 persists across a store reload', async () => {
    const i = makeInteraction({ manageGuild: true, options: { enabled: true } });
    await cmd('247.js').execute(i, ctx);
    assert.strictEqual(new Store(config.dataFile).guild('g1').twentyFourSeven, true);
    store.setGuild('g1', { twentyFourSeven: false });
    store.flush();
  });

  await test('/dj role gates control for everyone else', async () => {
    const i = makeInteraction({ manageGuild: true, options: { __sub: 'role', role: { id: 'dj9', toString: () => '<@&dj9>' } } });
    await cmd('dj.js').execute(i, ctx);
    assert.strictEqual(store.guild('g1').djRoleId, 'dj9');
    const outsider = makeInteraction({ userId: 'u5' });
    assert.match(checkControl(outsider, player, store.guild('g1')), /Only <@&dj9>/);
    store.setGuild('g1', { djRoleId: null });
  });

  await test('/playlist save then play round-trips the queue', async () => {
    const save = makeInteraction({ options: { __sub: 'save', name: 'MySet' } });
    await cmd('playlist.js').execute(save, ctx);
    assert.match(text(save), /Saved/);
    assert.ok(store.getPlaylist('u1', 'myset').tracks.length > 0);

    const play = makeInteraction({ options: { __sub: 'play', name: 'MySet' } });
    await cmd('playlist.js').execute(play, ctx);
    assert.match(text(play), /Queued/);
  });

  await test('/playlist play on a missing playlist says so', async () => {
    const i = makeInteraction({ options: { __sub: 'play', name: 'ghost' } });
    await cmd('playlist.js').execute(i, ctx);
    assert.match(text(i), /no playlist called/i);
  });

  await test('/playlist autocomplete only offers your own playlists', async () => {
    const i = makeInteraction({ userId: 'u1', options: { __sub: 'play', __focused: 'my' } });
    await cmd('playlist.js').autocomplete(i, ctx);
    const choices = i.captured.at(-1);
    assert.ok(choices.some((c) => c.value === 'MySet'));
    const other = makeInteraction({ userId: 'u2', options: { __focused: '' } });
    await cmd('playlist.js').autocomplete(other, ctx);
    assert.strictEqual(other.captured.at(-1).length, 0);
  });

  await test('/playlist delete removes it', async () => {
    const i = makeInteraction({ options: { __sub: 'delete', name: 'MySet' } });
    await cmd('playlist.js').execute(i, ctx);
    assert.strictEqual(store.getPlaylist('u1', 'MySet'), null);
  });

  console.log(lines.splice(0).join('\n'));
  console.log('\nBUTTON CONTROLS');

  const btnClient = {
    lavalink: { getPlayer: () => player }, config, store,
    commands: new Map(),
  };
  const pressButton = async (customId, over = {}) => {
    const i = makeInteraction(over);
    i.isButton = () => true;
    i.customId = customId;
    await handleInteraction(btnClient, i);
    return i;
  };

  await test('pause button toggles play state', async () => {
    player.paused = false;
    await pressButton('music:pause');
    assert.strictEqual(player.paused, true);
    await pressButton('music:pause');
    assert.strictEqual(player.paused, false);
  });

  await test('loop button cycles off -> track -> queue -> off', async () => {
    player.repeatMode = 'off';
    await pressButton('music:loop');
    assert.strictEqual(player.repeatMode, 'track');
    await pressButton('music:loop');
    assert.strictEqual(player.repeatMode, 'queue');
    await pressButton('music:loop');
    assert.strictEqual(player.repeatMode, 'off');
  });

  await test('volume buttons clamp at 0 and the configured max', async () => {
    player.volume = 5;
    await pressButton('music:voldown');
    assert.strictEqual(player.volume, 0);
    player.volume = config.player.maxVolume - 5;
    await pressButton('music:volup');
    assert.strictEqual(player.volume, config.player.maxVolume);
  });

  await test('buttons respect the DJ role', async () => {
    store.setGuild('g1', { djRoleId: 'dj9' });
    const i = await pressButton('music:skip', { userId: 'u7' });
    assert.match(text(i), /Only <@&dj9>/);
    store.setGuild('g1', { djRoleId: null });
  });

  await test('like button saves to the liked playlist without duplicating', async () => {
    player.queue.current = makeTrack('Favourite');
    await pressButton('music:like');
    assert.strictEqual(store.getPlaylist('u1', 'liked').tracks.length, 1);
    const again = await pressButton('music:like');
    assert.match(text(again), /Already in your/);
    assert.strictEqual(store.getPlaylist('u1', 'liked').tracks.length, 1);
  });

  await test('buttons on a dead player do not throw', async () => {
    const deadClient = { lavalink: { getPlayer: () => null }, config, store, commands: new Map() };
    const i = makeInteraction();
    i.isButton = () => true; i.customId = 'music:skip';
    await handleInteraction(deadClient, i);
    assert.match(text(i), /Nothing is playing/);
  });

  console.log(lines.splice(0).join('\n'));
  console.log(`\n${passed} passed${process.exitCode ? ' -- SOME FAILED' : ''}\n`);
  fs.rmSync(tmp, { recursive: true, force: true });
})();
