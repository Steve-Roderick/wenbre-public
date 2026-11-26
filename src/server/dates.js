export function roomToday(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// UTC is only a container for calendar arithmetic; no room-local seconds are added.
export function addDays(day, count) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function windowDates(timezone, now = new Date()) {
  const today = roomToday(timezone, now);
  return Array.from({ length: 10 }, (_, index) => addDays(today, index));
}
