import { endpoint, json } from '../../src/server/http.js';
import { windowDates } from '../../src/server/dates.js';
import { participantId, calendarDate, booleanValue, invalid } from '../../src/server/validation.js';
import { requireParticipant } from '../../src/server/database.js';

export const onRequest = endpoint(['PUT'], async ({ env, room, body }) => {
  const id = participantId(body.participantId);
  const day = calendarDate(body.date, windowDates(room.timezone));
  if ('status' in body && 'available' in body) throw invalid('Send status or available, not both.');
  const value = 'status' in body ? body.status : (booleanValue(body.available) ? 'yes' : null);
  if (value !== null && !['yes', 'no', 'maybe'].includes(value)) throw invalid('Choose yes, no, maybe, or blank.');
  await requireParticipant(env.DB, room.id, id);
  if (value) {
    // Room membership is checked inside the write too, so concurrent deletion cannot create an orphan.
    await env.DB.prepare(`INSERT INTO availability (participant_id, day, status)
      SELECT id, ?, ? FROM participants WHERE room_id = ? AND id = ?
      ON CONFLICT (participant_id, day) DO UPDATE SET status = excluded.status`).bind(day, value, room.id, id).run();
  } else {
    await env.DB.prepare(`DELETE FROM availability WHERE participant_id = ? AND day = ?
      AND participant_id IN (SELECT id FROM participants WHERE room_id = ?)`)
      .bind(id, day, room.id).run();
  }
  await requireParticipant(env.DB, room.id, id);
  return json({ participantId: id, date: day, status: value, available: value === 'yes' });
});
