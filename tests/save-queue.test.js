import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveQueue } from '../public/save-queue.js';
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const turn = () => new Promise((resolve) => setImmediate(resolve));
function harness(send) {
  const displays = []; const errors = [];
  const queue = new SaveQueue({ send, display: (...args) => displays.push(args), busy() {}, saved() {}, failure: (...args) => errors.push(args) });
  return { queue, displays, errors };
}
test('rapid edits to the same cell serialize and finish at the last desired value', async () => {
  const first = deferred(); const writes = [];
  const { queue, displays } = harness(async (payload, value) => { writes.push(value); if (writes.length === 1) await first.promise; });
  queue.set('cell', false, true, {}); await turn();
  queue.set('cell', true, false, {});
  assert.deepEqual(writes, [true]); assert.equal(queue.pending, true);
  first.resolve(); await queue.idle();
  assert.deepEqual(writes, [true, false]); assert.deepEqual(displays.at(-1), ['cell', false, false]);
});
test('different cells save independently and a refresh can await all pending writes', async () => {
  const first = deferred(); const second = deferred(); const writes = [];
  const { queue } = harness(async (payload, value) => { writes.push(payload.id); await (payload.id === 1 ? first.promise : second.promise); });
  queue.set('first', false, true, { id: 1 }); queue.set('second', false, true, { id: 2 }); await turn();
  let done = false; const idle = queue.idle().then(() => { done = true; });
  assert.deepEqual(writes, [1, 2]); second.resolve(); await turn(); assert.equal(done, false);
  first.resolve(); await idle; assert.equal(done, true);
});
test('failed save restores confirmed state and exposes retry, including ambiguous failures', async () => {
  let attempts = 0;
  const { queue, displays, errors } = harness(async () => { if (++attempts === 1) throw new Error('network'); });
  queue.set('cell', false, true, {}); await queue.idle();
  assert.deepEqual(displays.at(-1), ['cell', false, false]);
  assert.equal(errors.length, 1); errors[0][1](); await queue.idle();
  assert.equal(attempts, 2); assert.deepEqual(displays.at(-1), ['cell', true, false]);
});
test('a new intent after an ambiguous failure explicitly reasserts the desired value', async () => {
  const first = deferred(); const writes = [];
  const { queue, errors } = harness(async (payload, value) => { writes.push(value); if (writes.length === 1) await first.promise; });
  queue.set('cell', false, true, {}); await turn(); queue.set('cell', true, false, {});
  first.reject(new Error('network')); await queue.idle();
  assert.deepEqual(writes, [true, false]); assert.equal(errors.length, 0);
});

test('independent failed edits all remain retryable across later successful saves', async () => {
  let fail = true;
  const values = new Map();
  const { queue } = harness(async (payload, value) => {
    if (fail && payload.id !== 'success') throw new Error('offline');
    values.set(payload.id, value);
  });
  queue.set('first', false, true, { id: 'first' });
  queue.set('second', false, true, { id: 'second' });
  await queue.idle();
  assert.equal(queue.failures.size, 2);
  queue.set('success', false, true, { id: 'success' });
  await queue.idle();
  assert.equal(queue.failures.size, 2);
  fail = false;
  await queue.retryFailed();
  assert.equal(queue.failures.size, 0);
  assert.deepEqual([...values.entries()].sort(), [['first', true], ['second', true], ['success', true]]);
});
