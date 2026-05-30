const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const jwt     = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const db      = require('../config/databaseAsync');
const env     = require('../config/env');
const auth    = require('../middleware/auth');
const videoSvc = require('../services/video');
const { createNotification } = require('../services/notifications');
const { ensureActiveUser } = require('../utils/guards');
const { validateUploadedFile } = require('../utils/fileSafety');
const { withMediaUrls } = require('../utils/media');
const { ADMIN_IDS } = require('../config/admins');

const router = express.Router();
const MIME_EXTENSIONS = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};
const MB = 1024 * 1024;
const MAX_UPLOAD_FILE_SIZE_MB = Math.max(env.MAX_VIDEO_FILE_SIZE_MB, env.MAX_PHOTO_FILE_SIZE_MB);
const MAX_VIDEO_PIXELS = 3840 * 2160;
const MAX_VIDEO_DIMENSION = 4096;

function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function getFeedSeed(value) {
  return clampInt(value, Math.floor(Date.now() / 1000) % 1000000, 1, 1000000);
}

function stableJitterSql() {
  const id = "replace(v.id, '-', '')";
  return `(
    abs((
      coalesce(unicode(substr(${id}, 1, 1)), 0) * 97 +
      coalesce(unicode(substr(${id}, 4, 1)), 0) * 193 +
      coalesce(unicode(substr(${id}, 8, 1)), 0) * 389 +
      coalesce(unicode(substr(${id}, 12, 1)), 0) * 769 +
      coalesce(unicode(substr(${id}, 16, 1)), 0) * 1543 +
      coalesce(unicode(substr(${id}, 24, 1)), 0) * 3079 +
      v.created_at * 17 +
      @seed * 131
    ) % 100000) / 100000.0
  )`;
}

function feedScoreSql(hasViewer, randomWeight) {
  const engagementSql = `(
    (SELECT COUNT(*) FROM likes WHERE video_id = v.id) * 8 +
    (SELECT COUNT(*) FROM comments WHERE video_id = v.id) * 10 +
    (SELECT COUNT(*) FROM favorites WHERE video_id = v.id) * 6
  )`;
  const seenPenaltySql = hasViewer ? `(
    CASE
      WHEN EXISTS(SELECT 1 FROM likes WHERE user_id = @viewerId AND video_id = v.id)
        OR EXISTS(SELECT 1 FROM favorites WHERE user_id = @viewerId AND video_id = v.id)
      THEN 420 ELSE 0
    END
  )` : '0';

  return `(
    CASE
      WHEN v.created_at >= unixepoch() - 21600 THEN 7000
      WHEN v.created_at >= unixepoch() - 86400 THEN 6200
      WHEN v.created_at >= unixepoch() - 259200 THEN 5000
      WHEN v.created_at >= unixepoch() - 604800 THEN 3600
      WHEN v.created_at >= unixepoch() - 2592000 THEN 1600
      ELSE 300
    END
    + CASE WHEN ${engagementSql} > 900 THEN 900 ELSE ${engagementSql} END
    + (${stableJitterSql()} * ${randomWeight})
    - ${seenPenaltySql}
  )`;
}

async function getViewer(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;

  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET);
    return await db.get('SELECT id FROM users WHERE id = ?', [payload.sub]) || null;
  } catch (err) {
    return null;
  }
}

function getApprovedVideo(videoId) {
  return db.get(`
    SELECT v.*, u.username, u.display_name, u.avatar_url,
           CASE WHEN u.last_seen_at >= unixepoch() - 90 THEN 1 ELSE 0 END as author_online,
           (SELECT COUNT(*) FROM likes WHERE video_id = v.id) as likes_count,
           (SELECT COUNT(*) FROM comments WHERE video_id = v.id) as comments_count,
           (SELECT COUNT(*) FROM favorites WHERE video_id = v.id) as favorites_count
    FROM videos v
    JOIN users u ON v.user_id = u.id
    WHERE v.id = ? AND v.status = 'approved'
  `, [videoId]);
}

async function isBlockedPair(userId, otherUserId) {
  if (!userId || !otherUserId || userId === otherUserId) return false;
  return Boolean(await db.get(`
    SELECT 1 FROM user_blocks
    WHERE (blocker_id = ? AND blocked_id = ?)
       OR (blocker_id = ? AND blocked_id = ?)
  `, [userId, otherUserId, otherUserId, userId]));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(env.UPLOADS_DIR, file.mimetype.startsWith('image/') ? 'photos' : 'videos');
    fs.mkdir(dir, { recursive: true }, (err) => cb(err, dir));
  },
  filename: (req, file, cb) => {
    const ext = MIME_EXTENSIONS[file.mimetype] || '.bin';
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_FILE_SIZE_MB * MB,
    files: env.MAX_PHOTOS_PER_POST,
  },
  fileFilter: (req, file, cb) => {
    if (MIME_EXTENSIONS[file.mimetype]) cb(null, true);
    else cb(new Error('Поддерживаются только MP4, MOV, WEBM, JPG, PNG и WEBP.'));
  }
});

const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много загрузок. Подождите немного.' },
});

const uploadMedia = upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'photos', maxCount: env.MAX_PHOTOS_PER_POST },
  { name: 'media', maxCount: env.MAX_PHOTOS_PER_POST },
]);

function handleMediaUpload(req, res, next) {
  uploadMedia(req, res, (err) => {
    if (!err) return next();
    const files = [
      ...(req.files?.media || []),
      ...(req.files?.video || []),
      ...(req.files?.photos || []),
    ];
    cleanupFiles(files).catch(() => {});
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Файл слишком большой: видео до ${env.MAX_VIDEO_FILE_SIZE_MB} MB, фото до ${env.MAX_PHOTO_FILE_SIZE_MB} MB` });
      }

      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ error: `Можно загрузить одно видео или до ${env.MAX_PHOTOS_PER_POST} фото` });
      }
    }

    return res.status(400).json({ error: err.message || 'Не удалось загрузить файл' });
  });
}

async function cleanupFiles(files) {
  await Promise.all((files || []).map(async (file) => {
    if (!file?.path) return;
    try {
      await fs.promises.unlink(file.path);
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[UPLOAD CLEANUP WARN]', err.message);
    }
  }));
}

router.post('/upload', auth, uploadLimiter, handleMediaUpload, async (req, res) => {
  req.setTimeout(0);
  const files = [
    ...(req.files?.media || []),
    ...(req.files?.video || []),
    ...(req.files?.photos || []),
  ];

  if (req.user.is_banned || req.user.upload_disabled) {
    await cleanupFiles(files);
    return res.status(403).json({ error: 'Загрузка недоступна для этого аккаунта' });
  }

  const titleInput = String(req.body.title || '').trim();
  const descriptionInput = String(req.body.description || '').trim();

  if (titleInput.length > 15) {
    await cleanupFiles(files);
    return res.status(400).json({ error: 'Название должно быть до 15 символов' });
  }

  if (descriptionInput.length > 100) {
    await cleanupFiles(files);
    return res.status(400).json({ error: 'Описание должно быть до 100 символов' });
  }

  if (files.length === 0) {
    return res.status(400).json({ error: 'Выберите видео или фото' });
  }

  const videoFiles = files.filter((file) => file.mimetype.startsWith('video/'));
  const photoFiles = files.filter((file) => file.mimetype.startsWith('image/'));

  for (const file of files) {
    const validation = await validateUploadedFile(file);
    if (!validation.ok) {
      await cleanupFiles(files);
      return res.status(400).json({ error: validation.error });
    }
  }

  if ((videoFiles.length > 0 && photoFiles.length > 0) || videoFiles.length > 1) {
    await cleanupFiles(files);
    return res.status(400).json({ error: `Можно загрузить одно видео или до ${env.MAX_PHOTOS_PER_POST} фото без смешивания` });
  }

  if (photoFiles.length > env.MAX_PHOTOS_PER_POST) {
    await cleanupFiles(files);
    return res.status(400).json({ error: `Можно загрузить максимум ${env.MAX_PHOTOS_PER_POST} фото` });
  }

  const oversizedVideo = videoFiles.find((file) => file.size > env.MAX_VIDEO_FILE_SIZE_MB * MB);
  if (oversizedVideo) {
    await cleanupFiles(files);
    return res.status(400).json({ error: `Видео должно быть до ${env.MAX_VIDEO_FILE_SIZE_MB} MB` });
  }

  const oversizedPhoto = photoFiles.find((file) => file.size > env.MAX_PHOTO_FILE_SIZE_MB * MB);
  if (oversizedPhoto) {
    await cleanupFiles(files);
    return res.status(400).json({ error: `Каждое фото должно быть до ${env.MAX_PHOTO_FILE_SIZE_MB} MB` });
  }

  const photosTotalSize = photoFiles.reduce((sum, file) => sum + file.size, 0);
  if (photosTotalSize > env.MAX_PHOTO_TOTAL_SIZE_MB * MB) {
    await cleanupFiles(files);
    return res.status(400).json({ error: `Фото-пост должен быть до ${env.MAX_PHOTO_TOTAL_SIZE_MB} MB суммарно` });
  }

  const thumbDir = path.join(env.UPLOADS_DIR, 'thumbnails');

  try {
    await fs.promises.mkdir(thumbDir, { recursive: true });
    const videoId = uuidv4();
    let mediaType;
    let mediaPaths;
    let filePath;
    let thumbPath;
    let title;
    let duration = null;
    let totalSize = files.reduce((sum, file) => sum + file.size, 0);
    let sourceVideoPath = null;

    if (videoFiles.length === 1) {
      const videoFile = videoFiles[0];
      const videoPath = videoFile.path;
      const clientDuration = Number.parseFloat(req.body.duration_sec || req.body.duration || '');
      duration = Number.isFinite(clientDuration) && clientDuration > 0 ? clientDuration : null;

      try {
        const metadata = await videoSvc.getVideoMetadata(videoPath);
        const probedDuration = Number(metadata?.format?.duration || 0);
        if (Number.isFinite(probedDuration) && probedDuration > 0) duration = probedDuration;

        const videoStream = metadata?.streams?.find((stream) => stream.codec_type === 'video');
        const width = Number(videoStream?.width || 0);
        const height = Number(videoStream?.height || 0);
        if (!videoStream || width <= 0 || height <= 0) {
          await cleanupFiles(files);
          return res.status(400).json({ error: 'Файл не содержит видеодорожку.' });
        }

        if (width > MAX_VIDEO_DIMENSION || height > MAX_VIDEO_DIMENSION || width * height > MAX_VIDEO_PIXELS) {
          await cleanupFiles(files);
          return res.status(400).json({ error: 'Видео слишком большое по разрешению. Максимум 4K.' });
        }
      } catch (err) {
        await cleanupFiles(files);
        return res.status(400).json({ error: 'Не удалось прочитать видео. Попробуйте другой файл.' });
      }

      if (duration && duration > env.MAX_VIDEO_DURATION_SEC) {
        await cleanupFiles(files);
        return res.status(400).json({ error: `Видео слишком длинное, максимум ${env.MAX_VIDEO_DURATION_SEC} секунд` });
      }

      mediaType = 'video';
      filePath = `videos/${path.basename(videoPath)}`;
      mediaPaths = [filePath];
      thumbPath = null;
      title = titleInput || ' ';
      sourceVideoPath = videoPath;
    } else {
      mediaType = 'photo';
      mediaPaths = photoFiles.map((file) => `photos/${path.basename(file.path)}`);
      filePath = mediaPaths[0];
      thumbPath = filePath;
      title = titleInput || ' ';
    }

    await db.run(`
      INSERT INTO videos (id, user_id, title, description, media_type, media_paths, file_path, thumb_path, duration_sec, size_bytes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', unixepoch(), unixepoch())
    `, [
      videoId,
      req.user.id,
      title,
      descriptionInput,
      mediaType,
      JSON.stringify(mediaPaths),
      filePath,
      thumbPath,
      duration,
      totalSize
    ]);

    res.json({
      success: true,
      message: 'Публикация загружена и отправлена на модерацию',
      videoId
    });

    if (sourceVideoPath) {
      videoSvc.generateThumbnail(sourceVideoPath, thumbDir)
        .then((thumbFilename) => {
          return db.run('UPDATE videos SET thumb_path = ?, updated_at = unixepoch() WHERE id = ?', [`thumbnails/${thumbFilename}`, videoId]);
        })
        .catch((err) => {
          console.warn('[UPLOAD WARN] Не удалось создать превью видео:', err.message);
        });
    }

  } catch (err) {
    console.error('[UPLOAD ERROR]', err);
    await cleanupFiles(files);
    res.status(500).json({ error: 'Не удалось обработать файл' });
  }
});

router.get('/trending', async (req, res, next) => {
  const limit = clampInt(req.query.limit, 10, 1, 60);
  const offset = clampInt(req.query.offset, 0, 0, 100000);
  const seed = getFeedSeed(req.query.seed);

  try {
    const viewer = await getViewer(req);
    const scoreSql = feedScoreSql(Boolean(viewer), 1800);
    const videos = await db.all(`
      SELECT v.*, u.username, u.display_name, u.avatar_url,
           (SELECT COUNT(*) FROM likes WHERE video_id = v.id) as likes_count,
           (SELECT COUNT(*) FROM comments WHERE video_id = v.id) as comments_count,
           (SELECT COUNT(*) FROM favorites WHERE video_id = v.id) as favorites_count,
           ${viewer ? `EXISTS(SELECT 1 FROM likes WHERE user_id = @viewerId AND video_id = v.id)` : '0'} as liked_by_me,
           ${viewer ? `EXISTS(SELECT 1 FROM favorites WHERE user_id = @viewerId AND video_id = v.id)` : '0'} as favorited_by_me,
           ${viewer ? `EXISTS(SELECT 1 FROM follows WHERE follower_id = @viewerId AND following_id = v.user_id)` : '0'} as following_author
    FROM videos v
    JOIN users u ON v.user_id = u.id
    WHERE v.status = 'approved'
      ${viewer ? `AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = @viewerId AND blocked_id = v.user_id)
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = v.user_id AND blocked_id = @viewerId)` : ''}
    ORDER BY ${scoreSql} DESC, v.created_at DESC
    LIMIT @limit OFFSET @offset
    `, { viewerId: viewer?.id, limit, offset, seed });

    res.json(videos.map(withMediaUrls));
  } catch (err) {
    next(err);
  }
});

router.get('/following', auth, async (req, res, next) => {
  const limit = clampInt(req.query.limit, 10, 1, 60);
  const offset = clampInt(req.query.offset, 0, 0, 100000);
  const seed = getFeedSeed(req.query.seed);
  const viewerId = req.user.id;

  try {
    const scoreSql = feedScoreSql(true, 1200);
    const videos = await db.all(`
      SELECT v.*, u.username, u.display_name, u.avatar_url,
           (SELECT COUNT(*) FROM likes WHERE video_id = v.id) as likes_count,
           (SELECT COUNT(*) FROM comments WHERE video_id = v.id) as comments_count,
           (SELECT COUNT(*) FROM favorites WHERE video_id = v.id) as favorites_count,
           EXISTS(SELECT 1 FROM likes WHERE user_id = @viewerId AND video_id = v.id) as liked_by_me,
           EXISTS(SELECT 1 FROM favorites WHERE user_id = @viewerId AND video_id = v.id) as favorited_by_me,
           1 as following_author
    FROM videos v
    JOIN users u ON v.user_id = u.id
    JOIN follows f ON f.following_id = v.user_id AND f.follower_id = @viewerId
    WHERE v.status = 'approved'
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = @viewerId AND blocked_id = v.user_id)
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = v.user_id AND blocked_id = @viewerId)
    ORDER BY ${scoreSql} DESC, v.created_at DESC
    LIMIT @limit OFFSET @offset
    `, { viewerId, limit, offset, seed });

    res.json(videos.map(withMediaUrls));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/like', auth, async (req, res, next) => {
  if (!ensureActiveUser(req, res)) return;

  const videoId = req.params.id;
  const userId = req.user.id;

  try {
  const video = await getApprovedVideo(videoId);
  if (!video) {
    return res.status(404).json({ error: 'Публикация не найдена' });
  }
  if (await isBlockedPair(userId, video.user_id)) {
    return res.status(404).json({ error: 'Публикация не найдена' });
  }

  const existing = await db.get('SELECT 1 FROM likes WHERE user_id = ? AND video_id = ?', [userId, videoId]);
  let liked;

  if (existing) {
    await db.run('DELETE FROM likes WHERE user_id = ? AND video_id = ?', [userId, videoId]);
    liked = false;
  } else {
    await db.run('INSERT INTO likes (user_id, video_id, created_at) VALUES (?, ?, unixepoch())', [userId, videoId]);
    liked = true;

    if (video.user_id !== userId) {
      createNotification(video.user_id, 'NEW_LIKE', {
        video_id: videoId,
        actor_id: userId,
        actor_username: req.user.username,
      });
    }
  }

  const likesCount = (await db.get('SELECT COUNT(*) as count FROM likes WHERE video_id = ?', [videoId])).count;
  res.json({ liked, likes_count: likesCount });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/favorite', auth, async (req, res, next) => {
  if (!ensureActiveUser(req, res)) return;

  const videoId = req.params.id;
  const userId = req.user.id;

  try {
  const video = await getApprovedVideo(videoId);
  if (!video) {
    return res.status(404).json({ error: 'Публикация не найдена' });
  }
  if (await isBlockedPair(userId, video.user_id)) {
    return res.status(404).json({ error: 'Публикация не найдена' });
  }

  const existing = await db.get('SELECT 1 FROM favorites WHERE user_id = ? AND video_id = ?', [userId, videoId]);
  let favorited;

  if (existing) {
    await db.run('DELETE FROM favorites WHERE user_id = ? AND video_id = ?', [userId, videoId]);
    favorited = false;
  } else {
    await db.run('INSERT INTO favorites (user_id, video_id, created_at) VALUES (?, ?, unixepoch())', [userId, videoId]);
    favorited = true;
  }

  const favoritesCount = (await db.get('SELECT COUNT(*) as count FROM favorites WHERE video_id = ?', [videoId])).count;
  res.json({ favorited, favorites_count: favoritesCount });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/comments', async (req, res, next) => {
  const videoId = req.params.id;
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 100);

  try {
  const video = await getApprovedVideo(videoId);
  if (!video) {
    return res.status(404).json({ error: 'Публикация не найдена' });
  }
  const viewer = await getViewer(req);
  if (viewer && await isBlockedPair(viewer.id, video.user_id)) {
    return res.status(404).json({ error: 'Публикация не найдена' });
  }

  const comments = await db.all(`
    SELECT c.*, u.username, u.display_name, u.avatar_url
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.video_id = ?
    ORDER BY c.created_at DESC
    LIMIT ?
  `, [videoId, limit]);

  res.json(comments);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/comments', auth, async (req, res, next) => {
  if (!ensureActiveUser(req, res)) return;

  const videoId = req.params.id;
  const body = String(req.body.body || '').trim();

  if (!body) {
    return res.status(400).json({ error: 'Комментарий пустой' });
  }

  if (body.length > 500) {
    return res.status(400).json({ error: 'Комментарий должен быть до 500 символов' });
  }

  try {
  const video = await getApprovedVideo(videoId);
  if (!video) {
    return res.status(404).json({ error: 'Публикация не найдена' });
  }
  if (await isBlockedPair(req.user.id, video.user_id)) {
    return res.status(404).json({ error: 'Публикация не найдена' });
  }

  const id = uuidv4();
  await db.run(`
    INSERT INTO comments (id, video_id, user_id, body, created_at, updated_at)
    VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
  `, [id, videoId, req.user.id, body]);

  const comment = await db.get(`
    SELECT c.*, u.username, u.display_name, u.avatar_url
    FROM comments c
    JOIN users u ON c.user_id = u.id
    WHERE c.id = ?
  `, [id]);

  const commentsCount = (await db.get('SELECT COUNT(*) as count FROM comments WHERE video_id = ?', [videoId])).count;

  if (video.user_id !== req.user.id) {
    createNotification(video.user_id, 'NEW_COMMENT', {
      video_id: videoId,
      comment_id: id,
      actor_id: req.user.id,
      actor_username: req.user.username,
      body,
    });
  }

  res.json({ comment, comments_count: commentsCount });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/comments/:commentId', auth, async (req, res, next) => {
  if (!ensureActiveUser(req, res)) return;

  const videoId = req.params.id;
  const commentId = req.params.commentId;

  try {
  const video = await db.get('SELECT id, user_id FROM videos WHERE id = ? AND status = ?', [videoId, 'approved']);
  if (!video) {
    return res.status(404).json({ error: 'Публикация не найдена' });
  }
  if (await isBlockedPair(req.user.id, video.user_id)) {
    return res.status(404).json({ error: 'Публикация не найдена' });
  }

  const comment = await db.get('SELECT id, user_id FROM comments WHERE id = ? AND video_id = ?', [commentId, videoId]);
  if (!comment) {
    return res.status(404).json({ error: 'Комментарий не найден' });
  }

  const canDelete = comment.user_id === req.user.id || video.user_id === req.user.id || ADMIN_IDS.has(req.user.discord_id);
  if (!canDelete) {
    return res.status(403).json({ error: 'Вы не можете удалить этот комментарий' });
  }

  await db.run('DELETE FROM comments WHERE id = ?', [commentId]);
  if (comment.user_id !== req.user.id) {
    createNotification(comment.user_id, 'COMMENT_DELETED', {
      video_id: videoId,
      comment_id: commentId,
      by_user_id: req.user.id,
      by_username: req.user.username,
    });
  }

  const commentsCount = (await db.get('SELECT COUNT(*) as count FROM comments WHERE video_id = ?', [videoId])).count;
  res.json({ success: true, comments_count: commentsCount });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', auth, async (req, res, next) => {
  if (!ensureActiveUser(req, res)) return;

  try {
  const video = await db.get(`
    SELECT id, user_id, status
    FROM videos
    WHERE id = ? AND status IN ('pending', 'approved')
  `, [req.params.id]);

  if (!video) {
    return res.status(404).json({ error: 'Публикация не найдена' });
  }

  if (video.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Можно удалить только свою публикацию' });
  }

  await db.run(`
    UPDATE videos
    SET status = 'deleted', updated_at = unixepoch()
    WHERE id = ?
  `, [video.id]);

  res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/share', auth, async (req, res, next) => {
  if (!ensureActiveUser(req, res)) return;

  const videoId = req.params.id;
  const targetUserId = String(req.body.userId || '');

  if (!targetUserId) {
    return res.status(400).json({ error: 'Не выбран друг' });
  }

  try {
  const video = await getApprovedVideo(videoId);
  if (!video) {
    return res.status(404).json({ error: 'Публикация не найдена' });
  }
  if (await isBlockedPair(req.user.id, video.user_id)) {
    return res.status(404).json({ error: 'Публикация не найдена' });
  }

  const friend = await db.get(`
    SELECT u.id, u.username, u.display_name
    FROM users u
    WHERE u.id = ?
      AND EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND following_id = u.id)
      AND EXISTS(SELECT 1 FROM follows WHERE follower_id = u.id AND following_id = ?)
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = u.id AND blocked_id = ?)
      AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = ? AND blocked_id = u.id)
      AND u.is_banned = 0
  `, [targetUserId, req.user.id, req.user.id, req.user.id, req.user.id]);

  if (!friend) {
    return res.status(403).json({ error: 'Отправлять публикации можно только взаимным друзьям' });
  }

  createNotification(friend.id, 'VIDEO_SHARE', {
    video_id: videoId,
    actor_id: req.user.id,
    actor_username: req.user.username,
  });

  await db.run(`
    INSERT INTO direct_messages (id, sender_id, recipient_id, body, video_id, created_at)
    VALUES (?, ?, ?, '', ?, unixepoch())
  `, [uuidv4(), req.user.id, friend.id, videoId]);

  res.json({ success: true, message: `Публикация отправлена ${friend.display_name || `@${friend.username}`}` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
