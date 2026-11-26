import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

test('response migration preserves existing participants, availability and stars', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'));
    db.exec(`INSERT INTO rooms (id, secret_hash) VALUES ('test', '${'a'.repeat(64)}');
      INSERT INTO participants (room_id, name, normalized_name) VALUES ('test', 'Alice', 'alice');
      INSERT INTO availability VALUES (1, '2026-10-28');
      INSERT INTO stars VALUES ('test', '2026-10-28');`);
    db.exec(readFileSync(new URL('../migrations/0002_responses.sql', import.meta.url), 'utf8'));
    assert.equal(db.prepare('SELECT status FROM availability').get().status, 'yes');
    assert.equal(db.prepare('SELECT name FROM participants').get().name, 'Alice');
    assert.equal(db.prepare('SELECT day FROM stars').get().day, '2026-10-28');
    assert.throws(() => db.exec("UPDATE availability SET status = 'bad'"));
  } finally { db.close(); }
});
