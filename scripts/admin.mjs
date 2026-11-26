import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { rooms, findRoom } from '../src/server/config.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export function parseOptions(args, needsRoom = true) {
  const flags = new Set();
  let room;
  let base;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--base-url') {
      if (base || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Supply one --base-url URL.');
      base = args[++i];
    } else if (['--local', '--production', '--confirm'].includes(arg)) {
      if (flags.has(arg)) throw new Error(`Duplicate option: ${arg}`);
      flags.add(arg);
    } else if (!arg.startsWith('-') && needsRoom && !room) room = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (flags.has('--local') === flags.has('--production')) throw new Error('Choose exactly one target: --local or --production.');
  if (needsRoom && !findRoom(room)) throw new Error('Choose a room approved in config/rooms.json.');
  const production = flags.has('--production');
  if (production) {
    const config = JSON.parse(readFileSync(join(root, 'wrangler.jsonc'), 'utf8'));
    if (config.d1_databases[0].database_id === '00000000-0000-0000-0000-000000000000') {
      throw new Error('Create production D1 and replace the placeholder database_id in wrangler.jsonc first.');
    }
  }
  return { room, production, confirm: flags.has('--confirm'), base };
}
export function shareBase(options) {
  if (options.production && !options.base) throw new Error('Production commands require --base-url https://your-site.example.');
  let url;
  try { url = new URL(options.base || 'http://localhost:8788'); }
  catch { throw new Error('Invalid --base-url.'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (options.production ? url.protocol !== 'https:' : !['http:', 'https:'].includes(url.protocol))) {
    throw new Error('Use a bare site origin; production requires HTTPS.');
  }
  return url.origin;
}
export function execute(options, sql) {
  // Remote --file uses the D1 bulk-import API: it returns import statistics,
  // not SELECT/RETURNING rows. --command uses the query API in both environments.
  // Only validated room IDs and hashes are sent; the plaintext secret never is.
  const result = spawnSync(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'),
    'd1', 'execute', 'DB', options.production ? '--remote' : '--local', '--command', sql, '--json'], {
    cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(root, '.wrangler/logs') }
  });
  if (result.error || result.status !== 0) {
    throw new Error('D1 operation failed. Check the target database, credentials, and applied migrations. No room link was issued.');
  }
  let results;
  try { results = JSON.parse(result.stdout); }
  catch { throw new Error('D1 returned an unexpected response. No room link was issued.'); }
  if (!Array.isArray(results) || results.some((result) => result.success === false)) throw new Error('D1 operation failed.');
  return results;
}
// Values are generated hashes or validated whitelist slugs. Always quote SQL literals.
export const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
export function newSecret() {
  const secret = randomBytes(32).toString('base64url');
  return { secret, hash: createHash('sha256').update(secret).digest('hex') };
}
export function printLink(options, base, secret) {
  console.log(`Target: ${options.production ? 'production' : 'local'} · ${options.room}`);
  console.log('Save this link now. Its key is shown once and grants full room access.');
  console.log(`${base}/#${new URLSearchParams({ room: options.room, key: secret })}`);
}
export function run(main) {
  try { main(parseOptions(process.argv.slice(2), !['list-rooms.mjs', 'cleanup.mjs'].some((name) => process.argv[1].endsWith(name)))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
export { rooms };
