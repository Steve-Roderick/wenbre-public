import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';

export default async function setup() {
  const temporary = await mkdtemp(join(tmpdir(), 'wenbre-browser-'));
  const persist = join(temporary, 'state');
  const cli = resolve('node_modules/wrangler/bin/wrangler.js');
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG_PATH: join(temporary, 'logs'), WRANGLER_REGISTRY_PATH: join(temporary, 'registry') };
  let server;
  const cleanup = async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      const closed = once(server, 'exit');
      if (process.platform === 'win32') server.kill('SIGTERM');
      else process.kill(-server.pid, 'SIGTERM');
      await closed;
    }
    await rm(temporary, { recursive: true, force: true });
  };
  try {
    const run = (args) => execFileSync(process.execPath, [cli, ...args], { env, stdio: 'pipe' }).toString();
    run(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist]);
    const repeated = run(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist]);
    if (!repeated.includes('No migrations to apply')) throw new Error('Repeated migration did not report an up-to-date database.');
    const secret = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(secret).digest('hex');
    const sql = join(temporary, 'provision.sql');
    await writeFile(sql, `INSERT INTO rooms (id, secret_hash) VALUES ('game-night', '${hash}');`, { mode: 0o600 });
    run(['d1', 'execute', 'DB', '--local', '--persist-to', persist, '--file', sql]);
    const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
    const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
    const base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [cli, 'pages', 'dev', 'public', '--ip', '127.0.0.1',
      '--port', String(port), '--inspector-port', '0', '--persist-to', persist], { env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; server.stdout.on('data', (data) => { output += data; });
    server.stderr.on('data', (data) => { output += data; });
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (server.exitCode !== null || server.signalCode !== null) throw new Error(`Wrangler exited: ${output}`);
      try { ready = (await fetch(base)).ok; } catch { /* Server is still starting. */ }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!ready) throw new Error(`Wrangler did not start: ${output}`);
    process.env.WENBRE_BROWSER_ORIGIN = base;
    process.env.WENBRE_BROWSER_KEY = secret;
    return cleanup;
  } catch (error) { await cleanup(); throw error; }
}
