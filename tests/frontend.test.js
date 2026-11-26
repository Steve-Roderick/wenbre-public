import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { setup, call, join } from './helpers.js';
import { makeDocument } from './dom.js';
import { onRequest as room } from '../functions/api/room.js';
import { onRequest as participants } from '../functions/api/participants.js';
import { onRequest as availability } from '../functions/api/availability.js';
import { onRequest as stars } from '../functions/api/stars.js';
const handlers = { room, participants, availability, stars };
const turn = () => new Promise((resolve) => setImmediate(resolve));
const defer = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await turn(); } assert.fail('UI did not settle'); }
async function choose(ui, button, status) {
  await button.fire('click');
  await ui.document.querySelectorAll('.response-option').find((option) => option.dataset.status === (status ?? 'blank')).fire('click');
}
async function browser(db, secret, options = {}) {
  const document = makeDocument(); const calls = []; let failNext = false; let hold = null;
  let clock = new Date('2026-10-17T12:00:00Z');
  const media = { matches: false, addEventListener(type, listener) { this.listener = listener; } };
  class BrowserDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } }
  const storage = new Map(); const events = {}; let confirmation = true;
  const context = vm.createContext({
    document, URLSearchParams, Intl, Date: BrowserDate, console,
    location: { hash: options.hash ?? `#room=game-night&key=${secret}`, reload() {} },
    window: { addEventListener(name, fn) { events[name] = fn; }, matchMedia() { return media; } },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    confirm: () => confirmation,
    fetch: async (path, init) => {
      calls.push({ path, ...init });
      if (failNext) { failNext = false; throw new Error('offline'); }
      if (hold && init.method === 'PUT') { const gate = hold; hold = null; await gate.promise; }
      const endpoint = path.split('/')[2].split('?')[0];
      return handlers[endpoint]({ request: new Request(`https://calendar.test${path}`, init), env: { DB: db, API_ENABLED: 'true' } });
    }
  });
  const queue = new vm.SourceTextModule(readFileSync(new URL('../public/save-queue.js', import.meta.url), 'utf8'), { context });
  const app = new vm.SourceTextModule(readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), { context });
  await app.link(() => queue); await app.evaluate();
  await until(() => !document.ids.refresh.disabled);
  return {
    document, calls, storage, events,
    mobile(value) { media.matches = value; media.listener?.(); },
    fail() { failNext = true; }, hold(gate) { hold = gate; },
    advance() { clock = new Date(clock.getTime() + 60_000); },
    confirm(value) { confirmation = value; },
    control(selector) { return document.querySelectorAll(selector)[0]; },
    async settle() { await until(() => document.ids['save-status'].textContent !== 'Saving changes…'); }
  };
}

test('two frontend contexts share persistent state only after manual refresh; edits do not advance timestamp', async (t) => {
  const { db, secret } = await setup(t); await join(db, secret, 'Alice');
  const first = await browser(db, secret); const second = await browser(db, secret);
  const original = second.document.ids['last-refreshed'].textContent;
  first.advance();
  const check = first.control('.response'); await choose(first, check, 'yes'); await first.settle();
  assert.equal(second.control('.response').dataset.status, 'blank');
  assert.equal(first.document.ids['last-refreshed'].textContent, original);
  second.advance(); await second.document.ids.refresh.fire('click');
  assert.equal(second.control('.response').dataset.status, 'yes');
  assert.notEqual(second.document.ids['last-refreshed'].textContent, original);
  assert.equal(first.calls.filter((c) => c.method === 'GET').length, 1);
  assert.equal(second.calls.filter((c) => c.method === 'GET').length, 2);
});
test('refresh waits for a pending write and blocks new edits before applying its snapshot', async (t) => {
  const { db, secret } = await setup(t); await join(db, secret, 'Alice');
  const ui = await browser(db, secret); const gate = defer(); ui.hold(gate);
  const check = ui.control('.response'); await choose(ui, check, 'yes'); await turn();
  const refreshing = ui.document.ids.refresh.fire('click'); await turn();
  assert.equal(ui.calls.filter((c) => c.method === 'GET').length, 1); assert.equal(check.disabled, true);
  gate.resolve(); await refreshing;
  assert.equal(ui.calls.filter((c) => c.method === 'GET').length, 2);
  assert.equal(ui.control('.response').dataset.status, 'yes');
});
test('failed refresh retains data and timestamp; failed writes visibly revert and offer retry', async (t) => {
  const { db, secret } = await setup(t); await join(db, secret, 'Alice');
  const ui = await browser(db, secret); const original = ui.document.ids['last-refreshed'].textContent;
  ui.advance(); ui.fail(); await ui.document.ids.refresh.fire('click');
  assert.equal(ui.document.ids['last-refreshed'].textContent, original);
  assert.match(ui.document.ids['notice-message'].textContent, /Showing the last loaded data/);
  assert.equal(ui.document.querySelectorAll('.response').length, 10);
  ui.fail(); const check = ui.control('.response'); await choose(ui, check, 'yes'); await ui.settle();
  assert.equal(check.dataset.status, 'blank'); assert.equal(ui.document.ids['save-errors'].hidden, false);
  await ui.document.ids['retry-saves'].fire('click'); await ui.settle();
  assert.equal(check.dataset.status, 'yes');
});
test('empty/full room messages, safe name rendering, local highlighting and confirmed removal', async (t) => {
  const { db, secret } = await setup(t); const ui = await browser(db, secret);
  assert.equal(ui.document.ids.empty.hidden, false);
  ui.document.ids.name.value = '<img src=x onerror=alert(1)>';
  await ui.document.ids['join-form'].fire('submit');
  assert.equal(ui.document.ids.empty.hidden, true);
  assert.equal(ui.control('.select-person').textContent, '<img src=x onerror=alert(1)>');
  assert.ok(ui.storage.get('wenbre:game-night'));
  ui.confirm(false); await ui.control('.remove-person').fire('click');
  assert.equal((await call(db, secret, 'room')).body.participants.length, 1);
  ui.confirm(true); await ui.control('.remove-person').fire('click');
  assert.equal((await call(db, secret, 'room')).body.participants.length, 0);
  for (let i = 0; i < 10; i++) await join(db, secret, `Friend ${i}`);
  await ui.document.ids.refresh.fire('click');
  assert.equal(ui.document.ids.join.disabled, true);
  assert.match(ui.document.ids['join-hint'].textContent, /full/);
});
test('missing credentials make no API calls and invalid credentials show a friendly error', async (t) => {
  const { db, secret } = await setup(t);
  const missing = await browser(db, secret, { hash: '' });
  assert.equal(missing.calls.length, 0);
  const invalid = await browser(db, 'x'.repeat(43));
  assert.match(invalid.document.ids['entry-message'].textContent, /invalid or has changed/);
});

test('pending controls show saving status, block removal, and confirm completion', async (t) => {
  const { db, secret } = await setup(t); await join(db, secret, 'Alice');
  const ui = await browser(db, secret); const gate = defer(); ui.hold(gate);
  const check = ui.control('.response'); await choose(ui, check, 'yes');
  assert.equal(ui.document.ids['save-status'].textContent, 'Saving changes…');
  assert.equal(ui.control('.remove-person').disabled, true);
  assert.equal(check.getAttribute('aria-busy'), 'true');
  gate.resolve(); await ui.settle();
  assert.equal(ui.document.ids['save-status'].textContent, 'All changes saved');
  assert.equal(ui.control('.remove-person').disabled, false);
  assert.equal(check.getAttribute('aria-busy'), null);
});

test('unrelated successful edits do not hide failed saves or erase their retry actions', async (t) => {
  const { db, secret } = await setup(t); await join(db, secret, 'Alice');
  const ui = await browser(db, secret);
  const check = ui.control('.response');
  ui.fail(); await choose(ui, check, 'yes'); await ui.settle();
  assert.equal(ui.document.ids['save-errors'].hidden, false);
  assert.equal(check.getAttribute('aria-invalid'), 'true');
  await ui.control('.star').fire('click'); await ui.settle();
  assert.equal(ui.document.ids['save-errors'].hidden, false);
  assert.equal(ui.document.ids['save-status'].textContent, '1 change not saved');
  let prevented = false;
  ui.events.beforeunload({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  await ui.document.ids['retry-saves'].fire('click'); await ui.settle();
  assert.equal(ui.document.ids['save-errors'].hidden, true);
  assert.equal(check.getAttribute('aria-invalid'), null);
  assert.equal(ui.document.ids['save-status'].textContent, 'All changes saved');
  assert.equal((await call(db, secret, 'room')).body.participants[0].available.length, 1);
});

test('failed refresh preserves failed-edit retry; successful refresh reconciles it with saved data', async (t) => {
  const { db, secret } = await setup(t); await join(db, secret, 'Alice');
  const ui = await browser(db, secret); const check = ui.control('.response');
  ui.fail(); await choose(ui, check, 'yes'); await ui.settle();
  ui.fail(); await ui.document.ids.refresh.fire('click');
  assert.equal(ui.document.ids['save-errors'].hidden, false);
  await ui.document.ids.refresh.fire('click');
  assert.equal(ui.document.ids['save-errors'].hidden, true);
  assert.equal(ui.control('.response').dataset.status, 'blank');
});

test('picker saves four choices, summaries count only yes, and no/maybe failures retry correctly', async (t) => {
  const { db, secret } = await setup(t); await join(db, secret, 'Alice');
  const ui = await browser(db, secret); const button = ui.control('.response');
  for (const status of ['yes', 'no', 'maybe', null]) {
    await choose(ui, button, status); await ui.settle();
    assert.equal(button.dataset.status, status ?? 'blank');
    assert.equal(ui.control('tfoot').textContent.includes('Everyone available'), status === 'yes');
    assert.equal(ui.control('tfoot').textContent.includes('1 maybe'), status === 'maybe');
  }
  for (const status of ['no', 'maybe']) {
    const previous = button.dataset.status;
    ui.fail(); await choose(ui, button, status); await ui.settle();
    assert.equal(button.dataset.status, previous);
    await ui.document.ids['retry-saves'].fire('click'); await ui.settle();
    assert.equal(button.dataset.status, status);
  }
  await ui.document.ids.refresh.fire('click');
  assert.equal(ui.control('.response').dataset.status, 'maybe');
});

test('mobile transposes dates and participants while preserving a pending response save', async (t) => {
  const { db, secret } = await setup(t); await join(db, secret, 'Steve'); await join(db, secret, 'Ada');
  const ui = await browser(db, secret); const gate = defer(); ui.hold(gate);
  const check = ui.control('.response'); await choose(ui, check, 'yes');
  ui.mobile(true);
  assert.equal(ui.document.ids.calendar.querySelector('tbody').children.length, 10);
  assert.equal(ui.document.ids.calendar.querySelector('thead').children[0].children.length, 3);
  const transposed = ui.control('.response');
  assert.equal(transposed.dataset.status, 'yes'); assert.equal(transposed.getAttribute('aria-busy'), 'true');
  gate.resolve(); await ui.settle();
  assert.equal(transposed.dataset.status, 'yes'); assert.equal(transposed.getAttribute('aria-busy'), null);
  assert.equal((await call(db, secret, 'room')).body.participants[0].available.length, 1);
  ui.mobile(false);
  assert.equal(ui.document.ids.calendar.querySelector('tbody').children.length, 2);
  assert.equal(ui.control('.response').dataset.status, 'yes');
});

test('mobile keeps date totals, starred state, highlighting and failed-edit retries', async (t) => {
  const { db, secret } = await setup(t); await join(db, secret, 'Steve');
  const ui = await browser(db, secret); ui.mobile(true);
  await ui.control('.select-person').fire('click');
  assert.equal(ui.control('.person-heading').scope, 'col');
  assert.equal(ui.control('.person-heading').className.includes('selected-column'), true);
  ui.fail(); const check = ui.control('.response'); await choose(ui, check, 'yes'); await ui.settle();
  ui.mobile(false); ui.mobile(true);
  assert.equal(ui.control('.response').getAttribute('aria-invalid'), 'true');
  await ui.document.ids['retry-saves'].fire('click'); await ui.settle();
  assert.equal(ui.control('.date-summary').textContent, '✓ all · 0 maybe');
  await ui.control('.star').fire('click'); await ui.settle();
  assert.equal(ui.control('.star').getAttribute('aria-pressed'), 'true');
  assert.equal((await call(db, secret, 'room')).body.stars.length, 1);
});
