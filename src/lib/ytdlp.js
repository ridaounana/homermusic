'use strict';
const { execFile } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

/**
 * Fetches YouTube audio with yt-dlp and caches it on disk.
 *
 * Why this exists: Lavalink's youtube-source plugin resolves a track fine and
 * then fails to fetch the bytes. Every one of its clients is refused - bot
 * detection ("Sign in to confirm you're not a bot"), SABR-only formats, or a
 * cipher it cannot extract from the player JS.
 *
 * Handing Lavalink the direct googlevideo URL does not work either. Those URLs
 * reject a plain GET (403) and only answer a *bounded* Range; the first chunk
 * succeeds and every later offset is refused, because the rest of the stream is
 * meant to be fetched over YouTube's SABR protocol. LavaPlayer speaks neither.
 *
 * yt-dlp does speak it, so it fetches the audio and we hand Lavalink an
 * ordinary local file instead - which it plays with full seek support.
 *
 * Two details decide whether this works at all:
 *   - yt-dlp needs a JS runtime it recognises as current to solve the
 *     signature challenge. It will not pick one up from PATH: without an
 *     explicit --js-runtimes it reports "node (unavailable)" and every
 *     download 403s. That single flag is the difference between working and
 *     not, and its absence looks like an IP ban rather than a config problem.
 *   - the client matters. yt-dlp's automatic choice 403s here and web/tv
 *     answers "The page needs to be reloaded"; ANDROID works every time.
 *     It is usually ranked last because it caps video at ~360p, but this bot
 *     only ever wants audio, so that cost does not apply and it goes first.
 */

// Tried in order. The first that produces bytes wins.
const CLIENTS = ['android', 'web,tv', 'ios'];

// Audio-only. m4a first because it is the most widely probeable container.
const FORMAT = 'bestaudio[acodec^=mp4a]/bestaudio/best';

const ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

function runYtdlp(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr || '').trim().split('\n').slice(-3).join(' ');
        return reject(err);
      }
      resolve(String(stdout || ''));
    });
  });
}

class YoutubeAudioCache {
  constructor(options = {}) {
    this.bin = options.bin;
    this.nodePath = options.nodePath;
    this.dir = options.dir;
    this.maxBytes = options.maxBytes;
    this.timeoutMs = options.timeoutMs || 90000;
    // Two players asking for the same track must not start two downloads.
    this.inFlight = new Map();
  }

  /** Configured and the binary is actually executable. */
  available() {
    if (!this.bin || !this.dir) return false;
    try {
      fs.accessSync(this.bin, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  /** A YouTube video id from a track, or null if this is not a YouTube track. */
  static videoId(track) {
    const info = track?.info || {};
    const source = String(info.sourceName || '').toLowerCase();
    if (!source.includes('youtube')) return null;
    if (ID_RE.test(String(info.identifier || ''))) return String(info.identifier);
    const match = String(info.uri || '').match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{6,20})/);
    return match ? match[1] : null;
  }

  baseArgs() {
    return [
      '--quiet', '--no-warnings', '--no-playlist',
      // Without this yt-dlp silently disables JS-challenge solving and every
      // download 403s. See the note at the top of this file.
      '--js-runtimes', `node:${this.nodePath}`,
      '--remote-components', 'ejs:github',
      '-f', FORMAT,
    ];
  }

  /**
   * Downloads a video's audio into the cache and resolves the filename.
   * Returns null when it cannot be fetched - the caller falls back elsewhere.
   */
  async fetch(videoId) {
    if (!this.available() || !ID_RE.test(String(videoId || ''))) return null;

    const existing = await this.cached(videoId);
    if (existing) {
      // Touch it so the eviction sweep treats it as recently used.
      fsp.utimes(path.join(this.dir, existing), new Date(), new Date()).catch(() => {});
      return existing;
    }

    if (this.inFlight.has(videoId)) return this.inFlight.get(videoId);
    const job = this._download(videoId).finally(() => this.inFlight.delete(videoId));
    this.inFlight.set(videoId, job);
    return job;
  }

  async cached(videoId) {
    try {
      const names = await fsp.readdir(this.dir);
      return names.find((n) => n.startsWith(`${videoId}.`) && !n.endsWith('.part')) || null;
    } catch {
      return null;
    }
  }

  async _download(videoId) {
    await fsp.mkdir(this.dir, { recursive: true });
    const url = `https://www.youtube.com/watch?v=${videoId}`;

    for (const client of CLIENTS) {
      // Download to a scratch name and rename on success, so the file server
      // can never hand Lavalink a half-written file.
      const stem = `${videoId}.tmp-${process.pid}`;
      const args = [
        ...this.baseArgs(),
        '--extractor-args', `youtube:player_client=${client}`,
        '-o', path.join(this.dir, `${stem}.%(ext)s`),
        url,
      ];
      try {
        await runYtdlp(this.bin, args, this.timeoutMs);
      } catch (err) {
        await this._sweepTemp(stem);
        console.warn(`[ytdlp] ${videoId} via ${client} failed: ${err.stderr || err.message}`);
        continue;
      }

      const produced = (await fsp.readdir(this.dir)).find((n) => n.startsWith(`${stem}.`));
      if (!produced) { continue; }

      const finalName = `${videoId}${path.extname(produced)}`;
      try {
        await fsp.rename(path.join(this.dir, produced), path.join(this.dir, finalName));
      } catch {
        await this._sweepTemp(stem);
        continue;
      }
      console.log(`[ytdlp] cached ${videoId} via ${client}`);
      this.evict().catch(() => {});
      return finalName;
    }
    return null;
  }

  async _sweepTemp(stem) {
    try {
      const names = await fsp.readdir(this.dir);
      await Promise.all(names
        .filter((n) => n.startsWith(`${stem}.`))
        .map((n) => fsp.unlink(path.join(this.dir, n)).catch(() => {})));
    } catch { /* nothing to clean */ }
  }

  /** Drops least-recently-used files once the cache exceeds its size budget. */
  async evict() {
    if (!this.maxBytes) return;
    let names;
    try { names = await fsp.readdir(this.dir); } catch { return; }

    const files = [];
    for (const name of names) {
      if (name.includes('.tmp-')) continue;
      try {
        const st = await fsp.stat(path.join(this.dir, name));
        if (st.isFile()) files.push({ name, size: st.size, used: st.mtimeMs });
      } catch { /* vanished between readdir and stat */ }
    }

    let total = files.reduce((sum, f) => sum + f.size, 0);
    if (total <= this.maxBytes) return;

    files.sort((a, b) => a.used - b.used); // oldest first
    for (const file of files) {
      if (total <= this.maxBytes) break;
      try {
        await fsp.unlink(path.join(this.dir, file.name));
        total -= file.size;
        console.log(`[ytdlp] evicted ${file.name}`);
      } catch { /* already gone */ }
    }
  }
}

module.exports = { YoutubeAudioCache, CLIENTS, FORMAT };
