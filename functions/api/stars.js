import { endpoint, json } from '../../src/server/http.js';
import { windowDates } from '../../src/server/dates.js';
import { calendarDate, booleanValue } from '../../src/server/validation.js';

export const onRequest = endpoint(['PUT'], async ({ env, room, body }) => {
  const day = calendarDate(body.date, windowDates(room.timezone));
  const value = booleanValue(body.starred);
  await env.DB.prepare(value
    ? 'INSERT INTO stars (room_id, day) VALUES (?, ?) ON CONFLICT DO NOTHING'
    : 'DELETE FROM stars WHERE room_id = ? AND day = ?').bind(room.id, day).run();
  return json({ date: day, starred: value });
});
