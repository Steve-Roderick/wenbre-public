import { readFile, readdir } from 'node:fs/promises';
import { rooms } from '../src/server/config.js';

const root = new URL('../', import.meta.url);
const config = JSON.parse(await readFile(new URL('wrangler.jsonc', root), 'utf8'));
if (config.pages_build_output_dir !== './public') throw new Error('Only public/ may be published.');
if (config.env?.preview?.vars?.API_ENABLED !== 'false' || config.env.preview.d1_databases.length !== 0) {
  throw new Error('Preview APIs must default to disabled without a production D1 binding.');
}
const routes = JSON.parse(await readFile(new URL('public/_routes.json', root), 'utf8'));
if (JSON.stringify(routes) !== JSON.stringify({ version: 1, include: ['/api/*'], exclude: [] })) throw new Error('Only /api/* should invoke Functions.');
const allowed = new Set(['index.html', 'app.js', 'save-queue.js', 'style.css', 'favicon.svg', '_headers', '_routes.json']);
for (const name of await readdir(new URL('public/', root))) {
  if (!allowed.has(name)) throw new Error(`Unexpected published artifact: ${name}`);
  const text = await readFile(new URL(`public/${name}`, root), 'utf8');
  if (/innerHTML|setInterval|setTimeout|WebSocket|EventSource|https?:\/\/(?!www\.w3\.org)/.test(text)) throw new Error(`Unexpected unsafe rendering, background timer, or external resource in ${name}`);
}
if (process.env.CF_PAGES && config.d1_databases[0].database_id === '00000000-0000-0000-0000-000000000000') {
  throw new Error('Replace the production D1 database UUID before deploying.');
}
console.log(`Validated ${rooms.length} approved room(s), static boundary, preview isolation, and API routing.`);
