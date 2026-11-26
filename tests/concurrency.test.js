import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { SQLiteD1, setup, call, join } from './helpers.js';

test('unrelated participant/day updates do not overwrite each other', async (t) => {
  const { db, secret } = await setup(t);
  const alice = await join(db, secret, 'Alice'); const bob = await join(db, secret, 'Bob');
  const dates = (await call(db, secret, 'room')).body.dates;
  const updates = [
    { participantId: alice.id, date: dates[0], available: true },
    { participantId: alice.id, date: dates[1], available: true },
    { participantId: bob.id, date: dates[0], available: true }
  ];
  const results = await Promise.all(updates.map((body) => call(db, secret, 'availability', 'PUT', body)));
  assert.ok(results.every((result) => result.status === 200));
  const loaded = (await call(db, secret, 'room')).body;
  assert.deepEqual(loaded.participants[0].available.sort(), dates.slice(0, 2));
  assert.deepEqual(loaded.participants[1].available, [dates[0]]);
});
test('concurrent API joins stop at ten and normalized duplicate joins create one row', async (t) => {
  const { db, secret } = await setup(t);
  const duplicates = await Promise.all(['Alice', 'ALICE', 'alice'].map((name) => call(db, secret, 'participants', 'POST', { name })));
  assert.deepEqual(duplicates.map((response) => response.status).sort(), [201, 409, 409]);
  const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => call(db, secret, 'participants', 'POST', { name: `Friend ${i}` })));
  assert.equal(responses.filter((response) => response.status === 201).length, 9);
  assert.equal((await call(db, secret, 'room')).body.participants.length, 10);
});

function parallelInserts(file, names) {
  const signal = new SharedArrayBuffer(4);
  const gate = new Int32Array(signal);
  const promises = names.map((name) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./insert-worker.js', import.meta.url), { workerData: { file, name, signal } });
    worker.on('message', (message) => { if (message === 'ready') { Atomics.add(gate, 0, 1); Atomics.notify(gate, 0); } else resolve(message); });
    worker.on('error', reject);
  }));
  return { promises, gate };
}
test('database constraints hold across genuinely simultaneous independent connections', async (t) => {
  const directory = mkdtempSync(pathJoin(tmpdir(), 'wenbre-concurrency-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = pathJoin(directory, 'test.sqlite');
  const db = new SQLiteD1(file); db.migrate(); t.after(() => db.close());
  db.sqlite.exec("PRAGMA journal_mode = WAL; INSERT INTO rooms (id, secret_hash) VALUES ('game-night', '" + '0'.repeat(64) + "');");
  const names = Array.from({ length: 16 }, (_, i) => `Friend ${i}`);
  for (const group of [names, ['alice', 'alice', 'alice', 'alice']]) {
    db.sqlite.exec('DELETE FROM participants');
    const { promises, gate } = parallelInserts(file, group);
    // All workers wait at the same gate after opening their connection.
    while (Atomics.load(gate, 0) < group.length) await new Promise((resolve) => setTimeout(resolve, 5));
    Atomics.store(gate, 0, 1000); Atomics.notify(gate, 0);
    const results = await Promise.all(promises);
    assert.equal(results.filter((result) => result === 'inserted').length, group === names ? 10 : 1);
    assert.ok(results.every((result) => ['inserted', 'constraint'].includes(result)), JSON.stringify(results));
    assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM participants').get().n, group === names ? 10 : 1);
  }
});
