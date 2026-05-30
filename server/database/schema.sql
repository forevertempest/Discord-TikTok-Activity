
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id               TEXT    PRIMARY KEY,
  discord_id       TEXT    NOT NULL UNIQUE,
  username         TEXT    NOT NULL,
  display_name     TEXT,
  avatar_url       TEXT,
  bio              TEXT    NOT NULL DEFAULT '',
  is_private       INTEGER NOT NULL DEFAULT 0,
  is_banned        INTEGER NOT NULL DEFAULT 0,
  ban_reason       TEXT,
  upload_disabled  INTEGER NOT NULL DEFAULT 0,
  last_seen_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_users_discord_id ON users(discord_id);

CREATE TABLE IF NOT EXISTS videos (
  id             TEXT    PRIMARY KEY,
  user_id        TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT    NOT NULL,
  description    TEXT    NOT NULL DEFAULT '',
  media_type     TEXT    NOT NULL DEFAULT 'video'
                   CHECK(media_type IN ('video','photo')),
  media_paths    TEXT,
  file_path      TEXT    NOT NULL,
  thumb_path     TEXT,
  duration_sec   REAL,
  size_bytes     INTEGER,
  status         TEXT    NOT NULL DEFAULT 'pending'
                   CHECK(status IN ('pending','approved','rejected','deleted')),
  reject_reason  TEXT,
  views          INTEGER NOT NULL DEFAULT 0,
  moderated_at   INTEGER,
  moderated_by   TEXT,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_videos_user_id  ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_status   ON videos(status);
CREATE INDEX IF NOT EXISTS idx_videos_created  ON videos(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_status_created ON videos(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_user_status_created ON videos(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS video_tags (
  video_id TEXT    NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id)   ON DELETE CASCADE,
  PRIMARY KEY (video_id, tag_id)
);

CREATE TABLE IF NOT EXISTS likes (
  user_id    TEXT    NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  video_id   TEXT    NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_likes_video_id ON likes(video_id);
CREATE INDEX IF NOT EXISTS idx_likes_user_created ON likes(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS favorites (
  user_id    TEXT    NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  video_id   TEXT    NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, video_id)
);
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_video_id ON favorites(video_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user_created ON favorites(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT    PRIMARY KEY,
  video_id   TEXT    NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id    TEXT    NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  body       TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_comments_video_id ON comments(video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_user_id  ON comments(user_id);

CREATE TABLE IF NOT EXISTS follows (
  follower_id  TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id != following_id)
);
CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows(following_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower_id  ON follows(follower_id);

CREATE TABLE IF NOT EXISTS user_warnings (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_discord_id TEXT    NOT NULL,
  reason           TEXT    NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_user_warnings_user_id ON user_warnings(user_id);
CREATE INDEX IF NOT EXISTS idx_warnings_user_created ON user_warnings(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_moderation_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_discord_id TEXT    NOT NULL,
  action           TEXT    NOT NULL CHECK(action IN ('warn','ban','unban','reset')),
  reason           TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_user_modlog_user_id ON user_moderation_log(user_id);

CREATE TABLE IF NOT EXISTS moderation_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id         TEXT    NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  admin_discord_id TEXT    NOT NULL,
  action           TEXT    NOT NULL CHECK(action IN ('approved','rejected','deleted')),
  reason           TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_modlog_video_id ON moderation_log(video_id);
CREATE INDEX IF NOT EXISTS idx_modlog_admin    ON moderation_log(admin_discord_id);
CREATE INDEX IF NOT EXISTS idx_modlog_created  ON moderation_log(created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type TEXT    NOT NULL CHECK(target_type IN ('video','user')),
  target_id   TEXT    NOT NULL,
  reason      TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'open'
                CHECK(status IN ('open','reviewed','dismissed')),
  reviewed_by TEXT,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reports_status  ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL,
  payload    TEXT    NOT NULL DEFAULT '{}',
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_notif_user_id ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_user_type_created ON notifications(user_id, type, created_at DESC);

CREATE TABLE IF NOT EXISTS direct_messages (
  id           TEXT    PRIMARY KEY,
  sender_id    TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT    NOT NULL DEFAULT '',
  video_id     TEXT    REFERENCES videos(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_dm_pair ON direct_messages(sender_id, recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_recipient ON direct_messages(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_recipient_sender_created ON direct_messages(recipient_id, sender_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id != blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked_id ON user_blocks(blocked_id);
