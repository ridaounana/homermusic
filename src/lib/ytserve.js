'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const path = require('path');

/**
 * Serves the yt-dlp audio cache to Lavalink over loopback.
 *
 * Lavalink cannot read the cache off disk - `local: false` in application.yml,
 * and enabling it would let any Lavalink client read arbitrary paths. Handing
 * it an http:// URL keeps the http source doing the work it already does, and
 * this server is the only thing that touches the filesystem.
 *
 * Range support is the point: it is what makes /seek, /replay and the progress
 * bar keep working. A stream without it loads as isSeekable=false.
 *
 * Bound to 127.0.0.1 and it only ever serves a plain filename inside the cache
 * directory - never a path, so a request cannot climb out of it.
 */

// Cache entries are "<videoId>.<audio ext>" and nothing else. The extension is
// an explicit whitelist rather than a generic \w+: a loose pattern also matches
// things like "guilds.json", and the server should not depend on the cache
// directory happening to contain nothing else.
const NAME_RE = /^[A-Za-z0-9_-]{6,20}\.(?:m4a|mp4|webm|opus|ogg|mp3)$/;

const CONTENT_TYPES = {
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.webm': 'audio/webm',
  '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;

  let start;
  let end;
  if (rawStart === '') {
    // Suffix form: "bytes=-500" means the last 500 bytes.
    const len = Number(rawEnd);
    if (!Number.isFinite(len) || len <= 0) return null;
    start = Math.max(0, size - len);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === '' ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

function createCacheServer({ dir, port, host = '127.0.0.1' }) {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405); res.end(); return;
    }

    const name = decodeURIComponent((req.url || '').split('?')[0].replace(/^\/+/, ''));
    // basename strips any traversal attempt before the pattern check.
    if (!NAME_RE.test(path.basename(name)) || path.basename(name) !== name) {
      res.writeHead(404); res.end(); return;
    }

    const file = path.join(dir, name);
    let stat;
    try {
      stat = await fsp.stat(file);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      res.writeHead(404); res.end(); return;
    }

    const type = CONTENT_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream';
    const range = parseRange(req.headers.range, stat.size);

    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes' };
    if (range) {
      headers['Content-Length'] = range.end - range.start + 1;
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
      res.writeHead(206, headers);
    } else {
      headers['Content-Length'] = stat.size;
      res.writeHead(200, headers);
    }

    if (req.method === 'HEAD') { res.end(); return; }

    const stream = fs.createReadStream(file, range ? { start: range.start, end: range.end } : {});
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  });

  server.on('error', (e) => console.error('[ytserve] ' + (e?.message || e)));

  return {
    server,
    listen: () => new Promise((resolve) => server.listen(port, host, () => {
      console.log(`[ytserve] cache server on http://${host}:${port}`);
      resolve();
    })),
    close: () => new Promise((resolve) => server.close(() => resolve())),
    urlFor: (name) => `http://${host}:${port}/${encodeURIComponent(name)}`,
  };
}

module.exports = { createCacheServer, parseRange, NAME_RE };
