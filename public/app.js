import { SaveQueue } from './save-queue.js';

const $ = (id) => document.getElementById(id);
const fragment = new URLSearchParams(location.hash.slice(1));
const credentials = { room: fragment.get('room'), key: fragment.get('key') };
let state = null;
let locked = false;
let lastRefreshed = null;
let retryAction = null;
let selected = null;
const compactLayout = window.matchMedia('(max-width: 650px)');
try { selected = Number(localStorage.getItem(`wenbre:${credentials.room}`)) || null; } catch { /* Storage may be disabled. */ }

const dayFormatter = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short' });
const rangeFormatter = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' });
const lockedInFormatter = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
const asDate = (day) => new Date(`${day}T12:00:00Z`);
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
function notice(message, retry = null) {
  $('notice-message').textContent = message;
  $('notice').hidden = false;
  retryAction = retry;
  $('retry').hidden = !retry;
}
function clearNotice() { $('notice').hidden = true; retryAction = null; }
$('dismiss').addEventListener('click', clearNotice);
$('retry').addEventListener('click', () => { if (locked) return; const action = retryAction; clearNotice(); action?.(); });

async function api(path, method = 'GET', data) {
  let response;
  try {
    response = await fetch(`/api/${path}${method === 'GET' ? `?room=${encodeURIComponent(credentials.room)}` : ''}`, {
      method, headers: { Authorization: `Bearer ${credentials.key}`, ...(data ? { 'Content-Type': 'application/json' } : {}) },
      ...(data ? { body: JSON.stringify({ room: credentials.room, ...data }) } : {}), cache: 'no-store', credentials: 'same-origin'
    });
  } catch {
    throw new Error(method === 'GET' ? "Couldn't reach the room. Check your connection and try again."
      : "Couldn't save your change. Try again. If it still fails, refresh when you're connected.");
  }
  let body;
  try { body = await response.json(); } catch { throw new Error("The calendar couldn't be reached. Please try again."); }
  if (!response.ok) throw new Error(body.error?.message || "The calendar couldn't be reached. Please try again.");
  return body;
}

function updateControls() {
  const disabled = locked;
  $('refresh').disabled = disabled;
  $('retry').disabled = disabled;
  $('refresh').querySelector('span').textContent = locked ? 'Please wait…' : 'Refresh';
  $('join').disabled = disabled || !state || state.participants.length >= 10;
  $('name').disabled = disabled || !state || state.participants.length >= 10;
  document.querySelectorAll('.remove-person').forEach((button) => { button.disabled = disabled || queue.pending; });
  document.querySelectorAll('.star, .response, .select-person').forEach((control) => { control.disabled = disabled; });
  const failed = queue.failures.size;
  $('save-errors').hidden = failed === 0;
  $('retry-saves').disabled = disabled || queue.pending;
  if (failed) {
    const error = [...queue.failures.values()].at(-1).error;
    $('save-error-message').textContent = `${failed} ${failed === 1 ? 'change was' : 'changes were'} not saved. ${error.message} Retry changes, or Refresh to load saved state.`;
  }
  if (queue.pending) $('save-status').textContent = 'Saving changes…';
  else if (failed) $('save-status').textContent = `${failed} ${failed === 1 ? 'change' : 'changes'} not saved`;
  else if (locked) $('save-status').textContent = 'Loading…';
  else if ($('save-status').textContent === 'Loading…') $('save-status').textContent = '';
}
function findControl(key) {
  return [...document.querySelectorAll('[data-cell]')].find((node) => node.dataset.cell === key);
}
function displayCell(key, value, pending) {
  if (!state) return;
  const [type, id, day] = key.split('|');
  const control = findControl(key);
  if (type === 'a') {
    const person = state.participants.find((person) => person.id === Number(id));
    if (!person) return;
    person.available = person.available.filter((date) => date !== day);
    if (value === 'yes') person.available.push(day);
    if (value === null) delete person.responses[day];
    else person.responses[day] = value;
    if (control) paintResponse(control, value);
  } else {
    state.stars = state.stars.filter((date) => date !== day);
    if (value) state.stars.push(day);
    if (control) {
      control.setAttribute('aria-pressed', String(value));
      control.textContent = value ? '★' : '☆';
      control.closest('th').classList.toggle('starred', value);
    }
    renderLockedIn();
  }
  control?.classList.toggle('pending', pending);
  control?.classList.toggle('failed-save', queue.failures.has(key));
  if (queue.failures.has(key)) control?.setAttribute('aria-invalid', 'true');
  else control?.removeAttribute('aria-invalid');
  if (control) {
    if (pending) control.setAttribute('aria-busy', 'true');
    else control.removeAttribute('aria-busy');
  }
  renderSummary();
}
const queue = new SaveQueue({
  send: (payload, value) => api(payload.path, 'PUT', { ...payload.data, [payload.field]: value }),
  display: displayCell,
  busy: updateControls,
  failure: updateControls,
  saved: () => { if (!queue.failures.size) $('save-status').textContent = 'All changes saved'; }
});

const responseChoices = [['yes', '✓ Yes'], ['no', 'X No'], ['maybe', '~ Maybe'], [null, 'Blank']];
let activeResponse = null;
function paintResponse(button, value) {
  button.dataset.status = value ?? 'blank';
  button.textContent = { yes: '✓', no: 'X', maybe: '~' }[value] ?? '';
  button.setAttribute('aria-label', `${button.dataset.label}: ${responseChoices.find(([status]) => status === value)[1]}`);
}
function closeResponse() {
  $('response-picker').close();
  activeResponse?.button.focus();
  activeResponse = null;
}
for (const [value, label] of responseChoices) {
  const option = element('button', 'response-option', label); option.type = 'button';
  option.dataset.status = value ?? 'blank';
  option.addEventListener('click', () => {
    if (!activeResponse || locked) return;
    const { button, person, day } = activeResponse;
    clearNotice();
    queue.set(button.dataset.cell, person.responses[day] ?? null, value,
      { path: 'availability', data: { participantId: person.id, date: day }, field: 'status' });
    closeResponse();
  });
  $('response-options').append(option);
}
$('response-cancel').addEventListener('click', closeResponse);
$('response-picker').addEventListener('click', (event) => {
  if (event.target === $('response-picker')) {
    const rect = $('response-picker').getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeResponse();
  }
});
$('response-picker').addEventListener('cancel', (event) => { event.preventDefault(); closeResponse(); });

function renderLockedIn() {
  const dates = state.dates.filter((day) => state.stars.includes(day));
  const list = element('ul', 'locked-in-dates');
  for (const day of dates) {
    // The server's window starts at today in the room's timezone.
    const daysOut = state.dates.indexOf(day);
    const item = element('li');
    const date = element('time', 'locked-in-date', lockedInFormatter.format(asDate(day)));
    date.setAttribute('datetime', day);
    item.append(date, element('span', 'locked-in-countdown', ` (${daysOut} ${daysOut === 1 ? 'day' : 'days'} out)`));
    list.append(item);
  }
  $('locked-in').replaceChildren(...(dates.length ? [element('p', 'locked-in-title', 'Game night locked in'), list] : []));
  $('locked-in').hidden = dates.length === 0;
}
function daySummary(day) {
  const count = state.participants.filter((person) => person.available.includes(day)).length;
  const maybe = state.participants.filter((person) => person.responses[day] === 'maybe').length;
  return { count, maybe, all: count > 0 && count === state.participants.length };
}
function renderSummary() {
  const footer = $('calendar').querySelector('tfoot');
  if (compactLayout.matches) {
    for (const heading of $('calendar').querySelectorAll('.mobile-day')) {
      const { count, maybe, all } = daySummary(heading.dataset.day);
      const label = heading.querySelector('.date-summary');
      label.textContent = `${all ? '✓ all' : `${count}/${state.participants.length}`} · ${maybe} maybe`;
      label.setAttribute('aria-label', `${count} of ${state.participants.length} available${all ? ', everyone available' : ''}, ${maybe} maybe`);
      heading.classList.toggle('all-available', all);
    }
    footer.replaceChildren();
    return;
  }
  const row = element('tr');
  const label = element('th', '', 'At the table');
  label.scope = 'row'; row.append(label);
  for (const day of state.dates) {
    const { count, maybe, all } = daySummary(day);
    const cell = element('td', all ? 'all-available' : '');
    cell.append(element('strong', '', `${count} / ${state.participants.length}`));
    cell.append(element('span', 'summary-label', all ? 'Everyone available' : count ? 'Some available' : 'None available'));
    cell.append(element('span', 'summary-label', `${maybe} maybe`));
    row.append(cell);
  }
  footer.replaceChildren(row);
}
function markControl(control) {
  const key = control.dataset.cell;
  control.classList.toggle('pending', queue.cells.has(key));
  control.classList.toggle('failed-save', queue.failures.has(key));
  if (queue.cells.has(key)) control.setAttribute('aria-busy', 'true');
  if (queue.failures.has(key)) control.setAttribute('aria-invalid', 'true');
  return control;
}
function dateHeading(day, index) {
  const mobile = compactLayout.matches;
  const heading = element('th', `${mobile ? 'mobile-day ' : ''}${index === 0 ? 'today ' : ''}${state.stars.includes(day) ? 'starred' : ''}`.trim());
  heading.scope = mobile ? 'row' : 'col';
  heading.dataset.day = day;
  const date = element('div', 'date-label');
  date.append(element('span', 'day-label', dayFormatter.format(asDate(day)) + (index === 0 && !mobile ? ' · TODAY' : '')));
  date.append(element('span', 'day-number', String(Number(day.slice(8)))));
  if (index === 0) heading.setAttribute('aria-current', 'date');
  const star = element('button', 'star', state.stars.includes(day) ? '★' : '☆');
  star.type = 'button'; star.dataset.cell = `s||${day}`;
  star.setAttribute('aria-label', `Game night on ${rangeFormatter.format(asDate(day))}`);
  star.setAttribute('aria-pressed', String(state.stars.includes(day)));
  star.addEventListener('click', () => {
    clearNotice();
    const current = state.stars.includes(day);
    queue.set(star.dataset.cell, current, !current, { path: 'stars', data: { date: day }, field: 'starred' });
  });
  markControl(star);
  if (mobile) {
    date.append(element('span', 'date-summary'));
    const content = element('div', 'mobile-day-content');
    content.append(star, date); heading.append(content);
  } else heading.append(date, star);
  return heading;
}
function participantHeading(person) {
  const heading = element('th', compactLayout.matches ? 'person-heading' : '');
  heading.scope = compactLayout.matches ? 'col' : 'row';
  if (compactLayout.matches) heading.dataset.person = person.id;
  const label = element('div', 'participant-label');
  const select = element('button', 'select-person', person.name); select.type = 'button';
  select.title = person.name;
  select.setAttribute('aria-pressed', String(person.id === selected));
  select.setAttribute('aria-label', `Highlight ${person.name}`);
  select.addEventListener('click', () => {
    selected = person.id;
    try { localStorage.setItem(`wenbre:${credentials.room}`, String(selected)); } catch { /* Optional preference. */ }
    updateSelection();
  });
  const remove = element('button', 'remove-person', '×'); remove.type = 'button';
  remove.setAttribute('aria-label', `Remove ${person.name}`);
  remove.addEventListener('click', () => removePerson(person));
  label.append(select, remove); heading.append(label);
  return heading;
}
function availabilityCell(person, day) {
  const cell = element('td');
  if (compactLayout.matches) cell.dataset.person = person.id;
      const button = element('button', 'response'); button.type = 'button';
      button.dataset.cell = `a|${person.id}|${day}`;
      button.dataset.label = `${person.name} on ${rangeFormatter.format(asDate(day))}`;
      button.setAttribute('aria-haspopup', 'dialog');
      paintResponse(button, person.responses[day] ?? null);
      button.addEventListener('click', () => {
        if (locked) return;
        activeResponse = { button, person, day };
        $('response-title').textContent = button.dataset.label;
        $('response-picker').showModal();
        const value = person.responses[day] ?? null;
        [...$('response-picker').querySelectorAll('.response-option')][responseChoices.findIndex(([status]) => status === value)].focus();
      });
  cell.append(markControl(button));
  return cell;
}
function updateSelection() {
  for (const node of $('calendar').querySelectorAll('[data-person]')) {
    const active = Number(node.dataset.person) === selected;
    node.classList.toggle(compactLayout.matches ? 'selected-column' : 'selected-row', active);
    node.querySelector('.select-person')?.setAttribute('aria-pressed', String(active));
  }
}
function renderCalendar() {
  const focused = document.activeElement?.dataset?.cell;
  $('calendar').classList.toggle('calendar-compact', compactLayout.matches);
  $('calendar-shell').setAttribute('aria-label', compactLayout.matches
    ? 'Ten-day availability calendar, scroll horizontally for more people'
    : 'Ten-day availability calendar, scroll horizontally for more dates');
  const headings = element('tr');
  const firstHeading = element('th', '', compactLayout.matches ? 'DAY / FREE' : 'YOUR PEOPLE');
  firstHeading.scope = 'col'; headings.append(firstHeading);
  const rows = [];
  if (compactLayout.matches) {
    for (const person of state.participants) headings.append(participantHeading(person));
    for (const [index, day] of state.dates.entries()) {
      const row = element('tr'); row.dataset.day = day;
      row.append(dateHeading(day, index));
      for (const person of state.participants) row.append(availabilityCell(person, day));
      rows.push(row);
    }
  } else {
    for (const [index, day] of state.dates.entries()) headings.append(dateHeading(day, index));
    for (const person of state.participants) {
      const row = element('tr'); row.dataset.person = person.id;
      row.append(participantHeading(person));
      for (const day of state.dates) row.append(availabilityCell(person, day));
      rows.push(row);
    }
  }
  $('calendar').querySelector('thead').replaceChildren(headings);
  $('calendar').querySelector('tbody').replaceChildren(...rows);
  updateSelection();
  renderSummary();
  if (focused) findControl(focused)?.focus();
}
function render() {
  document.title = `${state.room.name} · Game Night`;
  $('entry').hidden = true; $('room').hidden = false;
  $('room-title').textContent = state.room.name;
  const first = rangeFormatter.format(asDate(state.dates[0]));
  const last = rangeFormatter.format(asDate(state.dates.at(-1)));
  $('date-range').textContent = `${first} – ${last} · ${state.dates[0].slice(0, 4)} · ${state.room.timezone.replace('America/Toronto', 'Canada/Toronto').replaceAll('_', ' ')}`;
  $('last-refreshed').textContent = lastRefreshed ? `Last refreshed: ${lastRefreshed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Not yet refreshed';
  renderLockedIn();
  renderCalendar();
  $('empty').hidden = state.participants.length !== 0;
  $('people-count').textContent = `${state.participants.length} / 10 people`;
  $('join-hint').textContent = state.participants.length >= 10 ? 'Room full. This room already has 10 people.' : '10 people max. Everyone with this link can edit.';
  updateControls();
}
compactLayout.addEventListener('change', () => {
  if (activeResponse) closeResponse();
  if (state) { renderCalendar(); updateControls(); }
});

async function refresh() {
  if (locked) return;
  locked = true; updateControls(); clearNotice();
  await queue.idle();
  try {
    const next = await api('room');
    state = next;
    queue.reconcile();
    lastRefreshed = new Date();
    render();
  } catch (error) {
    notice(state ? `Couldn't refresh. Showing the last loaded data. ${error.message}` : error.message, refresh);
    if (!state) $('entry-message').textContent = error.message;
  } finally { locked = false; updateControls(); }
}

async function removePerson(person) {
  if (locked || queue.pending || !confirm(`Remove ${person.name} and all their availability?`)) return;
  locked = true; updateControls(); clearNotice();
  try {
    await api('participants', 'DELETE', { participantId: person.id });
    state.participants = state.participants.filter((other) => other.id !== person.id);
    render();
  } catch (error) { notice(error.message, () => removePerson(person)); }
  finally { locked = false; updateControls(); }
}
$('join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (locked || state.participants.length >= 10) return;
  const name = $('name').value;
  locked = true; updateControls(); clearNotice();
  await queue.idle();
  try {
    const person = await api('participants', 'POST', { name });
    state.participants.push(person);
    selected = person.id;
    try { localStorage.setItem(`wenbre:${credentials.room}`, String(selected)); } catch { /* Optional preference. */ }
    $('name').value = ''; render();
  } catch (error) { notice(error.message, () => $('join-form').requestSubmit()); }
  finally { locked = false; updateControls(); }
});
$('refresh').addEventListener('click', refresh);
$('retry-saves').addEventListener('click', () => { if (!locked && !queue.pending) return queue.retryFailed(); });
window.addEventListener('beforeunload', (event) => {
  if (queue.pending || queue.failures.size || locked) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('hashchange', () => location.reload());
if (credentials.room && credentials.key) refresh();
else $('entry-message').textContent = 'connection pending. the group chat has the private link.';
