'use strict';

/**
 * Reads Spotify album metadata directly, because LavaSrc cannot.
 *
 * Spotify restricted its Web API for applications created after 2024-11-27.
 * Measured against a current app with valid client credentials:
 *
 *   albums/{id}                200, every track embedded
 *   albums/{id}/tracks         200
 *   tracks?ids=  (batch)       403 Forbidden
 *   playlists/{id}/items       401 Valid user authentication required
 *
 * LavaSrc loads the album, then calls the batch endpoint to fill in artwork,
 * hits the 403, and the whole album fails - even though everything it needs
 * was already in the first response. Reading the album ourselves and skipping
 * the batch call makes album links work again.
 *
 * Playlists are genuinely impossible here: the track list is stripped from the
 * playlist object and /items demands a user login, so there is nothing to read.
 * That needs user-level auth, not a different endpoint.
 */

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

// Spotify caps this page size at 50.
const PAGE = 50;

/** open.spotify.com/album/ID, /intl-fr/album/ID, and spotify:album:ID. */
const LINK = /(?:open\.spotify\.com\/(?:intl-[a-z]{2}\/)?|spotify:)(track|album|playlist|artist)[/:]([A-Za-z0-9]{16,})/i;

function parseLink(input) {
  const m = String(input || '').match(LINK);
  return m ? { kind: m[1].toLowerCase(), id: m[2] } : null;
}

class SpotifyClient {
  constructor({ clientId, clientSecret, market = 'US', timeoutMs = 10000 } = {}) {
    this.clientId = clientId || '';
    this.clientSecret = clientSecret || '';
    this.market = market;
    this.timeoutMs = timeoutMs;
    this._token = null;
    this._expiresAt = 0;
    this._inflight = null;
  }

  enabled() {
    return Boolean(this.clientId && this.clientSecret);
  }

  /** Cached client-credentials token. Concurrent callers share one request. */
  async token() {
    if (this._token && Date.now() < this._expiresAt) return this._token;
    if (this._inflight) return this._inflight;

    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    this._inflight = (async () => {
      const res = await this._fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      if (!res.ok) throw new Error(`Spotify token request failed (${res.status})`);
      const body = await res.json();
      this._token = body.access_token;
      // Renew a minute early so a request never races the expiry.
      this._expiresAt = Date.now() + Math.max(0, (body.expires_in || 3600) - 60) * 1000;
      return this._token;
    })().finally(() => { this._inflight = null; });

    return this._inflight;
  }

  async _fetch(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async _get(path) {
    const token = await this.token();
    const res = await this._fetch(`${API}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      // Token may have been revoked early; drop it so the next call re-fetches.
      this._token = null;
      this._expiresAt = 0;
    }
    if (!res.ok) {
      const err = new Error(`Spotify ${res.status} on ${path.split('?')[0]}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  /**
   * Album as { name, artist, artworkUrl, url, tracks: [{ title, author,
   * duration, isrc, url }] }, or null when it cannot be read.
   */
  async album(id) {
    const album = await this._get(`albums/${encodeURIComponent(id)}?market=${encodeURIComponent(this.market)}`);
    const albumArtist = (album.artists || []).map((a) => a.name).filter(Boolean).join(', ');
    const artwork = (album.images || [])[0]?.url || null;

    const page = album.tracks || {};
    let items = Array.isArray(page.items) ? page.items.slice() : [];
    const total = Number.isFinite(page.total) ? page.total : items.length;

    // The album object embeds the first 50; page the rest in.
    for (let offset = items.length; offset < total; offset += PAGE) {
      const next = await this._get(
        `albums/${encodeURIComponent(id)}/tracks?limit=${PAGE}&offset=${offset}`
        + `&market=${encodeURIComponent(this.market)}`,
      );
      const batch = Array.isArray(next.items) ? next.items : [];
      if (!batch.length) break; // defensive: never loop forever on a short page
      items = items.concat(batch);
    }

    const tracks = items.filter(Boolean).map((t) => ({
      title: t.name,
      author: (t.artists || []).map((a) => a.name).filter(Boolean).join(', ') || albumArtist,
      duration: Number(t.duration_ms) || 0,
      isrc: t.external_ids?.isrc || undefined,
      url: t.external_urls?.spotify || undefined,
      artworkUrl: artwork || undefined,
    })).filter((t) => t.title);

    if (!tracks.length) return null;
    return {
      name: album.name || 'Album',
      artist: albumArtist,
      artworkUrl: artwork,
      url: album.external_urls?.spotify || undefined,
      tracks,
    };
  }
}

module.exports = { SpotifyClient, parseLink, LINK };
