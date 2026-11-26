import { HttpError, readBody } from './validation.js';
import { authorize } from './auth.js';

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers
  } });
}
export function endpoint(methods, handler) {
  return async ({ request, env }) => {
    try {
      if (!methods.includes(request.method)) {
        return json({ error: { code: 'method_not_allowed', message: 'This action is not supported.' } }, 405, { Allow: methods.join(', ') });
      }
      const origin = request.headers.get('Origin');
      if ((origin && origin !== new URL(request.url).origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
        throw new HttpError(403, 'origin', 'Open this room from its original link.');
      }
      if (env.API_ENABLED !== 'true' || !env.DB) {
        throw new HttpError(503, 'api_unavailable', 'The calendar API is unavailable in this environment.');
      }
      const body = request.method === 'GET' ? null : await readBody(request);
      const id = body ? body.room : new URL(request.url).searchParams.get('room');
      const room = await authorize(request, env, id);
      return await handler({ request, env, room, body });
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: { code: error.code, message: error.message } }, error.status,
          error.status === 429 ? { 'Retry-After': '60' } : {});
      }
      // Never log Requests, authorization headers, bodies, raw SQL errors, or secrets.
      return json({ error: { code: 'unavailable', message: "The calendar couldn't be reached. Please try again." } }, 503);
    }
  };
}
