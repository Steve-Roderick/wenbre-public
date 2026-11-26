import { test, expect } from '@playwright/test';

const origin = () => process.env.WENBRE_BROWSER_ORIGIN;
const key = () => process.env.WENBRE_BROWSER_KEY;
const headers = () => ({ Authorization: `Bearer ${key()}` });
async function api(request, endpoint, method = 'GET', data) {
  const response = await request.fetch(`${origin()}/api/${endpoint}${method === 'GET' ? '?room=game-night' : ''}`, {
    method, headers: headers(), ...(data ? { data: { room: 'game-night', ...data } } : {})
  });
  return { status: response.status(), body: await response.json() };
}
async function open(page, secret = key()) {
  // Keep private fragments out of Playwright's navigation diagnostics and reports.
  await page.addInitScript((secret) => {
    history.replaceState(null, '', `/#room=game-night&key=${secret}`);
  }, secret);
  await page.goto(origin());
  await expect(page.locator('#refresh')).toBeEnabled();
}
async function add(page, name) {
  await page.getByLabel('Add your name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Add participant' }).click();
  await expect(page.getByRole('button', { name: `Highlight ${name}`, exact: true })).toBeVisible();
}
const row = (page, name) => page.locator('tbody tr').filter({ has: page.getByRole('button', { name: `Highlight ${name}`, exact: true }) });
const pageFor = (locator) => locator.page();
async function choose(page, button, status) {
  await button.click();
  await page.locator(`#response-options [data-status=${status ?? 'blank'}]`).click();
}
async function saved(page) { await expect(page.locator('#save-status')).toHaveText('All changes saved'); }

test.beforeEach(async ({ request }) => {
  // The setup starts a fresh isolated local D1 database, never the operator's dev/production DB.
  const { body } = await api(request, 'room');
  for (const participant of body.participants) await api(request, 'participants', 'DELETE', { participantId: participant.id });
  for (const date of body.stars) await api(request, 'stars', 'PUT', { date, starred: false });
});

test('two browsers edit independently, refresh, reload, star multiple days and confirm removal', async ({ browser, request }) => {
  const first = await browser.newContext(); const second = await browser.newContext();
  try {
    const a = await first.newPage(); const b = await second.newPage();
    const errors = []; a.on('pageerror', (error) => errors.push(error.message)); b.on('pageerror', (error) => errors.push(error.message));
    await open(a); await expect(a.locator('#empty')).toBeVisible();
    await expect(a.locator('tfoot')).not.toContainText('Everyone available');
    await add(a, 'Alice');
    await open(b); await add(b, 'Bob');
    await expect(a.locator('tbody tr')).toHaveCount(1);
    await a.locator('#refresh').click();
    await expect(a.locator('tbody tr')).toHaveCount(2);
    const initialStamp = await a.locator('#last-refreshed').textContent();
    await choose(pageFor(row(a, 'Alice').locator('.response').nth(0)), row(a, 'Alice').locator('.response').nth(0), 'yes'); await saved(a);
    await choose(pageFor(row(b, 'Bob').locator('.response').nth(1)), row(b, 'Bob').locator('.response').nth(1), 'yes'); await saved(b);
    await choose(pageFor(row(a, 'Alice').locator('.response').nth(2)), row(a, 'Alice').locator('.response').nth(2), 'yes'); await saved(a);
    await expect(a.locator('#last-refreshed')).toHaveText(initialStamp);
    await a.clock.setFixedTime(new Date(Date.now() + 120_000));
    await a.locator('#refresh').click();
    await expect(a.locator('#last-refreshed')).not.toHaveText(initialStamp);
    await b.locator('#refresh').click();
    await expect(row(b, 'Alice').locator('.response').nth(0)).toHaveAttribute('data-status', 'yes');
    await expect(row(b, 'Alice').locator('.response').nth(2)).toHaveAttribute('data-status', 'yes');
    await expect(row(b, 'Bob').locator('.response').nth(1)).toHaveAttribute('data-status', 'yes');
    const stars = a.getByRole('button', { name: /^Game night on/ });
    await stars.nth(0).click(); await saved(a); await stars.nth(2).click(); await saved(a);
    await a.reload();
    await expect(a.locator('.star[aria-pressed=true]')).toHaveCount(2);
    await expect(row(a, 'Alice').locator('.response').nth(0)).toHaveAttribute('data-status', 'yes');
    // Cancel first, then accept the actual browser confirmation.
    a.once('dialog', (dialog) => dialog.dismiss());
    await a.getByRole('button', { name: 'Remove Alice', exact: true }).click();
    await expect(a.locator('tbody tr')).toHaveCount(2);
    a.once('dialog', (dialog) => dialog.accept());
    await a.getByRole('button', { name: 'Remove Alice', exact: true }).click();
    await expect(a.locator('tbody tr')).toHaveCount(1);
    await add(a, 'Alice'); await expect(row(a, 'Alice').locator('.response[data-status=yes]')).toHaveCount(0);
    const { body } = await api(request, 'room');
    expect(body.participants.find((p) => p.name === 'Bob').available).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally { await first.close(); await second.close(); }
});

test('rapid clicks and refresh during a slow save settle at persisted desired values', async ({ page, request }) => {
  await open(page); await add(page, 'Rapid');
  await page.route('**/api/availability', async (route) => { await new Promise((resolve) => setTimeout(resolve, 250)); await route.continue(); });
  const check = row(page, 'Rapid').locator('.response').first();
  await choose(pageFor(check), check, 'yes'); await choose(pageFor(check), check, null); await choose(pageFor(check), check, 'yes'); await choose(pageFor(check), check, null);
  await page.locator('#refresh').click();
  await expect(page.locator('#refresh')).toBeEnabled();
  await expect(check).toHaveAttribute('data-status', 'blank');
  expect((await api(request, 'room')).body.participants[0].available).toEqual([]);
  await choose(pageFor(check), check, 'yes'); await saved(page); await page.reload(); await expect(check).toHaveAttribute('data-status', 'yes');
});

test('offline saves remain retryable and failed refresh keeps last data and timestamp', async ({ page, context }) => {
  await open(page); await add(page, 'Offline');
  const stamp = await page.locator('#last-refreshed').textContent();
  await context.setOffline(true);
  await choose(page, row(page, 'Offline').locator('.response').first(), 'yes');
  await expect(page.locator('#save-errors')).toBeVisible();
  await expect(row(page, 'Offline').locator('.response').first()).toHaveAttribute('data-status', 'blank');
  await page.locator('#refresh').click();
  await expect(page.locator('#notice')).toContainText('Showing the last loaded data');
  await expect(page.locator('#last-refreshed')).toHaveText(stamp);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await context.setOffline(false);
  await page.locator('.star').first().click();
  await expect(page.locator('#save-status')).toHaveText('1 change not saved');
  await page.getByRole('button', { name: 'Retry changes' }).click(); await saved(page);
  await page.reload(); await expect(row(page, 'Offline').locator('.response').first()).toHaveAttribute('data-status', 'yes');
});

test('real D1 enforces duplicate names, capacity, authorization and cascading deletion', async ({ page, request }) => {
  const duplicate = await Promise.all(['Alice', 'ALICE'].map((name) => api(request, 'participants', 'POST', { name })));
  expect(duplicate.map((result) => result.status).sort()).toEqual([201, 409]);
  const attempts = await Promise.all(Array.from({ length: 15 }, (_, index) => api(request, 'participants', 'POST', { name: `Friend ${index}` })));
  expect(attempts.filter((result) => result.status === 201)).toHaveLength(9);
  expect(attempts.every((result) => [201, 409].includes(result.status))).toBeTruthy();
  await open(page); await expect(page.locator('tbody tr')).toHaveCount(10);
  await expect(page.getByRole('button', { name: 'Add participant' })).toBeDisabled();
  await expect(page.locator('#join-hint')).toContainText('full');
  const { body } = await api(request, 'room'); const participantId = body.participants[0].id; const date = body.dates[0];
  const parallel = await Promise.all([
    { participantId, date, available: true },
    { participantId, date: body.dates[1], available: true },
    { participantId: body.participants[1].id, date: body.dates[2], available: true }
  ].map((value) => api(request, 'availability', 'PUT', value)));
  expect(parallel.every((result) => result.status === 200)).toBeTruthy();
  const persisted = (await api(request, 'room')).body;
  expect(persisted.participants[0].available.sort()).toEqual(body.dates.slice(0, 2));
  expect(persisted.participants[1].available).toEqual([body.dates[2]]);
  expect((await api(request, 'participants', 'DELETE', { participantId })).status).toBe(200);
  expect((await api(request, 'availability', 'PUT', { participantId, date, available: true })).status).toBe(404);
  const invalid = await request.get(`${origin()}/api/room?room=game-night`, { headers: { Authorization: `Bearer ${'x'.repeat(43)}` } });
  expect(invalid.status()).toBe(401); expect(await invalid.json()).toHaveProperty('error');
  const unknown = await request.get(`${origin()}/api/room?room=disabled`, { headers: headers() }); expect(unknown.status()).toBe(404);
});

test('mobile widths, sticky names, keyboard controls, security headers and no polling', async ({ page, request }) => {
  const gets = []; page.on('request', (req) => { if (req.url().includes('/api/room')) gets.push(req.url()); });
  await open(page); await add(page, 'Émile');
  const check = row(page, 'Émile').locator('.response').first();
  await check.focus(); await page.keyboard.press('Space');
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter'); await saved(page); await expect(check).toHaveAttribute('data-status', 'yes');
  await expect(page.locator('tfoot')).toContainText('Everyone available');
  for (const width of [320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    const name = width <= 650 ? page.locator('.mobile-day').first() : row(page, 'Émile').locator('th');
    const before = await name.boundingBox();
    await page.locator('.calendar-shell').evaluate((node) => { node.scrollLeft = 700; });
    const after = await name.boundingBox(); expect(Math.abs(after.x - before.x)).toBeLessThan(2);
    await page.locator('.calendar-shell').evaluate((node) => { node.scrollLeft = 0; });
    if ([375, 1280].includes(width)) await page.screenshot({ path: `test-results/calendar-${width}.png`, fullPage: true });
  }
  await page.waitForTimeout(1000); expect(gets).toHaveLength(1);
  const response = await request.get(origin());
  expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
  expect(response.headers()['referrer-policy']).toBe('no-referrer');
  const snapshot = await request.get(`${origin()}/api/room?room=game-night`, { headers: headers() });
  expect(snapshot.headers()['cache-control']).toBe('no-store');
});

test('four choices persist, reset clears, and keyboard/outside dismissal leaves the response unchanged', async ({ page, request }) => {
  await open(page); await add(page, 'Choices');
  const buttons = row(page, 'Choices').locator('.response');
  await expect(buttons).toHaveCount(10);
  const button = buttons.nth(9);
  for (const status of ['yes', 'no', 'maybe', null]) {
    await choose(page, button, status); await saved(page);
    await page.reload();
    await expect(button).toHaveAttribute('data-status', status ?? 'blank');
    const person = (await api(request, 'room')).body.participants[0];
    expect(Object.values(person.responses)).toEqual(status ? [status] : []);
  }
  await button.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('data-status', 'blank');
  await button.click(); await page.mouse.click(2, 2);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await button.focus(); await page.keyboard.press('Enter');
  // Blank is initially focused; Shift+Tab chooses Maybe.
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Enter'); await saved(page);
  await expect(button).toHaveAttribute('data-status', 'maybe');
  await expect(page.locator('tfoot')).not.toContainText('Everyone available');
  await expect(page.locator('tfoot')).toContainText('1 maybe');
});

test('portrait calendar stacks names, keeps stars on the left, and edits the correct date/person after rotation', async ({ page, request }) => {
  await api(request, 'participants', 'POST', { name: 'Steve' });
  for (const name of ['Ada', 'Bob', 'Émile', 'Morgan', 'Jo', 'Li', 'Sam', 'Alexandertheunexpectedlylong', 'Kai']) {
    await api(request, 'participants', 'POST', { name });
  }
  await page.setViewportSize({ width: 375, height: 740 }); await open(page);
  await expect(page.locator('#calendar')).toHaveClass('calendar-compact');
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await expect(page.locator('thead .person-heading')).toHaveCount(10);
  await expect(page.locator('tbody tr').first().locator('.response')).toHaveCount(10);
  const steve = page.getByRole('button', { name: 'Highlight Steve', exact: true });
  expect(await steve.evaluate((node) => getComputedStyle(node).writingMode)).toBe('vertical-rl');
  expect(await steve.evaluate((node) => getComputedStyle(node).textOrientation)).toBe('upright');
  const date = page.locator('.mobile-day').first(); const dateBefore = await date.boundingBox();
  const headingBefore = await steve.boundingBox();
  await page.locator('.calendar-shell').evaluate((node) => { node.scrollLeft = 500; node.scrollTop = 160; });
  expect(Math.abs((await date.boundingBox()).x - dateBefore.x)).toBeLessThan(2);
  expect(Math.abs((await steve.boundingBox()).y - headingBefore.y)).toBeLessThan(2);
  await page.locator('.calendar-shell').evaluate((node) => { node.scrollLeft = 0; node.scrollTop = 0; });
  await page.route('**/api/availability', async (route) => { await new Promise((resolve) => setTimeout(resolve, 300)); await route.continue(); });
  const check = page.getByRole('button', { name: /^Steve on/ }).first();
  expect((await page.locator('.star').first().boundingBox()).x).toBeLessThan((await check.boundingBox()).x);
  await choose(page, check, 'yes');
  await page.setViewportSize({ width: 1280, height: 900 });
  await saved(page); await expect(check).toHaveAttribute('data-status', 'yes');
  await page.setViewportSize({ width: 375, height: 850 });
  await expect(page.locator('#calendar')).toHaveClass('calendar-compact');
  await expect(check).toHaveAttribute('data-status', 'yes');
  await expect(page.locator('.date-summary').first()).toHaveText('1/10 · 0 maybe');
  await page.locator('.star').first().click(); await saved(page);
  await page.reload(); await expect(check).toHaveAttribute('data-status', 'yes');
  await expect(page.locator('.star').first()).toHaveAttribute('aria-pressed', 'true');
  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  }
  await page.setViewportSize({ width: 375, height: 850 });
  await page.screenshot({ path: 'test-results/portrait-calendar-10-people.png', fullPage: true });
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove Ada', exact: true }).click();
  await expect(page.locator('thead .person-heading')).toHaveCount(9);
  const { body } = await api(request, 'room');
  expect(body.participants.find((person) => person.name === 'Steve').available).toEqual([body.dates[0]]);
  expect(body.participants.some((person) => person.name === 'Ada')).toBeFalsy();
});
