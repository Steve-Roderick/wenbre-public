import { ROOM_ID } from './config.js';

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const invalid = (message) => new HttpError(400, 'invalid_request', message);
export function roomId(value) {
  if (typeof value !== 'string' || value.length > 80 || !ROOM_ID.test(value)) throw invalid('Invalid room identifier.');
  return value;
}
export function participantId(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid('Invalid participant.');
  return value;
}
export function participantName(value) {
  if (typeof value !== 'string') throw invalid('Enter a name between 1 and 40 characters.');
  const name = value.trim().normalize('NFC');
  if ([...name].length < 1 || [...name].length > 40 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    throw invalid('Enter a name between 1 and 40 characters without control characters.');
  }
  return { name, normalized: name.toLowerCase() };
}
export function calendarDate(value, dates) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid('Invalid calendar date.');
  if (!dates.includes(value)) throw new HttpError(400, 'expired_date', 'That day is no longer in the calendar. Refresh to see the new dates.');
  return value;
}
export function booleanValue(value) {
  if (typeof value !== 'boolean') throw invalid('Expected true or false.');
  return value;
}
export async function readBody(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new HttpError(415, 'content_type', 'Send a JSON request.');
  }
  const max = 2048;
  if (Number(request.headers.get('content-length')) > max) throw new HttpError(413, 'too_large', 'The request is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw invalid('A JSON object is required.');
  const chunks = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > max) {
      await reader.cancel();
      throw new HttpError(413, 'too_large', 'The request is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw invalid('A valid JSON object is required.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('A JSON object is required.');
  return body;
}
