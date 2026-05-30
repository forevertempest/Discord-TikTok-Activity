const fs   = require('fs');
const path = require('path');
const db   = require('../config/database');

const schemaPath = path.join(__dirname, 'schema.sql');
const schema     = fs.readFileSync(schemaPath, 'utf8');

db.exec(schema);

function ensureColumn(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all()
    .some((row) => row.name === column);

  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[MIGRATE] Added ${table}.${column}`);
  }
}

ensureColumn('videos', 'media_type', "TEXT NOT NULL DEFAULT 'video'");
ensureColumn('videos', 'media_paths', 'TEXT');
ensureColumn('users', 'display_name', 'TEXT');
ensureColumn('users', 'last_seen_at', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'is_private', 'INTEGER NOT NULL DEFAULT 0');
db.exec("UPDATE videos SET media_type = 'video' WHERE media_type IS NULL OR media_type = ''");
db.exec("UPDATE users SET last_seen_at = unixepoch() WHERE last_seen_at IS NULL OR last_seen_at = 0");
db.exec(`
  UPDATE videos
  SET title = ' '
  WHERE lower(title) LIKE '%.mp4'
     OR lower(title) LIKE '%.mov'
     OR lower(title) LIKE '%.webm'
     OR lower(title) LIKE '%.jpg'
     OR lower(title) LIKE '%.jpeg'
     OR lower(title) LIKE '%.png'
     OR lower(title) LIKE '%.webp'
     OR lower(title) LIKE '%.gif'
`);
db.exec(`
  UPDATE users
  SET display_name = username
  WHERE display_name IS NULL OR display_name = ''
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS direct_messages (
    id           TEXT    PRIMARY KEY,
    sender_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body         TEXT    NOT NULL DEFAULT '',
    video_id     TEXT    REFERENCES videos(id) ON DELETE SET NULL,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_dm_pair ON direct_messages(sender_id, recipient_id, created_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_dm_recipient ON direct_messages(recipient_id, created_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_dm_recipient_sender_created ON direct_messages(recipient_id, sender_id, created_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_notif_user_created ON notifications(user_id, created_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_notif_user_type_created ON notifications(user_id, type, created_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_videos_status_created ON videos(status, created_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_videos_user_status_created ON videos(user_id, status, created_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_likes_user_created ON likes(user_id, created_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_favorites_user_created ON favorites(user_id, created_at DESC)');
db.exec('CREATE INDEX IF NOT EXISTS idx_warnings_user_created ON user_warnings(user_id, created_at DESC)');
db.exec(`
  CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_id TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id != blocked_id)
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_blocks_blocked_id ON user_blocks(blocked_id)');

console.log('[MIGRATE] Schema applied successfully.');
