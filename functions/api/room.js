import { endpoint, json } from '../../src/server/http.js';
import { windowDates } from '../../src/server/dates.js';
import { readRoom } from '../../src/server/database.js';

export const onRequest = endpoint(['GET'], async ({ env, room }) => {
  return json(await readRoom(env.DB, room, windowDates(room.timezone)));
});
