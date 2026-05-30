const express = require('express');
const db      = require('../config/databaseAsync');
const auth    = require('../middleware/auth');
const admin   = require('../middleware/admin');
const { createNotification } = require('../services/notifications');
const { runChunked, runLater } = require('../services/jobs');
const { withMediaUrls } = require('../utils/media');
const { ADMIN_IDS } = require('../config/admins');

const router = express.Router();
const PROTECTED_MOD_ACTIONS = new Set(['warn', 'ban', 'reset']);

function cleanUserOps(userId) {
  return [
    ['DELETE FROM likes WHERE user_id = ?', [userId]],
    ['DELETE FROM favorites WHERE user_id = ?', [userId]],
    ['DELETE FROM follows WHERE follower_id = ? OR following_id = ?', [userId, userId]],
    ['DELETE FROM comments WHERE user_id = ?', [userId]],
    ['DELETE FROM direct_messages WHERE sender_id = ? OR recipient_id = ?', [userId, userId]],
    ['DELETE FROM likes WHERE video_id IN (SELECT id FROM videos WHERE user_id = ?)', [userId]],
    ['DELETE FROM favorites WHERE video_id IN (SELECT id FROM videos WHERE user_id = ?)', [userId]],
    ['DELETE FROM comments WHERE video_id IN (SELECT id FROM videos WHERE user_id = ?)', [userId]],
  ].map(([sql, params]) => ({ method: 'run', sql, params }));
}

router.get('/queue', auth, admin, async (req, res, next) => {
  const limit = Math.min(parseInt(req.query.limit || '40', 10), 100);
  try {
  const queue = await db.all(`
    SELECT v.*, u.username, u.display_name, u.avatar_url
    FROM videos v
    JOIN users u ON v.user_id = u.id
    WHERE v.status = 'pending'
    ORDER BY v.created_at ASC
    LIMIT ?
  `, [limit]);

  res.json(queue.map(withMediaUrls));
  } catch (err) {
    next(err);
  }
});

router.get('/videos', auth, admin, async (req, res, next) => {
  const status = String(req.query.status || 'approved');
  const limit = Math.min(parseInt(req.query.limit || '60', 10), 100);
  const allowed = new Set(['approved', 'deleted', 'rejected', 'pending']);

  if (!allowed.has(status)) {
    return res.status(400).json({ error: 'Некорректный статус' });
  }

  try {
  const videos = await db.all(`
    SELECT v.*, u.username, u.display_name, u.avatar_url,
           (SELECT COUNT(*) FROM likes WHERE video_id = v.id) as likes_count,
           (SELECT COUNT(*) FROM comments WHERE video_id = v.id) as comments_count,
           (SELECT COUNT(*) FROM favorites WHERE video_id = v.id) as favorites_count
    FROM videos v
    JOIN users u ON v.user_id = u.id
    WHERE v.status = ?
    ORDER BY v.created_at DESC
    LIMIT ?
  `, [status, limit]);

  res.json(videos.map(withMediaUrls));
  } catch (err) {
    next(err);
  }
});

router.get('/users', auth, admin, async (req, res, next) => {
  const q = String(req.query.q || '').trim();
  try {
  const users = await db.all(`
    SELECT u.id, u.discord_id, u.username, u.display_name, u.avatar_url, u.bio, u.is_banned, u.ban_reason,
           u.upload_disabled, u.created_at,
           (SELECT COUNT(*) FROM user_warnings WHERE user_id = u.id) as warnings_count,
           (SELECT COUNT(*) FROM follows WHERE following_id = u.id) as followers_count,
           (SELECT COUNT(*) FROM follows WHERE follower_id = u.id) as following_count,
           (SELECT COUNT(*) FROM videos WHERE user_id = u.id AND status = 'approved') as published_count,
           (SELECT COUNT(*)
            FROM likes l
            JOIN videos v ON v.id = l.video_id
            WHERE v.user_id = u.id AND v.status = 'approved') as total_likes
    FROM users u
    WHERE (@query = '' OR u.username LIKE @query OR u.display_name LIKE @query OR u.id LIKE @query OR u.discord_id LIKE @query)
    ORDER BY u.created_at DESC
    LIMIT 100
  `, { query: q ? `%${q}%` : '' });

  res.json(users.map((user) => ({
    ...user,
    is_admin: ADMIN_IDS.has(user.discord_id),
  })));
  } catch (err) {
    next(err);
  }
});

router.post('/videos/:id/review', auth, admin, async (req, res) => {
  const videoId = req.params.id;
  const { action, reason } = req.body;

  if (!['approved', 'rejected'].includes(action)) {
    return res.status(400).json({ error: 'Некорректное действие' });
  }

  try {
    const video = await db.get(`
      SELECT v.user_id, v.title, u.username, u.display_name
      FROM videos v
      JOIN users u ON u.id = v.user_id
      WHERE v.id = ? AND v.status = 'pending'
    `, [videoId]);

    if (!video) return res.status(404).json({ error: 'Публикация не найдена или уже обработана' });

    await db.transaction([
      {
        method: 'run',
        sql: `
        UPDATE videos
        SET status = ?, reject_reason = ?, moderated_at = unixepoch(), moderated_by = ?, updated_at = unixepoch()
        WHERE id = ? AND status = 'pending'
      `,
        params: [action, reason || null, req.user.discord_id, videoId],
      },
      {
        method: 'run',
        sql: `
        INSERT INTO moderation_log (video_id, admin_discord_id, action, reason, created_at)
        VALUES (?, ?, ?, ?, unixepoch())
      `,
        params: [videoId, req.user.discord_id, action, reason || null],
      },
    ]);

    runLater(`moderation:${videoId}`, async () => {
      await createNotification(video.user_id, 'MODERATION_DECISION', {
        video_id: videoId,
        status: action,
        reason: reason || null,
      });

      if (action !== 'approved') return;

      const friends = await db.all(`
        SELECT u.id
        FROM users u
        WHERE u.id != @authorId
          AND u.is_banned = 0
          AND EXISTS(SELECT 1 FROM follows WHERE follower_id = @authorId AND following_id = u.id)
          AND EXISTS(SELECT 1 FROM follows WHERE follower_id = u.id AND following_id = @authorId)
          AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = u.id AND blocked_id = @authorId)
          AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = @authorId AND blocked_id = u.id)
      `, { authorId: video.user_id });

      runChunked(`friend-video:${videoId}`, friends, (friend) => createNotification(friend.id, 'FRIEND_VIDEO', {
          video_id: videoId,
          actor_id: video.user_id,
          actor_username: video.username,
          actor_display_name: video.display_name || video.username,
      }));
    });

    res.json({ success: true, message: action === 'approved' ? 'Публикация одобрена' : 'Публикация отклонена' });
  } catch (err) {
    console.error('[ADMIN ERROR]', err);
    res.status(500).json({ error: 'Не удалось обработать решение модерации' });
  }
});

router.post('/videos/:id/delete', auth, admin, async (req, res) => {
  const videoId = req.params.id;
  const reason = String(req.body.reason || '').trim();

  try {
    const video = await db.get('SELECT id, user_id, status FROM videos WHERE id = ?', [videoId]);
    if (!video) return res.status(404).json({ error: 'Публикация не найдена' });

    await db.transaction([
      {
        method: 'run',
        sql: `
        UPDATE videos
        SET status = 'deleted', reject_reason = ?, moderated_at = unixepoch(), moderated_by = ?, updated_at = unixepoch()
        WHERE id = ?
      `,
        params: [reason || null, req.user.discord_id, videoId],
      },
      {
        method: 'run',
        sql: `
        INSERT INTO moderation_log (video_id, admin_discord_id, action, reason, created_at)
        VALUES (?, ?, 'deleted', ?, unixepoch())
      `,
        params: [videoId, req.user.discord_id, reason || null],
      },
    ]);

    runLater(`video-delete:${videoId}`, () => createNotification(video.user_id, 'VIDEO_DELETED', {
        video_id: videoId,
        reason: reason || null,
    }));

    res.json({ success: true, message: 'Публикация удалена' });
  } catch (err) {
    console.error('[ADMIN DELETE ERROR]', err);
    res.status(500).json({ error: 'Не удалось удалить публикацию' });
  }
});

router.post('/users/:id/action', auth, admin, async (req, res) => {
  const userId = req.params.id;
  const action = String(req.body.action || '');
  const reason = String(req.body.reason || '').trim();

  if (!['warn', 'ban', 'unban', 'reset'].includes(action)) {
    return res.status(400).json({ error: 'Некорректное действие' });
  }

  try {
    const user = await db.get('SELECT id, username, discord_id FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

    if (PROTECTED_MOD_ACTIONS.has(action) && ADMIN_IDS.has(user.discord_id)) {
      return res.status(403).json({ error: 'Нельзя выдавать предупреждения, банить или обнулять аккаунты модерации' });
    }

    const ops = [];

    if (action === 'warn') {
      ops.push({
        method: 'run',
        sql: `
          INSERT INTO user_warnings (user_id, admin_discord_id, reason, created_at)
          VALUES (?, ?, ?, unixepoch())
        `,
        params: [userId, req.user.discord_id, reason || 'Предупреждение'],
      });
    }

    if (action === 'ban') {
      ops.push({
        method: 'run',
        sql: `
          UPDATE users
          SET is_banned = 1, ban_reason = ?, upload_disabled = 1, updated_at = unixepoch()
          WHERE id = ?
        `,
        params: [reason || 'Заблокирован модерацией', userId],
      });
    }

    if (action === 'unban') {
      ops.push({
        method: 'run',
        sql: `
          UPDATE users
          SET is_banned = 0, ban_reason = NULL, upload_disabled = 0, updated_at = unixepoch()
          WHERE id = ?
        `,
        params: [userId],
      });
    }

    if (action === 'reset') {
      ops.push(
        {
          method: 'run',
          sql: "UPDATE videos SET status = 'deleted', updated_at = unixepoch() WHERE user_id = ?",
          params: [userId],
        },
        {
          method: 'run',
          sql: `
          UPDATE users
          SET bio = '', upload_disabled = 0, is_banned = 0, ban_reason = NULL, updated_at = unixepoch()
          WHERE id = ?
        `,
          params: [userId],
        },
      );
    }

    ops.push({
      method: 'run',
      sql: `
        INSERT INTO user_moderation_log (user_id, admin_discord_id, action, reason, created_at)
        VALUES (?, ?, ?, ?, unixepoch())
      `,
      params: [userId, req.user.discord_id, action, reason || null],
    });

    await db.transaction(ops);

    runLater(`user-action:${action}:${userId}`, async () => {
      if (action === 'warn') {
        await createNotification(userId, 'USER_WARNING', { reason: reason || null });
      }

      if (action === 'ban') {
        await db.transaction(cleanUserOps(userId));
        await createNotification(userId, 'ACCOUNT_BLOCKED', { reason: reason || null });
      }

      if (action === 'unban') {
        await createNotification(userId, 'ACCOUNT_UNBLOCKED', {});
      }

      if (action === 'reset') {
        await db.transaction(cleanUserOps(userId));
        await createNotification(userId, 'USER_RESET', { reason: reason || null });
      }
    });

    res.json({ success: true, message: 'Действие выполнено', username: user.username });
  } catch (err) {
    console.error('[ADMIN USER ERROR]', err);
    res.status(500).json({ error: 'Не удалось выполнить действие' });
  }
});

router.get('/logs', auth, admin, async (req, res, next) => {
  try {
  const logs = await db.all(`
    SELECT l.*, v.title as video_title, u.username as author_username
    FROM moderation_log l
    JOIN videos v ON l.video_id = v.id
    JOIN users u ON v.user_id = u.id
    ORDER BY l.created_at DESC
    LIMIT 50
  `);

  res.json(logs);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
