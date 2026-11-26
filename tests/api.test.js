import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, call, join, testSecret } from './helpers.js';
import { hashSecret } from '../src/server/auth.js';
import { addDays } from '../src/server/dates.js';

test('complete room snapshot, persistent names, normalized duplicates and validation', async (t) => {
  const { db, secret } = await setup(t);
  const alice = await join(db, secret, '  Alice  ');
  assert.equal(alice.name, 'Alice'); assert.equal(typeof alice.id, 'number');
  assert.equal((await call(db, secret, 'participants', 'POST', { name: 'aLICE' })).status, 409);
  await join(db, secret, 'Émile');
  assert.equal((await call(db, secret, 'participants', 'POST', { name: 'E\u0301MILE' })).status, 409);
  for (const name of ['', ' '.repeat(6), 'x'.repeat(41), 3, 'a\nb']) {
    assert.equal((await call(db, secret, 'participants', 'POST', { name })).status, 400);
  }
  const loaded = await call(db, secret, 'room');
  assert.equal(loaded.body.dates.length, 10);
  assert.equal(loaded.body.room.timezone, 'America/Toronto');
  assert.equal(loaded.body.participants[0].name, 'Alice');
  assert.equal(loaded.body.participants[0].id, alice.id);
  assert.deepEqual(loaded.body.participants[0].available, []);
});
test('availability and multiple stars persist and repeated desired values are idempotent', async (t) => {
  const { db, secret } = await setup(t);
  const alice = await join(db, secret, 'Alice');
  const { body: initial } = await call(db, secret, 'room');
  const day = initial.dates[1];
  for (let i = 0; i < 2; i++) {
    assert.equal((await call(db, secret, 'availability', 'PUT', { participantId: alice.id, date: day, available: true })).status, 200);
    for (const date of initial.dates.slice(0, 2)) await call(db, secret, 'stars', 'PUT', { date, starred: true });
  }
  let loaded = (await call(db, secret, 'room')).body;
  assert.deepEqual(loaded.participants[0].available, [day]);
  assert.deepEqual(loaded.stars, initial.dates.slice(0, 2));
  for (let i = 0; i < 2; i++) {
    await call(db, secret, 'availability', 'PUT', { participantId: alice.id, date: day, available: false });
    await call(db, secret, 'stars', 'PUT', { date: day, starred: false });
  }
  loaded = (await call(db, secret, 'room')).body;
  assert.deepEqual(loaded.participants[0].available, []);
  assert.deepEqual(loaded.stars, [initial.dates[0]]);
});
test('foreign keys cascade and re-joining receives a new empty identity', async (t) => {
  const { db, secret } = await setup(t);
  assert.equal(db.sqlite.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  const alice = await join(db, secret, 'Alice');
  const day = (await call(db, secret, 'room')).body.dates[0];
  await call(db, secret, 'availability', 'PUT', { participantId: alice.id, date: day, available: true });
  assert.equal((await call(db, secret, 'participants', 'DELETE', { participantId: alice.id })).status, 200);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM availability').get().n, 0);
  const replacement = await join(db, secret, 'Alice');
  assert.ok(replacement.id > alice.id); assert.deepEqual(replacement.available, []);
});
test('cross-room IDs, invalid identifiers, nonboolean values and out-of-window dates are rejected', async (t) => {
  const { db, secret } = await setup(t);
  await db.prepare('INSERT INTO rooms (id, secret_hash) VALUES (?, ?)').bind('other', await hashSecret(secret)).run();
  const other = await db.prepare('INSERT INTO participants (room_id, name, normalized_name) VALUES (?, ?, ?) RETURNING id').bind('other', 'Other', 'other').first();
  const alice = await join(db, secret, 'Alice');
  const dates = (await call(db, secret, 'room')).body.dates;
  assert.equal((await call(db, secret, 'availability', 'PUT', { participantId: other.id, date: dates[0], available: true })).status, 404);
  assert.equal((await call(db, secret, 'participants', 'DELETE', { participantId: other.id })).status, 404);
  for (const id of [0, -1, '1', 1.5, null]) assert.equal((await call(db, secret, 'participants', 'DELETE', { participantId: id })).status, 400);
  for (const endpoint of ['availability', 'stars']) {
    for (const date of [addDays(dates[0], -1), addDays(dates.at(-1), 1)]) {
      assert.equal((await call(db, secret, endpoint, 'PUT', { participantId: alice.id, date, available: true, starred: true })).status, 400);
    }
    assert.equal((await call(db, secret, endpoint, 'PUT', { participantId: alice.id, date: dates[0], available: 1, starred: 'true' })).status, 400);
  }
  assert.equal((await call(db, secret, 'room', 'GET', null, { room: '../room' })).status, 400);
});
test('history stays attached to absolute dates and is excluded from current snapshots', async (t) => {
  const { db, secret } = await setup(t);
  const alice = await join(db, secret, 'Alice');
  const dates = (await call(db, secret, 'room')).body.dates;
  const old = addDays(dates[0], -1);
  for (const day of [old, dates[2]]) {
    await db.prepare('INSERT INTO availability (participant_id, day) VALUES (?, ?)').bind(alice.id, day).run();
    await db.prepare('INSERT INTO stars VALUES (?, ?)').bind('game-night', day).run();
  }
  const loaded = (await call(db, secret, 'room')).body;
  assert.deepEqual(loaded.participants[0].available, [dates[2]]);
  assert.deepEqual(loaded.stars, [dates[2]]);
  assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM availability').get().n, 2);
});
test('rotation immediately revokes the old link and preserves participants and availability', async (t) => {
  const { db, secret } = await setup(t);
  const alice = await join(db, secret, 'Alice');
  const date = (await call(db, secret, 'room')).body.dates[0];
  await call(db, secret, 'availability', 'PUT', { participantId: alice.id, date, available: true });
  const next = testSecret();
  await db.prepare('UPDATE rooms SET secret_hash = ? WHERE id = ?').bind(await hashSecret(next), 'game-night').run();
  assert.equal((await call(db, secret, 'room')).status, 401);
  const loaded = (await call(db, next, 'room')).body;
  assert.equal(loaded.participants[0].id, alice.id); assert.deepEqual(loaded.participants[0].available, [date]);
});
test('method, body size, malformed JSON, content type and raw SQL errors are handled safely', async (t) => {
  const { db, secret } = await setup(t);
  for (const [endpoint, method] of [['room', 'POST'], ['participants', 'PUT'], ['stars', 'GET'], ['availability', 'DELETE']]) {
    const response = await call(db, secret, endpoint, method, {});
    assert.equal(response.status, 405); assert.ok(response.headers.get('allow'));
  }
  for (const raw of ['{', 'null', '[]', 'true']) {
    assert.equal((await call(db, secret, 'participants', 'POST', {}, { raw })).status, 400);
  }
  assert.equal((await call(db, secret, 'participants', 'POST', { name: 'x'.repeat(3000) })).status, 413);
  assert.equal((await call(db, secret, 'participants', 'POST', {}, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  const broken = { prepare() { throw new Error('SQL secret schema details'); } };
  const response = await call(broken, secret, 'room');
  assert.equal(response.status, 503); assert.ok(!JSON.stringify(response.body).includes('SQL'));
});

test('all response transitions persist on the tenth date; blank deletes and legacy writes remain supported', async (t) => {
  const { db, secret } = await setup(t); const person = await join(db, secret, 'Alice');
  const dates = (await call(db, secret, 'room')).body.dates;
  for (const before of [null, 'yes', 'no', 'maybe']) {
    for (const status of [null, 'yes', 'no', 'maybe']) {
      for (const value of [before, status, status]) {
        assert.equal((await call(db, secret, 'availability', 'PUT', { participantId: person.id, date: dates[9], status: value })).status, 200);
      }
      const loaded = (await call(db, secret, 'room')).body.participants[0];
      assert.deepEqual(loaded.responses, status === null ? {} : { [dates[9]]: status });
      assert.deepEqual(loaded.available, status === 'yes' ? [dates[9]] : []);
    }
  }
  assert.equal((await call(db, secret, 'availability', 'PUT', { participantId: person.id, date: addDays(dates[9], 1), status: 'yes' })).status, 400);
  for (const status of [true, false, '', 'blank', 'unknown', 1, {}, []]) {
    assert.equal((await call(db, secret, 'availability', 'PUT', { participantId: person.id, date: dates[0], status })).status, 400);
  }
  assert.equal((await call(db, secret, 'availability', 'PUT', { participantId: person.id, date: dates[0], status: 'yes', available: true })).status, 400);
  for (const available of [true, false]) {
    await call(db, secret, 'availability', 'PUT', { participantId: person.id, date: dates[9], available });
    assert.deepEqual((await call(db, secret, 'room')).body.participants[0].responses, available ? { [dates[9]]: 'yes' } : {});
  }
});
