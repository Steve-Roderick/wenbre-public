import { workerData, parentPort } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(workerData.file);
db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 10000;');
const gate = new Int32Array(workerData.signal);
parentPort.postMessage('ready');
while (Atomics.load(gate, 0) !== 1000) Atomics.wait(gate, 0, Atomics.load(gate, 0), 100);
try {
  db.prepare('INSERT INTO participants (room_id, name, normalized_name) VALUES (?, ?, ?)').run('game-night', workerData.name, workerData.name);
  parentPort.postMessage('inserted');
} catch (error) { parentPort.postMessage(/room_full|UNIQUE constraint/.test(error.message) ? 'constraint' : error.message); }
finally { db.close(); }
