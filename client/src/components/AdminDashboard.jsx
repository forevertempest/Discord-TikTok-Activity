    ORDER BY u.created_at DESC
    LIMIT 100
  `).all({ query: q ? `%${q}%` : '' });

  res.json(users);
});

/**
 * POST /api/admin/videos/:id/review
 * Body: { action: 'approved'|'rejected', reason?: string }
 */
router.post('/videos/:id/review', auth, admin, (req, res) => {
  const videoId = req.params.id;
  const { action, reason } = req.body;

  if (!['approved', 'rejected'].includes(action)) {
    return res.status(400).json({ error: 'Некорректное действие' });
  }

  try {
    const video = db.prepare(`
      SELECT v.user_id, v.title, u.username, u.display_name
      FROM videos v
      JOIN users u ON u.id = v.user_id
      WHERE v.id = ? AND v.status = 'pending'
    `).get(videoId);

    if (!video) return res.status(404).json({ error: 'Публикация не найдена или уже обработана' });

    db.transaction(() => {
      db.prepare(`
        UPDATE videos
        SET status = ?, reject_reason = ?, moderated_at = unixepoch(), moderated_by = ?, updated_at = unixepoch()
        WHERE id = ? AND status = 'pending'
      `).run(action, reason || null, req.user.discord_id, videoId);

      db.prepare(`
        INSERT INTO moderation_log (video_id, admin_discord_id, action, reason, created_at)
        VALUES (?, ?, ?, ?, unixepoch())
      `).run(videoId, req.user.discord_id, action, reason || null);
    })();

    runLater(`moderation:${videoId}`, () => {
      createNotification(video.user_id, 'MODERATION_DECISION', {
        video_id: videoId,
        status: action,
        reason: reason || null,
      });

      if (action !== 'approved') return;

      const friends = db.prepare(`
        SELECT u.id
        FROM users u
        WHERE u.id != @authorId
          AND u.is_banned = 0
          AND EXISTS(SELECT 1 FROM follows WHERE follower_id = @authorId AND following_id = u.id)
          AND EXISTS(SELECT 1 FROM follows WHERE follower_id = u.id AND following_id = @authorId)
          AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = u.id AND blocked_id = @authorId)
          AND NOT EXISTS(SELECT 1 FROM user_blocks WHERE blocker_id = @authorId AND blocked_id = u.id)
      `).all({ authorId: video.user_id });

      runChunked(`friend-video:${videoId}`, friends, (friend) => {
        createNotification(friend.id, 'FRIEND_VIDEO', {
          video_id: videoId,
          actor_id: video.user_id,
          actor_username: video.username,
          actor_display_name: video.display_name || video.username,
        });
      });
    });

    res.json({ success: true, message: action === 'approved' ? 'Публикация одобрена' : 'Публикация отклонена' });
  } catch (err) {
    console.error('[ADMIN ERROR]', err);
    res.status(500).json({ error: 'Не удалось обработать решение модерации' });
  }
});

/**
 * POST /api/admin/videos/:id/delete
 * Soft-deletes an approved or pending video.
 */
router.post('/videos/:id/delete', auth, admin, (req, res) => {
  const videoId = req.params.id;
  const reason = String(req.body.reason || '').trim();

  const video = db.prepare('SELECT id, user_id, status FROM videos WHERE id = ?').get(videoId);
  if (!video) return res.status(404).json({ error: 'Публикация не найдена' });

  try {
    db.transaction(() => {
      db.prepare(`
        UPDATE videos
        SET status = 'deleted', reject_reason = ?, moderated_at = unixepoch(), moderated_by = ?, updated_at = unixepoch()
        WHERE id = ?
      `).run(reason || null, req.user.discord_id, videoId);

      db.prepare(`
        INSERT INTO moderation_log (video_id, admin_discord_id, action, reason, created_at)
        VALUES (?, ?, 'deleted', ?, unixepoch())
      `).run(videoId, req.user.discord_id, reason || null);
    })();

    runLater(`video-delete:${videoId}`, () => {
      createNotification(video.user_id, 'VIDEO_DELETED', {
        video_id: videoId,
        reason: reason || null,
      });
    });

    res.json({ success: true, message: 'Публикация удалена' });
  } catch (err) {
    console.error('[ADMIN DELETE ERROR]', err);
    res.status(500).json({ error: 'Не удалось удалить публикацию' });
  }
});

/**
 * POST /api/admin/users/:id/action
 * Body: { action: 'warn'|'ban'|'unban'|'reset', reason?: string }
 */
router.post('/users/:id/action', auth, admin, (req, res) => {
  const userId = req.params.id;
  const action = String(req.body.action || '');
  const reason = String(req.body.reason || '').trim();

  if (!['warn', 'ban', 'unban', 'reset'].includes(action)) {
    return res.status(400).json({ error: 'Некорректное действие' });
  }

  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден' });

  try {
    db.transaction(() => {
      if (action === 'warn') {
        db.prepare(`
          INSERT INTO user_warnings (user_id, admin_discord_id, reason, created_at)
          VALUES (?, ?, ?, unixepoch())
        `).run(userId, req.user.discord_id, reason || 'Предупреждение');

        runLater(`warn:${userId}`, () => createNotification(userId, 'USER_WARNING', { reason: reason || null }));
      }

      if (action === 'ban') {
        const userVideoIds = db.prepare('SELECT id FROM videos WHERE user_id = ?').all(userId).map((row) => row.id);

        db.prepare(`
          UPDATE users
          SET is_banned = 1, ban_reason = ?, upload_disabled = 1, updated_at = unixepoch()
          WHERE id = ?
        `).run(reason || 'Заблокирован модерацией', userId);

        db.prepare('DELETE FROM likes WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM favorites WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').run(userId, userId);
        db.prepare('DELETE FROM comments WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM direct_messages WHERE sender_id = ? OR recipient_id = ?').run(userId, userId);

        for (const videoId of userVideoIds) {
          db.prepare('DELETE FROM likes WHERE video_id = ?').run(videoId);
          db.prepare('DELETE FROM favorites WHERE video_id = ?').run(videoId);
          db.prepare('DELETE FROM comments WHERE video_id = ?').run(videoId);
        }

        runLater(`ban:${userId}`, () => createNotification(userId, 'ACCOUNT_BLOCKED', { reason: reason || null }));
      }

      if (action === 'unban') {
        db.prepare(`
          UPDATE users
          SET is_banned = 0, ban_reason = NULL, upload_disabled = 0, updated_at = unixepoch()
          WHERE id = ?
        `).run(userId);

        runLater(`unban:${userId}`, () => createNotification(userId, 'ACCOUNT_UNBLOCKED', {}));
      }

      if (action === 'reset') {
        const userVideoIds = db.prepare('SELECT id FROM videos WHERE user_id = ?').all(userId).map((row) => row.id);

        db.prepare("UPDATE videos SET status = 'deleted', updated_at = unixepoch() WHERE user_id = ?").run(userId);
        db.prepare('DELETE FROM likes WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM favorites WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM follows WHERE follower_id = ? OR following_id = ?').run(userId, userId);
        db.prepare('DELETE FROM comments WHERE user_id = ?').run(userId);
        db.prepare('DELETE FROM direct_messages WHERE sender_id = ? OR recipient_id = ?').run(userId, userId);

        for (const videoId of userVideoIds) {
          db.prepare('DELETE FROM likes WHERE video_id = ?').run(videoId);
          db.prepare('DELETE FROM favorites WHERE video_id = ?').run(videoId);
          db.prepare('DELETE FROM comments WHERE video_id = ?').run(videoId);
        }

        db.prepare(`
          UPDATE users
          SET bio = '', upload_disabled = 0, is_banned = 0, ban_reason = NULL, updated_at = unixepoch()
          WHERE id = ?
        `).run(userId);

        runLater(`reset:${userId}`, () => createNotification(userId, 'USER_RESET', { reason: reason || null }));
      }

      db.prepare(`
        INSERT INTO user_moderation_log (user_id, admin_discord_id, action, reason, created_at)
        VALUES (?, ?, ?, ?, unixepoch())
      `).run(userId, req.user.discord_id, action, reason || null);
    })();

    res.json({ success: true, message: 'Действие выполнено', username: user.username });
import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Ban, Check, ChevronLeft, ChevronRight, RefreshCw, RotateCcw, Shield, Trash2, TriangleAlert, X } from 'lucide-react';
import { formatDuration, getMediaUrl } from '../utils/media';

const sections = [
  { id: 'review', label: 'Проверить видео' },
  { id: 'delete', label: 'Удалить видео' },
  { id: 'users', label: 'Пользователи и меры' },
];

const ModerationPreview = ({ video }) => {
  const [index, setIndex] = useState(0);
  const mediaUrls = Array.isArray(video.media_urls) && video.media_urls.length > 0
    ? video.media_urls.map(getMediaUrl)
    : [getMediaUrl(video.url || video.file_path || video.thumbnail_url || video.thumb_path)].filter(Boolean);
  const isPhoto = video.media_type === 'photo';
  const current = mediaUrls[index] || getMediaUrl(video.thumbnail_url || video.thumb_path);

  const move = (direction) => {
    if (mediaUrls.length <= 1) return;
    setIndex((value) => (value + direction + mediaUrls.length) % mediaUrls.length);
  };

  return (
    <div className="moderation-preview">
      {isPhoto ? (
        <>
          <img src={current} alt="" />
          {mediaUrls.length > 1 && (
            <>
              <button type="button" className="icon-button moderation-arrow moderation-arrow--left" onClick={() => move(-1)} aria-label="Предыдущее фото" title="Предыдущее фото">
                <ChevronLeft size={18} />
              </button>
              <button type="button" className="icon-button moderation-arrow moderation-arrow--right" onClick={() => move(1)} aria-label="Следующее фото" title="Следующее фото">
                <ChevronRight size={18} />
              </button>
              <span className="moderation-counter">{index + 1}/{mediaUrls.length}</span>
            </>
          )}
        </>
      ) : (
        <video
          src={getMediaUrl(video.url || video.file_path)}
          poster={getMediaUrl(video.thumbnail_url || video.thumb_path)}
          controls
          playsInline
          preload="metadata"
        />
      )}
    </div>
  );
};

const AdminDashboard = () => {
  const [section, setSection] = useState('review');
  const [queue, setQueue] = useState([]);
  const [approved, setApproved] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetchSection(section);
  }, [section]);

  const fetchSection = async (target = section) => {
    setLoading(true);
    try {
      if (target === 'review') {
        const res = await axios.get('/api/admin/queue');
        setQueue(res.data);
      }

      if (target === 'delete') {
        const res = await axios.get('/api/admin/videos', { params: { status: 'approved' } });
        setApproved(res.data);
      }

      if (target === 'users') {
        const res = await axios.get('/api/admin/users', { params: { q: query } });
        setUsers(res.data);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (id, action) => {
    if (action === 'approved' && !window.confirm('Одобрить публикацию?')) return;
    if (action === 'rejected' && !window.confirm('Отклонить публикацию?')) return;
    const reason = action === 'rejected' ? window.prompt('Причина отклонения') || '' : '';
    await axios.post(`/api/admin/videos/${id}/review`, { action, reason });
    setQueue((items) => items.filter((video) => video.id !== id));
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Удалить публикацию?')) return;
    const reason = window.prompt('Причина удаления') || '';
    await axios.post(`/api/admin/videos/${id}/delete`, { reason });
    setApproved((items) => items.filter((video) => video.id !== id));
  };

  const handleUserAction = async (id, action) => {
    const labels = {
      warn: 'выдать предупреждение',
      ban: 'заблокировать пользователя',
      unban: 'разблокировать пользователя',
      reset: 'обнулить аккаунт',
    };
    if (!window.confirm(`Подтвердить действие: ${labels[action] || action}?`)) return;
    const reason = action === 'unban' ? '' : window.prompt('Причина действия') || '';
    await axios.post(`/api/admin/users/${id}/action`, { action, reason });
    await fetchSection('users');
  };

  const renderVideoCard = (video, mode) => (
    <article key={video.id} className="moderation-card">
      <ModerationPreview video={video} />

      <div className="moderation-body">
        <div className="moderation-author">
          <img src={video.avatar_url} alt="" />
          <div>
            <strong>{video.display_name || video.username}</strong>
            <span>{video.media_type === 'photo' ? `${video.media_count || 1} фото` : formatDuration(video.duration_sec)} · {video.likes_count || 0} лайков · {video.comments_count || 0} комм.</span>
          </div>
        </div>

        <p className="moderation-description">{[video.title?.trim(), video.description?.trim()].filter(Boolean).join('\n') || 'Без описания'}</p>

        {mode === 'review' ? (
          <div className="moderation-actions">
            <button type="button" onClick={() => handleReview(video.id, 'approved')} className="review-button review-button--approve">
              <Check size={18} />
              Одобрить
            </button>
            <button type="button" onClick={() => handleReview(video.id, 'rejected')} className="review-button review-button--reject">
              <X size={18} />
              Отклонить
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => handleDelete(video.id)} className="review-button review-button--delete">
            <Trash2 size={18} />
            Удалить видео
          </button>
        )}
      </div>
    </article>
  );

  return (
    <div className="admin-view">
      <div className="admin-header">
        <div className="admin-title">
          <Shield size={30} />
          <div>
            <h1>Модерация</h1>
            <p>Видео, удаления и действия с пользователями</p>
          </div>
        </div>

        <button type="button" className="ghost-button" onClick={() => fetchSection()}>
          <RefreshCw size={18} />
          Обновить
        </button>
      </div>

      <div className="admin-tabs">
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`tab-button ${section === item.id ? 'tab-button--active' : ''}`}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {section === 'users' && (
        <form className="admin-search" onSubmit={(event) => {
          event.preventDefault();
          fetchSection('users');
        }}>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти ID, никнейм или username" />
          <button type="submit" className="ghost-button">Найти</button>
        </form>
      )}

      {loading ? (
        <div className="state-view state-view--panel">
          <div className="loader" />
          <p>Загружаем...</p>
        </div>
      ) : section === 'review' ? (
        queue.length === 0 ? (
          <div className="state-view state-view--panel"><p>Очередь проверки пустая.</p></div>
        ) : (
          <div className="queue-grid">{queue.map((video) => renderVideoCard(video, 'review'))}</div>
        )
      ) : section === 'delete' ? (
        approved.length === 0 ? (
          <div className="state-view state-view--panel"><p>Нет опубликованных видео.</p></div>
        ) : (
          <div className="queue-grid">{approved.map((video) => renderVideoCard(video, 'delete'))}</div>
        )
      ) : (
        <div className="users-table">
          {users.map((item) => (
            <article className="user-row" key={item.id}>
              <img src={item.avatar_url} alt="" />
              <div className="user-row-main">
                <strong>{item.display_name || item.username}</strong>
                <span>{item.published_count || 0} видео · {item.total_likes || 0} лайков · {item.warnings_count || 0} пред.</span>
                {item.is_banned ? <em>Бан: {item.ban_reason || 'без причины'}</em> : null}
              </div>
              <div className="user-actions">
                <button type="button" className="small-button" onClick={() => handleUserAction(item.id, 'warn')}>
                  <TriangleAlert size={16} />
                  Пред
                </button>
                <button type="button" className="small-button" onClick={() => handleUserAction(item.id, item.is_banned ? 'unban' : 'ban')}>
                  <Ban size={16} />
                  {item.is_banned ? 'Разбан' : 'Бан'}
                </button>
                <button type="button" className="small-button small-button--danger" onClick={() => handleUserAction(item.id, 'reset')}>
                  <RotateCcw size={16} />
                  Обнулить
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
