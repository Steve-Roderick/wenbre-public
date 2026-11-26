import test from 'node:test';
import assert from 'node:assert/strict';
import { hashSecret, constantTimeEqual, failureLimiter } from '../src/server/auth.js';
import { validateConfig, rooms } from '../src/server/config.js';
import { setup, call, testSecret } from './helpers.js';

test('secret hashes match SHA-256 and comparisons reject unequal hashes', async () => {
  assert.equal(await hashSecret('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  assert.equal(constantTimeEqual('abc', 'ab'), false);
});
test('configuration rejects duplicate slugs, unsafe names and bad timezones', () => {
  const valid = { id: 'night-2', name: '七夜', timezone: 'America/Toronto' };
  assert.deepEqual(validateConfig({ rooms: [valid] }), [valid]);
  for (const config of [{}, { rooms: [valid, valid] }, ...[
    { id: '../public' }, { id: 'UPPER' }, { name: '' }, { timezone: 'Moon/Sea' }, { timezone: undefined }
  ].map((change) => ({ rooms: [{ ...valid, ...change }] }))]) assert.throws(() => validateConfig(config));
});
test('every API requires the shared secret and never returns room data on failure', async (t) => {
  const { db, secret } = await setup(t);
  for (const [endpoint, method, body] of [
    ['room', 'GET'], ['participants', 'POST', { name: 'Alice' }],
    ['participants', 'DELETE', { participantId: 1 }],
    ['availability', 'PUT', { participantId: 1, date: '2026-10-17', available: true }],
    ['stars', 'PUT', { date: '2026-10-17', starred: true }]
  ]) {
    const response = await call(db, testSecret(), endpoint, method, body);
    assert.equal(response.status, 401);
    assert.deepEqual(Object.keys(response.body), ['error']);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(!JSON.stringify(response.body).includes(secret));
  }
  assert.equal((await call(db, secret, 'room')).status, 200);
});
test('whitelist is checked before database access, and unprovisioned rooms are inaccessible', async (t) => {
  const { db, secret } = await setup(t);
  const disabled = await call({ prepare() { throw new Error('must not query'); } }, secret, 'room', 'GET', null, { room: 'disabled' });
  assert.equal(disabled.status, 404);
  await db.prepare('DELETE FROM rooms').run();
  assert.equal((await call(db, secret, 'room')).status, 404);
  await db.prepare('INSERT INTO rooms (id, secret_hash) VALUES (?, ?)').bind('disabled', await hashSecret(secret)).run();
  assert.equal((await call(db, secret, 'room', 'GET', null, { room: 'disabled' })).status, 404);
});
test('removing/re-adding whitelist access preserves existing state', async (t) => {
  const { db, secret } = await setup(t);
  const approved = rooms.splice(0, 1)[0];
  try { assert.equal((await call(db, secret, 'room')).status, 404); }
  finally { rooms.unshift(approved); }
  assert.equal((await call(db, secret, 'room')).status, 200);
});
test('failed authentication is limited for a bounded time', () => {
  const limiter = failureLimiter(100);
  for (let i = 0; i < 30; i++) { limiter.check('test-ip'); limiter.fail('test-ip'); }
  assert.throws(() => limiter.check('test-ip'), (error) => error.status === 429);
  failureLimiter(60101).check('test-ip');
});
test('preview is disabled before accessing DB, and cross-origin requests are rejected', async (t) => {
  const { db, secret } = await setup(t);
  assert.equal((await call(db, secret, 'room', 'GET', null, { env: { API_ENABLED: 'false' } })).status, 503);
  assert.equal((await call(db, secret, 'room', 'GET', null, { env: { DB: undefined } })).status, 503);
  const response = await call(db, secret, 'room', 'GET', null, { headers: { Origin: 'https://unrelated.test' } });
  assert.equal(response.status, 403); assert.equal(response.headers.get('access-control-allow-origin'), null);
});
