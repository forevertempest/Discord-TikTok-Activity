const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db      = require('../config/databaseAsync');
const auth    = require('../middleware/auth');
const { createNotification, getNotificationCategory, parsePayload, SYSTEM_TYPES } = require('../services/notifications');
const { ensureActiveUser } = require('../utils/guards');
const { withMediaUrls } = require('../utils/media');

const router = express.Router();

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function inClause(prefix, values, params) {
  return values.map((value, index) => {
    const key = `${prefix}${index}`;
    params[key] = value;
    return `@${key}`;
  }).join(', ');
}

function videoSelect(viewerId) {
  return `
    SELECT v.*, u.username, u.display_name, u.avatar_url,
           CASE WHEN u.last_seen_at >= unixepoch() - 90 THEN 1 ELSE 0 END as author_online,
           (SELECT COUNT(*) FROM likes WHERE video_id = v.id) as likes_count,
           (SELECT COUNT(*) FROM comments WHERE video_id = v.id) as comments_count,
           (SELECT COUNT(*) FROM favorites WHERE video_id = v.id) as favorites_count,
           ${viewerId ? `EXISTS(SELECT 1 FROM likes WHERE user_id = @viewerId AND video_id = v.id)` : '0'} as liked_by_me,
           ${viewerId ? `EXISTS(SELECT 1 FROM favorites WHERE user_id = @viewerId AND video_id = v.id)` : '0'} as favorited_by_me
    FROM videos v
    JOIN users u ON v.user_id = u.id
  `;
}

async function getStats(userId) {
  const stats = await db.get(`
    SELECT
      (SELECT COUNT(*) FROM follows WHERE following_id = @userId) as followers_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id = @userId) as following_count,
      (SELECT COUNT(*) FROM videos WHERE user_id = @userId AND status = 'approved') as published_count,
      (SELECT COUNT(*)
       FROM likes l
       JOIN videos v ON v.id = l.video_id
       WHERE v.user_id = @userId AND v.status = 'approved') as total_likes
  `, { userId });

  return stats || {
    followers_count: 0,
    following_count: 0,
    published_count: 0,
    total_likes: 0,
  };
}

async function getFriendState(viewerId, userId) {
  if (!viewerId || !userId || viewerId === userId) {
    return { following: false, followsMe: false, isFriend: false };
  }

  const [followingRow, followsMeRow] = await Promise.all([
    db.get('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?', [viewerId, userId]),
    db.get('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?', [userId, viewerId]),
  ]);

  const following = Boolean(followingRow);
  const followsMe = Boolean(followsMeRow);
  return {
    following,
    followsMe,
    isFriend: following && followsMe,
  };
}

async function getProfilePayload(userId, viewerId) {
  const user = await db.get(`
    SELECT id, discord_id, username, display_name, avatar_url,
           CASE WHEN is_banned = 1 THEN 'Аккаунт заблокирован' ELSE bio END as bio,
           is_private, is_banned, ban_reason, created_at,
           CASE WHEN last_seen_at >= unixepoch() - 90 THEN 1 ELSE 0 END as online
    FROM users
    WHERE id = @id OR discord_id = @id OR username = @id OR display_name = @id
  `, { id: userId });

  if (!user) return null;

  const blockedViewer = viewerId && await db.get(`
    SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?
  `, [user.id, viewerId]);

  if (blockedViewer && viewerId !== user.id) {
    return { blocked: true };
  }

  const ownProfile = user.id === viewerId;
  const params = { userId: user.id, viewerId };
  const [friendState, blockedByMeRow] = await Promise.all([
    getFriendState(viewerId, user.id),
    viewerId ? db.get('SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [viewerId, user.id]) : Promise.resolve(null),
  ]);
  const privateForViewer = Boolean(user.is_private) && !ownProfile && !friendState.isFriend;
  const publishedPromise = db.all(`
    ${videoSelect(viewerId)}
    WHERE v.user_id = @userId AND v.status = 'approved'
    ORDER BY v.created_at DESC
    LIMIT 60
  `, params);

  const likedPromise = ownProfile ? db.all(`
    ${videoSelect(viewerId)}
    JOIN likes own_likes ON own_likes.video_id = v.id
    WHERE own_likes.user_id = @userId AND v.status = 'approved'
    ORDER BY own_likes.created_at DESC
    LIMIT 60
  `, params) : Promise.resolve([]);

  const favoritesPromise = ownProfile ? db.all(`
    ${videoSelect(viewerId)}
    JOIN favorites own_favorites ON own_favorites.video_id = v.id
    WHERE own_favorites.user_id = @userId AND v.status = 'approved'
    ORDER BY own_favorites.created_at DESC
    LIMIT 60
  `, params) : Promise.resolve([]);

  const [publishedRows, likedRows, favoriteRows, stats] = await Promise.all([
    publishedPromise,
    likedPromise,
    favoritesPromise,
    getStats(user.id),
  ]);

  const publicUser = privateForViewer ? { ...user, bio: '' } : user;
  const publicStats = privateForViewer
    ? { ...stats, followers_count: null, following_count: null }
    : stats;

  return {
    user: publicUser,
    stats: publicStats,
    profile_private: privateForViewer,
    videos: {
      published: publishedRows.map(withMediaUrls),
      liked: likedRows.map(withMediaUrls),
      favorites: favoriteRows.map(withMediaUrls),
    },
    following: friendState.following,
    is_friend: friendState.isFriend,
    blocked_by_me: Boolean(blockedByMeRow),
  };
}

router.get('/me', auth, (req, res) => {
  res.json(req.user);
});

router.get('/me/profile', auth, async (req, res, next) => {
  try {
    const payload = await getProfilePayload(req.user.id, req.user.id);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get('/blocks', auth, async (req, res, next) => {
  try {
  const users = await db.all(`
    SELECT u.id, u.discord_id, u.username, u.display_name, u.avatar_url,
           CASE WHEN u.last_seen_at >= unixepoch() - 90 THEN 1 ELSE 0 END as online,
           b.created_at
    FROM user_blocks b
    JOIN users u ON u.id = b.blocked_id
    WHERE b.blocker_id = ?
    ORDER BY b.created_at DESC
  `, [req.user.id]);

  res.json(users);
  } catch (err) {
    next(err);
  }
});

router.get('/friends', auth, async (req, res, next) => {
  try {
  const friends = await db.all(`
    SELECT u.id, u.username, u.display_name, u.avatar_url,
           CASE WHEN u.last_seen_at >= unixepoch() - 90 THEN 1 ELSE 0 END as online
    FROM users u
    WHERE u.id != ?
      AND u.is_banned = 0
      AND EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id)
      AND EXISTS(SELECT 1 FROM follows WHERE follower_id = u.id AND following_id = ?)
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = u.id AND blocked_id = ?)
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = u.id)
    ORDER BY u.username COLLATE NOCASE ASC
    LIMIT 100
  `, [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]);

  res.json(friends);
  } catch (err) {
    next(err);
  }
});

router.get('/notifications', auth, async (req, res, next) => {
  try {
  const limit = clampInt(req.query.limit, 30, 1, 60);
  const offset = clampInt(req.query.offset, 0, 0, 100000);
  const category = req.query.category === 'system'
    ? 'system'
    : req.query.category === 'general'
      ? 'general'
      : '';
  const params = { userId: req.user.id, limit, offset };
  const systemTypes = [...SYSTEM_TYPES];
  const typeSql = inClause('type', systemTypes, params);
  const categorySql = category === 'system'
    ? `AND type IN (${typeSql})`
    : category === 'general'
      ? `AND type NOT IN (${typeSql})`
      : '';

  const rows = await db.all(`
    SELECT *
    FROM notifications
    WHERE user_id = @userId
      ${categorySql}
    ORDER BY created_at DESC
    LIMIT @limit OFFSET @offset
  `, params);

  const notifications = rows.map((row) => {
    const payload = parsePayload(row.payload);

    return {
      ...row,
      category: getNotificationCategory(row.type),
      payload,
    };
  });

  const actorIds = [...new Set(notifications.map((item) => item.payload.actor_id).filter(Boolean))];
  const videoIds = [...new Set(notifications.map((item) => item.payload.video_id).filter(Boolean))];
  const actorMap = new Map();
  const videoMap = new Map();

  if (actorIds.length > 0) {
    const actorParams = {};
    const actorSql = inClause('actor', actorIds, actorParams);
    const actors = await db.all(`
        SELECT id, username, display_name, avatar_url,
               CASE WHEN last_seen_at >= unixepoch() - 90 THEN 1 ELSE 0 END as online
        FROM users
        WHERE id IN (${actorSql})
      `, actorParams);
    actors.forEach((actor) => actorMap.set(actor.id, actor));
  }

  if (videoIds.length > 0) {
    const videoParams = {};
    const videoSql = inClause('video', videoIds, videoParams);
    const videos = await db.all(`
        SELECT v.*, u.username, u.display_name, u.avatar_url,
               (SELECT COUNT(*) FROM likes WHERE video_id = v.id) as likes_count,
               (SELECT COUNT(*) FROM comments WHERE video_id = v.id) as comments_count,
               (SELECT COUNT(*) FROM favorites WHERE video_id = v.id) as favorites_count
        FROM videos v
        JOIN users u ON v.user_id = u.id
        WHERE v.id IN (${videoSql})
      `, videoParams);
    videos.forEach((video) => videoMap.set(video.id, withMediaUrls(video)));
  }

  notifications.forEach((item) => {
    item.actor = item.payload.actor_id ? actorMap.get(item.payload.actor_id) || null : null;
    item.video = item.payload.video_id ? videoMap.get(item.payload.video_id) || null : null;
  });

  res.json(notifications);
  } catch (err) {
    next(err);
  }
});

async function getMessageVideo(videoId) {
  if (!videoId) return null;

  const video = await db.get(`
    SELECT v.*, u.username, u.display_name, u.avatar_url
    FROM videos v
    JOIN users u ON v.user_id = u.id
    WHERE v.id = ? AND v.status = 'approved'
  `, [videoId]);

  return video ? withMediaUrls(video) : null;
}

async function isMutualFriend(userId, friendId) {
  return Boolean(await db.get(`
    SELECT 1
    FROM users u
    WHERE u.id = ?
      AND u.is_banned = 0
      AND EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id)
      AND EXISTS(SELECT 1 FROM follows WHERE follower_id = u.id AND following_id = ?)
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = u.id AND blocked_id = ?)
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = u.id)
  `, [friendId, userId, userId, userId, userId]));
}

router.get('/conversations', auth, async (req, res, next) => {
  try {
  const limit = clampInt(req.query.limit, 30, 1, 60);
  const offset = clampInt(req.query.offset, 0, 0, 100000);
  const q = String(req.query.q || '').trim();
  const params = {
    viewerId: req.user.id,
    limit,
    offset,
    search: `%${q}%`,
    exact: q,
  };
  const friends = await db.all(`
    SELECT u.id, u.username, u.display_name, u.avatar_url,
           CASE WHEN u.last_seen_at >= unixepoch() - 90 THEN 1 ELSE 0 END as online,
           (
             SELECT dm.body
             FROM direct_messages dm
             WHERE (dm.sender_id = @viewerId AND dm.recipient_id = u.id)
                OR (dm.sender_id = u.id AND dm.recipient_id = @viewerId)
             ORDER BY dm.created_at DESC
             LIMIT 1
           ) as latest_body,
           (
             SELECT dm.video_id
             FROM direct_messages dm
             WHERE (dm.sender_id = @viewerId AND dm.recipient_id = u.id)
                OR (dm.sender_id = u.id AND dm.recipient_id = @viewerId)
             ORDER BY dm.created_at DESC
             LIMIT 1
           ) as latest_video_id,
           (
             SELECT dm.created_at
             FROM direct_messages dm
             WHERE (dm.sender_id = @viewerId AND dm.recipient_id = u.id)
                OR (dm.sender_id = u.id AND dm.recipient_id = @viewerId)
             ORDER BY dm.created_at DESC
             LIMIT 1
           ) as latest_created_at
    FROM users u
    WHERE u.id != @viewerId
      AND u.is_banned = 0
      AND (
        @exact = ''
        OR u.id = @exact
        OR u.discord_id = @exact
        OR u.username LIKE @search
        OR u.display_name LIKE @search
      )
      AND EXISTS(SELECT 1 FROM follows WHERE follower_id = @viewerId AND following_id = u.id)
      AND EXISTS(SELECT 1 FROM follows WHERE follower_id = u.id AND following_id = @viewerId)
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = u.id AND blocked_id = @viewerId)
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = @viewerId AND blocked_id = u.id)
    ORDER BY COALESCE(latest_created_at, 0) DESC, u.display_name COLLATE NOCASE ASC, u.username COLLATE NOCASE ASC
    LIMIT @limit OFFSET @offset
  `, params);

  const payload = await Promise.all(friends.map(async (friend) => ({
    ...friend,
    latest_video: await getMessageVideo(friend.latest_video_id),
  })));
  res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get('/conversations/:id/messages', auth, async (req, res, next) => {
  try {
  if (!await isMutualFriend(req.user.id, req.params.id)) {
    return res.status(403).json({ error: 'Личные сообщения доступны только друзьям' });
  }

  const limit = clampInt(req.query.limit, 40, 1, 80);
  const before = clampInt(req.query.before, 0, 0, 9999999999) || null;

  const rows = await db.all(`
    SELECT *
    FROM (
      SELECT dm.*, sender.username as sender_username, sender.display_name as sender_display_name, sender.avatar_url as sender_avatar_url
      FROM direct_messages dm
      JOIN users sender ON sender.id = dm.sender_id
      WHERE ((dm.sender_id = @viewerId AND dm.recipient_id = @friendId)
         OR (dm.sender_id = @friendId AND dm.recipient_id = @viewerId))
        AND (@before IS NULL OR dm.created_at < @before)
      ORDER BY dm.created_at DESC
      LIMIT @limit
    )
    ORDER BY created_at ASC
  `, { viewerId: req.user.id, friendId: req.params.id, before, limit });

  const payload = await Promise.all(rows.map(async (row) => ({
    ...row,
    video: await getMessageVideo(row.video_id),
  })));
  res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.post('/conversations/:id/messages', auth, async (req, res, next) => {
  if (!ensureActiveUser(req, res)) return;

  const body = String(req.body.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Сообщение пустое' });
  if (body.length > 500) return res.status(400).json({ error: 'Сообщение должно быть до 500 символов' });

  try {
  if (!await isMutualFriend(req.user.id, req.params.id)) {
    return res.status(403).json({ error: 'Личные сообщения доступны только друзьям' });
  }

  const id = uuidv4();
  await db.run(`
    INSERT INTO direct_messages (id, sender_id, recipient_id, body, video_id, created_at)
    VALUES (?, ?, ?, ?, NULL, unixepoch())
  `, [id, req.user.id, req.params.id, body]);

  createNotification(req.params.id, 'NEW_MESSAGE', {
    actor_id: req.user.id,
    actor_username: req.user.username,
    message_id: id,
    body,
  });

  const message = await db.get(`
    SELECT dm.*, sender.username as sender_username, sender.display_name as sender_display_name, sender.avatar_url as sender_avatar_url
    FROM direct_messages dm
    JOIN users sender ON sender.id = dm.sender_id
    WHERE dm.id = ?
  `, [id]);

  res.json({ ...message, video: null });
  } catch (err) {
    next(err);
  }
});

router.get('/search', auth, async (req, res, next) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const cleanQuery = q.replace(/^@+/, '');
  const normalizedQuery = cleanQuery || q;

  try {
  const users = await db.all(`
    SELECT u.id, u.discord_id, u.username, u.display_name, u.avatar_url, u.bio,
           u.is_private,
           CASE WHEN u.last_seen_at >= unixepoch() - 90 THEN 1 ELSE 0 END as online,
           EXISTS(SELECT 1 FROM follows WHERE follower_id = @viewerId AND following_id = u.id) as following,
           EXISTS(SELECT 1 FROM follows WHERE follower_id = u.id AND following_id = @viewerId) as follows_me,
           EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = @viewerId AND blocked_id = u.id) as blocked_by_me
    FROM users u
    WHERE u.id != @viewerId
      AND u.is_banned = 0
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = u.id AND blocked_id = @viewerId)
      AND (
        u.username LIKE @query
        OR u.username LIKE @cleanQuery
        OR u.display_name LIKE @query
        OR u.display_name LIKE @cleanQuery
        OR u.discord_id LIKE @query
        OR u.discord_id LIKE @cleanQuery
        OR u.id LIKE @query
        OR u.id LIKE @cleanQuery
      )
    ORDER BY u.display_name COLLATE NOCASE ASC, u.username COLLATE NOCASE ASC
    LIMIT 30
  `, { viewerId: req.user.id, query: `%${q}%`, cleanQuery: `%${normalizedQuery}%` });

  res.json(users.map((user) => ({
    ...user,
    is_friend: Boolean(user.following && user.follows_me),
  })).map((user) => ({
    ...user,
    bio: user.is_private && !user.is_friend ? '' : user.bio,
  })));
  } catch (err) {
    next(err);
  }
});

async function resolveUserId(value) {
  const id = String(value || '').replace(/^@+/, '');
  const user = await db.get(`
    SELECT id
    FROM users
    WHERE id = @id OR discord_id = @id OR username = @id OR display_name = @id
  `, { id });

  return user?.id || null;
}

async function getFollowList(targetId, viewerId, mode) {
  const relation = mode === 'followers'
    ? 'f.following_id = @targetId AND u.id = f.follower_id'
    : 'f.follower_id = @targetId AND u.id = f.following_id';

  const users = await db.all(`
    SELECT u.id, u.discord_id, u.username, u.display_name, u.avatar_url,
           CASE WHEN u.is_banned = 1 THEN 'Аккаунт заблокирован' ELSE u.bio END as bio,
           u.is_banned,
           CASE WHEN u.last_seen_at >= unixepoch() - 90 THEN 1 ELSE 0 END as online,
           EXISTS(SELECT 1 FROM follows WHERE follower_id = @viewerId AND following_id = u.id) as following,
           EXISTS(SELECT 1 FROM follows WHERE follower_id = u.id AND following_id = @viewerId) as follows_me,
           EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = @viewerId AND blocked_id = u.id) as blocked_by_me
    FROM follows f
    JOIN users u ON ${relation}
    WHERE NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = u.id AND blocked_id = @viewerId)
    ORDER BY f.created_at DESC
    LIMIT 200
  `, { targetId, viewerId });

  return users.map((user) => ({
    ...user,
    is_friend: Boolean(user.following && user.follows_me),
  }));
}

async function canViewRelations(targetId, viewerId) {
  if (targetId === viewerId) return true;
  const [target, friendState] = await Promise.all([
    db.get('SELECT is_private FROM users WHERE id = ?', [targetId]),
    getFriendState(viewerId, targetId),
  ]);
  return !target?.is_private || friendState.isFriend;
}

router.get('/:id/followers', auth, async (req, res, next) => {
  try {
  const targetId = await resolveUserId(req.params.id);
  if (!targetId) return res.status(404).json({ error: 'Пользователь не найден' });
  if (!await canViewRelations(targetId, req.user.id)) {
    return res.status(403).json({ error: 'Профиль закрыт' });
  }
  res.json(await getFollowList(targetId, req.user.id, 'followers'));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/following', auth, async (req, res, next) => {
  try {
  const targetId = await resolveUserId(req.params.id);
  if (!targetId) return res.status(404).json({ error: 'Пользователь не найден' });
  if (!await canViewRelations(targetId, req.user.id)) {
    return res.status(403).json({ error: 'Профиль закрыт' });
  }
  res.json(await getFollowList(targetId, req.user.id, 'following'));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/profile', auth, async (req, res, next) => {
  try {
  const payload = await getProfilePayload(req.params.id, req.user.id);
  if (!payload) return res.status(404).json({ error: 'Пользователь не найден' });
  if (payload.blocked) return res.status(404).json({ error: 'Профиль не найден' });
  res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/block', auth, async (req, res, next) => {
  if (!ensureActiveUser(req, res)) return;

  try {
  const target = await db.get(`
    SELECT id, username, display_name
    FROM users
    WHERE (id = @id OR discord_id = @id OR username = @id OR display_name = @id) AND is_banned = 0
  `, { id: req.params.id });

  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Нельзя заблокировать себя' });

  const existing = await db.get('SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [req.user.id, target.id]);
  let blocked;

  if (existing) {
    await db.run('DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?', [req.user.id, target.id]);
    blocked = false;
  } else {
    await db.transaction([
      {
        method: 'run',
        sql: 'INSERT INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, unixepoch())',
        params: [req.user.id, target.id],
      },
      {
        method: 'run',
        sql: 'DELETE FROM follows WHERE (follower_id = ? AND following_id = ?) OR (follower_id = ? AND following_id = ?)',
        params: [req.user.id, target.id, target.id, req.user.id],
      },
    ]);
    blocked = true;
  }

  res.json({ blocked });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/follow', auth, async (req, res, next) => {
  if (!ensureActiveUser(req, res)) return;

  try {
  const target = await db.get(`
    SELECT id, username, display_name
    FROM users
    WHERE (id = @id OR discord_id = @id OR username = @id OR display_name = @id) AND is_banned = 0
  `, { id: req.params.id });
  if (!target) return res.status(404).json({ error: 'Пользователь не найден' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'Нельзя подписаться на себя' });
  const blocked = await db.get(`
    SELECT 1 FROM user_blocks
    WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)
  `, [req.user.id, target.id, target.id, req.user.id]);
  if (blocked) return res.status(403).json({ error: 'Подписка недоступна из-за блокировки' });

  const existing = await db.get('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?', [req.user.id, target.id]);
  let following;

  if (existing) {
    await db.run('DELETE FROM follows WHERE follower_id = ? AND following_id = ?', [req.user.id, target.id]);
    following = false;
  } else {
    await db.run('INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, unixepoch())', [req.user.id, target.id]);
    following = true;

    createNotification(target.id, 'NEW_FOLLOW', {
      actor_id: req.user.id,
      actor_username: req.user.username,
    });
  }

  const followsMe = Boolean(await db.get('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?', [target.id, req.user.id]));
  const followersCount = (await db.get('SELECT COUNT(*) as count FROM follows WHERE following_id = ?', [target.id])).count;

  res.json({
    following,
    is_friend: following && followsMe,
    followers_count: followersCount,
  });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
  const user = await db.get(`
    SELECT id, discord_id, username, display_name, avatar_url,
           CASE WHEN is_banned = 1 THEN 'Аккаунт заблокирован' ELSE bio END as bio,
           is_private, is_banned, ban_reason, created_at
    FROM users
    WHERE id = @id OR discord_id = @id OR username = @id OR display_name = @id
  `, { id: req.params.id });

  if (!user) {
    return res.status(404).json({ error: 'Пользователь не найден' });
  }

  const stats = await getStats(user.id);
  res.json({
    ...user,
    bio: user.is_private ? '' : user.bio,
    stats: user.is_private ? { ...stats, followers_count: null, following_count: null } : stats,
    profile_private: Boolean(user.is_private),
  });
  } catch (err) {
    next(err);
  }
});

router.post('/me/update', auth, async (req, res, next) => {
  if (!ensureActiveUser(req, res)) return;

  const updates = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(req.body, 'bio')) {
    const bio = String(req.body.bio || '').trim();
    if (bio.length > 160) {
      return res.status(400).json({ error: 'Описание профиля должно быть до 160 символов' });
    }
    updates.push('bio = ?');
    params.push(bio);
  }

  if (Object.prototype.hasOwnProperty.call(req.body, 'is_private')) {
    updates.push('is_private = ?');
    params.push(req.body.is_private ? 1 : 0);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'Нет изменений' });
  }
  
  try {
    params.push(req.user.id);
    await db.run(`UPDATE users SET ${updates.join(', ')}, updated_at = unixepoch() WHERE id = ?`, params);
    const updated = await db.get('SELECT id, bio, is_private FROM users WHERE id = ?', [req.user.id]);

    res.json({ success: true, message: 'Профиль обновлен', user: { ...updated, is_private: Boolean(updated?.is_private) } });
  } catch (err) {
    console.error('[USER ERROR]', err);
    next(err);
  }
});

module.exports = router;
