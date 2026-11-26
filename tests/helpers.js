import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { hashSecret } from '../src/server/auth.js';
import { onRequest as room } from '../functions/api/room.js';
import { onRequest as participants } from '../functions/api/participants.js';
import { onRequest as availability } from '../functions/api/availability.js';
import { onRequest as stars } from '../functions/api/stars.js';

// Execute the production SQL against real SQLite, exposing D1's prepared API.
// This adapter tests SQL/handlers; it does not claim to emulate the workerd runtime.
export class SQLiteD1 {
  constructor(path = ':memory:') {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;');
  }
  migrate() { for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter((name) => name.endsWith('.sql')).sort()) this.sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')); }
  prepare(sql) {
    const statement = this.sqlite.prepare(sql);
    let values = [];
    const convert = (row) => row ? { ...row } : null;
    const prepared = {
      bind(...args) { values = args; return prepared; },
      async first() { return convert(statement.get(...values)); },
      async all() { return { results: statement.all(...values).map(convert), success: true }; },
      async run() { return { meta: statement.run(...values), success: true }; }
    };
    return prepared;
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.all());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
  close() { this.sqlite.close(); }
}
export const testSecret = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
export async function setup(t) {
  const db = new SQLiteD1(); db.migrate(); t.after(() => db.close());
  const secret = testSecret();
  await db.prepare('INSERT INTO rooms (id, secret_hash) VALUES (?, ?)').bind('game-night', await hashSecret(secret)).run();
  return { db, secret };
}
const handlers = { room, participants, availability, stars };
export async function call(db, secret, endpoint, method = 'GET', body, extra = {}) {
  const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...extra.headers };
  const url = `https://calendar.test/api/${endpoint}${method === 'GET' ? `?room=${extra.room || 'game-night'}` : ''}`;
  const request = new Request(url, { method, headers, ...(method !== 'GET' && method !== 'HEAD' ? {
    body: extra.raw ?? JSON.stringify({ room: 'game-night', ...body })
  } : {}) });
  const response = await handlers[endpoint]({ request, env: { DB: db, API_ENABLED: 'true', ...extra.env } });
  return { status: response.status, headers: response.headers, body: await response.json() };
}
export async function join(db, secret, name) {
  const response = await call(db, secret, 'participants', 'POST', { name });
  if (response.status !== 201) throw new Error(JSON.stringify(response.body));
  return response.body;
}
