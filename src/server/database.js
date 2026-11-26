import { HttpError } from './validation.js';

export async function readRoom(db, room, dates) {
  // A D1 batch is transactional: all parts of a complete room snapshot agree.
  const result = await db.batch([
    db.prepare('SELECT id, name FROM participants WHERE room_id = ? ORDER BY id').bind(room.id),
    db.prepare(`SELECT a.participant_id, a.day, a.status FROM availability a JOIN participants p ON p.id = a.participant_id
      WHERE p.room_id = ? AND a.day BETWEEN ? AND ?`).bind(room.id, dates[0], dates.at(-1)),
    db.prepare('SELECT day FROM stars WHERE room_id = ? AND day BETWEEN ? AND ? ORDER BY day').bind(room.id, dates[0], dates.at(-1))
  ]);
  return {
    room, dates,
    participants: result[0].results.map((p) => ({ ...p, available: result[1].results.filter((a) => a.participant_id === p.id && a.status === 'yes').map((a) => a.day), responses: Object.fromEntries(result[1].results.filter((a) => a.participant_id === p.id).map((a) => [a.day, a.status])) })),
    stars: result[2].results.map((s) => s.day)
  };
}

export async function addParticipant(db, room, name, normalized) {
  try {
    return await db.prepare('INSERT INTO participants (room_id, name, normalized_name) VALUES (?, ?, ?) RETURNING id, name')
      .bind(room, name, normalized).first();
  } catch (error) {
    if (String(error.message).includes('room_full')) {
      throw new HttpError(409, 'room_full', 'This room already has 10 people.');
    }
    if (String(error.message).includes('UNIQUE constraint failed')) {
      throw new HttpError(409, 'duplicate_name', 'That name is already in the room.');
    }
    throw error;
  }
}
export async function requireParticipant(db, room, id) {
  const participant = await db.prepare('SELECT id FROM participants WHERE room_id = ? AND id = ?').bind(room, id).first();
  if (!participant) throw new HttpError(404, 'participant_missing', 'That person is no longer in the room. Refresh to see who is here.');
}
