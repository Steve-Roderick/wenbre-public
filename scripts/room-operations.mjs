import { execute, quote, newSecret, shareBase, printLink, rooms } from './admin.mjs';
import { addDays, roomToday } from '../src/server/dates.js';

export function provisionRoom(options, sql = execute, output = printLink) {
  const base = shareBase(options);
  const existing = sql(options, `SELECT id FROM rooms WHERE id = ${quote(options.room)};`)[0].results;
  if (existing.length) throw new Error('This room is already provisioned. Use room:rotate to change its secret.');
  const { secret, hash } = newSecret();
  // Plain INSERT also refuses simultaneous provisioning; never overwrite a secret.
  sql(options, `INSERT INTO rooms (id, secret_hash) VALUES (${quote(options.room)}, ${quote(hash)});`);
  output(options, base, secret);
}
export function rotateRoom(options, sql = execute, output = printLink) {
  const base = shareBase(options);
  if (options.production && !options.confirm) throw new Error('Production rotation revokes the old link immediately. Run again with --confirm.');
  const { secret, hash } = newSecret();
  const rows = sql(options, `UPDATE rooms SET secret_hash = ${quote(hash)} WHERE id = ${quote(options.room)} RETURNING id;`)[0].results;
  if (!rows.length) throw new Error('This room is not provisioned. Use room:provision first.');
  output(options, base, secret);
}
export function listRooms(options, sql = execute, output = console.log) {
  const provisioned = new Set(sql(options, 'SELECT id FROM rooms;')[0].results.map((row) => row.id));
  output(`Target: ${options.production ? 'production' : 'local'}`);
  for (const room of rooms) output(`${room.id}\t${room.name}\t${provisioned.has(room.id) ? 'provisioned' : 'not provisioned'}`);
}
export function cleanup(options, sql = execute, output = console.log) {
  if (options.production && !options.confirm) throw new Error('Production cleanup removes history older than 30 days. Run again with --confirm.');
  for (const room of rooms) {
    const cutoff = quote(addDays(roomToday(room.timezone), -30));
    sql(options, `DELETE FROM availability WHERE day < ${cutoff} AND participant_id IN
      (SELECT id FROM participants WHERE room_id = ${quote(room.id)});
      DELETE FROM stars WHERE room_id = ${quote(room.id)} AND day < ${cutoff};`);
  }
  output('Removed records older than 30 room-local calendar days for approved rooms.');
}
