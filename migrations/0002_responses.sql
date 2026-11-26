ALTER TABLE availability ADD COLUMN status TEXT NOT NULL DEFAULT 'yes' CHECK (status IN ('yes', 'no', 'maybe'));
