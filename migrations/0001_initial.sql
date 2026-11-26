PRAGMA foreign_keys = ON;

CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    secret_hash TEXT NOT NULL CHECK (length(secret_hash) = 64),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (room_id, normalized_name)
);
CREATE TABLE availability (
    participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    PRIMARY KEY (participant_id, day)
);
CREATE TABLE stars (
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    PRIMARY KEY (room_id, day)
);
CREATE INDEX idx_participants_room ON participants(room_id);

-- The database enforces capacity even for simultaneous joins.
CREATE TRIGGER participants_capacity BEFORE INSERT ON participants
WHEN (SELECT count(*) FROM participants WHERE room_id = NEW.room_id) >= 10
BEGIN
    SELECT RAISE(ABORT, 'room_full');
END;
