'use strict';

/** 245000 -> "4:05", 7325000 -> "2:02:05". Streams get a marker. */
function duration(ms, isStream = false) {
  if (isStream) return 'LIVE';
  if (!Number.isFinite(ms) || ms <= 0) return '0:00';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** "1:30", "90", "1h2m3s" -> milliseconds. Returns null if unparseable. */
function parseTime(input) {
  if (!input) return null;
  const text = String(input).trim().toLowerCase();

  if (/^\d+$/.test(text)) return Number(text) * 1000;

  if (/^\d{1,3}(:\d{1,2}){1,2}$/.test(text)) {
    const parts = text.split(':').map(Number);
    if (parts.some((n) => Number.isNaN(n))) return null;
    const [h, m, s] = parts.length === 3 ? parts : [0, parts[0], parts[1]];
    // Seconds are always < 60. Minutes only need to be < 60 when hours are
    // given too - "99:00" is a valid way to say 99 minutes.
    if (s > 59) return null;
    if (parts.length === 3 && m > 59) return null;
    return ((h * 3600) + (m * 60) + s) * 1000;
  }

  const unit = text.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (unit && (unit[1] || unit[2] || unit[3])) {
    return ((Number(unit[1] || 0) * 3600) + (Number(unit[2] || 0) * 60) + Number(unit[3] || 0)) * 1000;
  }
  return null;
}

/** Text progress bar for the now-playing embed. */
function progressBar(positionMs, totalMs, length = 18) {
  if (!Number.isFinite(totalMs) || totalMs <= 0) return '🔴 ' + '▬'.repeat(length);
  const ratio = Math.min(1, Math.max(0, positionMs / totalMs));
  const knob = Math.round(ratio * (length - 1));
  return '▬'.repeat(knob) + '🔘' + '▬'.repeat(length - 1 - knob);
}

/** Discord embeds die past 4096 chars; titles past 256. Keep it safe. */
function truncate(text, max = 60) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** Markdown link that won't break on titles containing [ ] ( ). */
function trackLink(track) {
  const title = truncate(track?.info?.title || 'Unknown', 60).replace(/([[\]()])/g, '\\$1');
  const uri = track?.info?.uri;
  return uri ? `[${title}](${uri})` : title;
}

function totalQueueDuration(tracks) {
  return tracks.reduce((sum, t) => sum + (t?.info?.isStream ? 0 : (t?.info?.duration || 0)), 0);
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

module.exports = { duration, parseTime, progressBar, truncate, trackLink, totalQueueDuration, chunk };
