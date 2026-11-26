import { findRoom } from './config.js';
import { roomId, HttpError } from './validation.js';

export async function hashSecret(secret) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return different === 0;
}

// Best-effort abuse protection per isolate. Bounded, short-lived, never persisted/logged.
// Cloudflare's verified CF-Connecting-IP is used, not a client-selected forwarded header.
const failures = new Map();
export function failureLimiter(now = Date.now()) {
  return {
    check(key) {
      const entry = failures.get(key);
      if (entry && entry.until > now && entry.count >= 30) {
        throw new HttpError(429, 'rate_limited', 'Too many attempts. Wait a minute before trying again.');
      }
    },
    fail(key) {
      const entry = failures.get(key);
      if (!entry || entry.until <= now) {
        for (const [id, record] of failures) if (record.until <= now) failures.delete(id);
        if (failures.size >= 1000) failures.delete(failures.keys().next().value);
        failures.set(key, { count: 1, until: now + 60_000 });
      } else entry.count++;
    }
  };
}

export async function authorize(request, env, id) {
  roomId(id);
  const room = findRoom(id);
  if (!room) throw new HttpError(404, 'room_missing', "This room doesn't exist.");
  const limiter = failureLimiter();
  const key = `${request.headers.get('CF-Connecting-IP') || 'local'}:${id}`;
  limiter.check(key);
  const stored = await env.DB.prepare('SELECT secret_hash FROM rooms WHERE id = ?').bind(id).first();
  if (!stored) throw new HttpError(404, 'room_missing', "This room doesn't exist.");
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('Authorization') || '');
  if (!match || !constantTimeEqual(await hashSecret(match[1]), stored.secret_hash)) {
    limiter.fail(key);
    throw new HttpError(401, 'invalid_link', 'This room link is invalid or has changed.');
  }
  return room;
}
