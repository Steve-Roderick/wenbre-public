import { json } from '../../src/server/http.js';
export function onRequest() {
  return json({ error: { code: 'not_found', message: 'This calendar action does not exist.' } }, 404);
}
