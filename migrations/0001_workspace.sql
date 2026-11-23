CREATE TABLE IF NOT EXISTS workspace (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL
);

INSERT OR IGNORE INTO workspace (id, state)
VALUES (1, '{"collections":[],"cards":[],"session":null}');
