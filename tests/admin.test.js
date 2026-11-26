import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteD1, call, join } from './helpers.js';
import { provisionRoom, rotateRoom, listRooms, cleanup } from '../scripts/room-operations.mjs';
import { parseOptions, shareBase, quote, newSecret } from '../scripts/admin.mjs';
import { hashSecret } from '../src/server/auth.js';
import { addDays, roomToday } from '../src/server/dates.js';

function sqlFor(db) {
  return (_, sql) => {
    if (sql.startsWith('SELECT') || sql.includes('RETURNING')) return [{ results: db.sqlite.prepare(sql).all() }];
    db.sqlite.exec(sql); return [{ results: [] }];
  };
}
test('admin commands require exactly one target, an approved room, safe URLs and production confirmation', () => {
  for (const args of [[], ['game-night'], ['game-night','--local','--production'], ['unknown','--local'], ['game-night','--local','--bad']]) {
    assert.throws(() => parseOptions(args));
  }
  assert.equal(parseOptions(['game-night','--local']).room, 'game-night');
  assert.equal(shareBase({ production: false }), 'http://localhost:8788');
  for (const base of ['http://example.test', 'https://x.test/path', 'https://x.test/#key=abc', 'https://user:pass@x.test']) {
    assert.throws(() => shareBase({ production: true, base }));
  }
  assert.throws(() => rotateRoom({ room: 'game-night', production: true, base: 'https://calendar.test' }, () => assert.fail('must not run SQL')));
  assert.equal(quote("a'b"), "'a''b'");
  const { secret, hash } = newSecret(); assert.equal(secret.length, 43); assert.equal(hash.length, 64);
});
test('provisioning, refusal to overwrite, secret rotation and room listing use persisted SQL state', async (t) => {
  const db = new SQLiteD1(); db.migrate(); t.after(() => db.close());
  const sql = sqlFor(db); const options = { room: 'game-night', production: false };
  let secret;
  provisionRoom(options, sql, (_, base, value) => { secret = value; assert.equal(base, 'http://localhost:8788'); });
  assert.equal(db.sqlite.prepare('SELECT secret_hash FROM rooms').get().secret_hash, await hashSecret(secret));
  assert.throws(() => provisionRoom(options, sql), /already provisioned/);
  const alice = await join(db, secret, 'Alice');
  const date = (await call(db, secret, 'room')).body.dates[0];
  await call(db, secret, 'availability', 'PUT', { participantId: alice.id, date, available: true });
  const old = secret; rotateRoom(options, sql, (_, base, value) => { secret = value; });
  assert.notEqual(secret, old); assert.equal((await call(db, old, 'room')).status, 401);
  const room = (await call(db, secret, 'room')).body;
  assert.equal(room.participants[0].id, alice.id); assert.deepEqual(room.participants[0].available, [date]);
  const lines = []; listRooms(options, sql, (line) => lines.push(line));
  assert.match(lines.join('\n'), /game-night.*provisioned/);
  assert.ok(!lines.join('\n').includes(secret));
});
test('cleanup removes only records older than 30 days and preserves current availability', async (t) => {
  const db = new SQLiteD1(); db.migrate(); t.after(() => db.close());
  const sql = sqlFor(db); const options = { room: 'game-night', production: false };
  let secret; provisionRoom(options, sql, (_, base, value) => { secret = value; });
  const alice = await join(db, secret, 'Alice'); const today = roomToday('America/Toronto');
  for (const day of [addDays(today, -31), addDays(today, -30), today]) {
    db.sqlite.prepare('INSERT INTO availability (participant_id, day) VALUES (?, ?)').run(alice.id, day);
    db.sqlite.prepare('INSERT INTO stars VALUES (?, ?)').run('game-night', day);
  }
  cleanup(options, sql, () => {});
  assert.deepEqual(db.sqlite.prepare('SELECT day FROM availability ORDER BY day').all().map((row) => row.day), [addDays(today, -30), today]);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM stars').get().n, 2);
});
