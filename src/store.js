'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Per-guild settings and per-user saved playlists.
 * JSON with atomic writes — no database to provision, fine well past the
 * scale a self-hosted music bot ever reaches.
 */
class Store {
  constructor(file) {
    this.file = file;
    this.guilds = new Map();   // guildId -> settings
    this.playlists = new Map(); // `${userId}:${name}` -> { name, ownerId, tracks[] }
    this._dirty = false;
    this._timer = null;
    this._load();
  }

  _load() {
    try {
      if (!fs.existsSync(this.file)) {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        return;
      }
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      for (const g of raw.guilds || []) this.guilds.set(g.guildId, g);
      for (const p of raw.playlists || []) this.playlists.set(`${p.ownerId}:${p.name.toLowerCase()}`, p);
    } catch (err) {
      const backup = `${this.file}.corrupt.${Date.now()}`;
      try { fs.copyFileSync(this.file, backup); } catch { /* ignore */ }
      console.error(`[store] could not read ${this.file}: ${err.message}. Backed up to ${backup}.`);
    }
  }

  _markDirty() {
    this._dirty = true;
    if (this._timer) return;
    this._timer = setTimeout(() => this.flush(), 750);
    if (this._timer.unref) this._timer.unref();
  }

  flush() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (!this._dirty) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({
      version: 1,
      guilds: [...this.guilds.values()],
      playlists: [...this.playlists.values()],
    }, null, 2));
    fs.renameSync(tmp, this.file);
    this._dirty = false;
  }

  // ------------------------------------------------------------- guild config
  guild(guildId) {
    if (!this.guilds.has(guildId)) {
      this.guilds.set(guildId, {
        guildId,
        djRoleId: null,
        defaultVolume: null,
        twentyFourSeven: false,
        announceTracks: true,
        requesterOnlyControls: false,
      });
      this._markDirty();
    }
    return this.guilds.get(guildId);
  }

  setGuild(guildId, patch) {
    const g = this.guild(guildId);
    Object.assign(g, patch);
    this._markDirty();
    return g;
  }

  // ---------------------------------------------------------------- playlists
  savePlaylist(ownerId, name, tracks) {
    const key = `${ownerId}:${name.toLowerCase()}`;
    const record = {
      ownerId,
      name,
      tracks,
      createdAt: this.playlists.get(key)?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    this.playlists.set(key, record);
    this._markDirty();
    return record;
  }

  getPlaylist(ownerId, name) {
    return this.playlists.get(`${ownerId}:${name.toLowerCase()}`) || null;
  }

  deletePlaylist(ownerId, name) {
    const key = `${ownerId}:${name.toLowerCase()}`;
    const existed = this.playlists.delete(key);
    if (existed) this._markDirty();
    return existed;
  }

  listPlaylists(ownerId) {
    return [...this.playlists.values()].filter((p) => p.ownerId === ownerId);
  }
}

module.exports = { Store };
