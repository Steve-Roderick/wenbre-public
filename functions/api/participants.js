import { endpoint, json } from '../../src/server/http.js';
import { participantId, participantName, HttpError } from '../../src/server/validation.js';
import { addParticipant } from '../../src/server/database.js';

export const onRequest = endpoint(['POST', 'DELETE'], async ({ request, env, room, body }) => {
  if (request.method === 'POST') {
    const { name, normalized } = participantName(body.name);
    const participant = await addParticipant(env.DB, room.id, name, normalized);
    return json({ ...participant, available: [], responses: {} }, 201);
  }
  const id = participantId(body.participantId);
  const deleted = await env.DB.prepare('DELETE FROM participants WHERE room_id = ? AND id = ? RETURNING id').bind(room.id, id).first();
  if (!deleted) throw new HttpError(404, 'participant_missing', 'That person is no longer in the room.');
  return json({ participantId: id, removed: true });
});
