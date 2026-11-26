import configuration from '#rooms';

export const ROOM_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateConfig(config) {
  if (!config || !Array.isArray(config.rooms)) throw new Error('Expected a rooms array.');
  const seen = new Set();
  for (const room of config.rooms) {
    if (!room || typeof room.id !== 'string' || room.id.length > 80 || !ROOM_ID.test(room.id)) {
      throw new Error('Invalid room slug.');
    }
    if (seen.has(room.id)) throw new Error(`Duplicate room: ${room.id}`);
    seen.add(room.id);
    if (typeof room.name !== 'string' || !room.name.trim() || room.name.length > 100) {
      throw new Error(`Invalid display name: ${room.id}`);
    }
    if (typeof room.timezone !== 'string') throw new Error(`Missing timezone: ${room.id}`);
    try { new Intl.DateTimeFormat('en', { timeZone: room.timezone }).format(); }
    catch { throw new Error(`Invalid timezone: ${room.id}`); }
  }
  return config.rooms;
}

export const rooms = validateConfig(configuration);
export const findRoom = (id) => rooms.find((room) => room.id === id);
