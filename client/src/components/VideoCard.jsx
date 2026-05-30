import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Heart,
  MessageCircle,
  Play,
  Plus,
  Send,
  Share2,
  Trash2,
  UserPlus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { formatDuration, getMediaUrl } from '../utils/media';

const getInitialVolume = () => {
  if (typeof window === 'undefined') return 0.65;
  return window.matchMedia('(max-width: 720px)').matches ? 0.45 : 0.72;
};

const VideoCard = ({ video, isActive, currentUser, onOpenProfile, onDeleted }) => {
  const videoRef = useRef(null);
  const photoTouchRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(getInitialVolume);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [videoError, setVideoError] = useState(false);
  const [liked, setLiked] = useState(Boolean(video.liked_by_me));
  const [favorited, setFavorited] = useState(Boolean(video.favorited_by_me));
  const [following, setFollowing] = useState(Boolean(video.following_author));
  const [likesCount, setLikesCount] = useState(video.likes_count || 0);
  const [commentsCount, setCommentsCount] = useState(video.comments_count || 0);
  const [favoritesCount, setFavoritesCount] = useState(video.favorites_count || 0);
  const [panel, setPanel] = useState('');
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [friends, setFriends] = useState([]);
  const [panelMessage, setPanelMessage] = useState('');
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const mediaType = video.media_type || 'video';
  const isPhotoPost = mediaType === 'photo';
  const mediaUrls = useMemo(() => {
    const fromApi = Array.isArray(video.media_urls) ? video.media_urls.filter(Boolean) : [];
    if (fromApi.length > 0) return fromApi.map(getMediaUrl);
    return [getMediaUrl(video.url || video.file_path)].filter(Boolean);
  }, [video.media_urls, video.url, video.file_path]);
  const videoSrc = mediaUrls[0];
  const posterSrc = getMediaUrl(video.thumbnail_url || video.thumb_path);
  const isOwnPost = currentUser?.id === video.user_id;
  const interactionsDisabled = Boolean(currentUser?.is_banned);
  const authorName = video.display_name || video.username || 'user';
  const cleanTitle = String(video.title || '').trim();
  const cleanDescription = String(video.description || '').trim();
  const shouldCollapseDescription = cleanDescription.length > 20;
  const visibleDescription = shouldCollapseDescription && !descriptionExpanded
    ? `${cleanDescription.slice(0, 20)}...`
    : cleanDescription;

  useEffect(() => {
    setLiked(Boolean(video.liked_by_me));
    setFavorited(Boolean(video.favorited_by_me));
    setFollowing(Boolean(video.following_author));
    setLikesCount(video.likes_count || 0);
    setCommentsCount(video.comments_count || 0);
    setFavoritesCount(video.favorites_count || 0);
    setPhotoIndex(0);
    setPanel('');
    setPanelMessage('');
    setDescriptionExpanded(false);
    setDeleting(false);
  }, [video.id, video.liked_by_me, video.favorited_by_me, video.following_author, video.likes_count, video.comments_count, video.favorites_count]);

  useEffect(() => {
    const node = videoRef.current;
    if (!node || !videoSrc || videoError || isPhotoPost) return;

    node.muted = muted;
    node.volume = muted ? 0 : volume;

    if (!isActive || panel) {
      node.pause();
      setPlaying(false);
      return;
    }

    node.play()
      .then(() => setPlaying(true))
      .catch((err) => {
        console.log('Autoplay blocked:', err);
        setPlaying(false);
      });
  }, [isActive, muted, volume, videoSrc, videoError, panel, isPhotoPost]);

  useEffect(() => {
    if (!isActive || !isPhotoPost) return undefined;

    const onKeyDown = (event) => {
      const target = event.target;
      const isTyping = target?.closest?.('input, textarea, select, [contenteditable="true"]');
      if (isTyping || event.altKey || event.ctrlKey || event.metaKey) return;

      const key = event.key.toLowerCase();
      if (key === 'arrowright') {
        event.preventDefault();
        movePhoto(1);
      }

      if (key === 'arrowleft') {
        event.preventDefault();
        movePhoto(-1);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isActive, isPhotoPost, mediaUrls.length]);

  const togglePlayback = () => {
    const node = videoRef.current;
    if (!node || !videoSrc || videoError || isPhotoPost) return;

    if (playing) {
      node.pause();
      setPlaying(false);
    } else {
      node.play()
        .then(() => setPlaying(true))
        .catch((err) => console.log('Playback failed:', err));
    }
  };

  const toggleMute = (event) => {
    event.stopPropagation();
    setMuted((value) => !value);
  };

  const changeVolume = (event) => {
    event.stopPropagation();
    const next = Number(event.target.value);
    setVolume(next);
    setMuted(next === 0);
  };

  const movePhoto = (direction) => {
    if (mediaUrls.length <= 1) return;
    setPhotoIndex((value) => (value + direction + mediaUrls.length) % mediaUrls.length);
  };

  const showBlockedMessage = () => {
    setPanel('notice');
    setPanelMessage('Аккаунт заблокирован. Сейчас доступны только просмотр ленты и профилей.');
  };

  const handlePhotoTouchStart = (event) => {
    if (event.touches.length !== 1) return;
    const touch = event.touches[0];
    photoTouchRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handlePhotoTouchEnd = (event) => {
    if (!photoTouchRef.current || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - photoTouchRef.current.x;
    const deltaY = touch.clientY - photoTouchRef.current.y;
    const isHorizontalSwipe = Math.abs(deltaX) > 42 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25;
    photoTouchRef.current = null;
    if (!isHorizontalSwipe) return;

    event.stopPropagation();
    if (deltaX < 0) movePhoto(1);
    else movePhoto(-1);
  };

  const toggleLike = async (event) => {
    event.stopPropagation();
    if (interactionsDisabled) {
      showBlockedMessage();
      return;
    }

    const previousLiked = liked;
    const previousCount = likesCount;

    setLiked(!previousLiked);
    setLikesCount(previousCount + (previousLiked ? -1 : 1));

    try {
      const res = await axios.post(`/api/videos/${video.id}/like`);
      setLiked(Boolean(res.data.liked));
      setLikesCount(res.data.likes_count || 0);
    } catch (err) {
      setLiked(previousLiked);
      setLikesCount(previousCount);
    }
  };

  const toggleFavorite = async (event) => {
    event.stopPropagation();
    if (interactionsDisabled) {
      showBlockedMessage();
      return;
    }

    const previousFavorited = favorited;
    const previousCount = favoritesCount;

    setFavorited(!previousFavorited);
    setFavoritesCount(previousCount + (previousFavorited ? -1 : 1));

    try {
      const res = await axios.post(`/api/videos/${video.id}/favorite`);
      setFavorited(Boolean(res.data.favorited));
      setFavoritesCount(res.data.favorites_count || 0);
    } catch (err) {
      setFavorited(previousFavorited);
      setFavoritesCount(previousCount);
    }
  };

  const toggleFollow = async (event) => {
    event.stopPropagation();
    if (interactionsDisabled) {
      showBlockedMessage();
      return;
    }

    if (isOwnPost) return;

    const previous = following;
    setFollowing(!previous);

    try {
      const res = await axios.post(`/api/users/${video.user_id}/follow`);
      setFollowing(Boolean(res.data.following));
    } catch (err) {
      setFollowing(previous);
    }
  };

  const openComments = async (event) => {
    event.stopPropagation();
    setPanel('comments');
    setPanelMessage('');

    try {
      const res = await axios.get(`/api/videos/${video.id}/comments`);
      setComments(res.data);
    } catch (err) {
      setPanelMessage('Не удалось загрузить комментарии.');
    }
  };

  const submitComment = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (interactionsDisabled) {
      showBlockedMessage();
      return;
    }

    const body = commentText.trim();
    if (!body) return;

    try {
      const res = await axios.post(`/api/videos/${video.id}/comments`, { body });
      setComments((items) => [res.data.comment, ...items]);
      setCommentsCount(res.data.comments_count || commentsCount + 1);
      setCommentText('');
      setPanelMessage('');
    } catch (err) {
      setPanelMessage(err.response?.data?.error || 'Комментарий не отправлен.');
    }
  };

  const deleteComment = async (commentId) => {
    if (interactionsDisabled) {
      showBlockedMessage();
      return;
    }

    try {
      const res = await axios.delete(`/api/videos/${video.id}/comments/${commentId}`);
      setComments((items) => items.filter((comment) => comment.id !== commentId));
      setCommentsCount(res.data.comments_count || 0);
      setPanelMessage('');
    } catch (err) {
      setPanelMessage(err.response?.data?.error || 'Комментарий не удален.');
    }
  };

  const openShare = async (event) => {
    event.stopPropagation();
    setPanel('share');
    setPanelMessage('');

    try {
      const res = await axios.get('/api/users/friends');
      setFriends(res.data);
    } catch (err) {
      setPanelMessage('Не удалось загрузить друзей.');
    }
  };

  const shareToFriend = async (friendId) => {
    if (interactionsDisabled) {
      showBlockedMessage();
      return;
    }

    try {
      const res = await axios.post(`/api/videos/${video.id}/share`, { userId: friendId });
      setPanelMessage(res.data.message || 'Публикация отправлена.');
    } catch (err) {
      setPanelMessage(err.response?.data?.error || 'Не удалось отправить публикацию.');
    }
  };

  const closePanel = (event) => {
    event.stopPropagation();
    setPanel('');
    setPanelMessage('');
  };

  const deletePost = async (event) => {
    event.stopPropagation();
    if (!isOwnPost || deleting) return;
    if (interactionsDisabled) {
      showBlockedMessage();
      return;
    }

    setDeleting(true);
    try {
      await axios.delete(`/api/videos/${video.id}`);
      onDeleted?.(video.id);
    } catch (err) {
      setPanel('notice');
      setPanelMessage(err.response?.data?.error || 'Публикация не удалена.');
      setDeleting(false);
    }
  };

  return (
    <>
      <div className="video-shell" onClick={togglePlayback}>
        {isPhotoPost ? (
          <div
            className="photo-carousel"
            onTouchStart={handlePhotoTouchStart}
            onTouchEnd={handlePhotoTouchEnd}
            onTouchCancel={() => {
              photoTouchRef.current = null;
            }}
          >
            <img src={mediaUrls[photoIndex]} alt="" className="photo-player" />
            {mediaUrls.length > 1 && (
              <>
                <button type="button" className="icon-button photo-arrow photo-arrow--left" onClick={(event) => { event.stopPropagation(); movePhoto(-1); }} aria-label="Предыдущее фото" title="Предыдущее фото">
                  <ChevronLeft size={20} />
                </button>
                <button type="button" className="icon-button photo-arrow photo-arrow--right" onClick={(event) => { event.stopPropagation(); movePhoto(1); }} aria-label="Следующее фото" title="Следующее фото">
                  <ChevronRight size={20} />
                </button>
                <div className="photo-counter">{photoIndex + 1}/{mediaUrls.length}</div>
              </>
            )}
          </div>
        ) : videoSrc && !videoError ? (
          <video
            ref={videoRef}
            className="video-player"
            src={videoSrc}
            poster={posterSrc}
            loop
            muted={muted}
            playsInline
            preload="metadata"
            onError={() => setVideoError(true)}
          />
        ) : (
          <div className="video-fallback">
            <p>Публикация недоступна</p>
          </div>
        )}

        {!isPhotoPost && !playing && !videoError && (
          <div className="play-indicator" aria-hidden="true">
            <Play size={32} fill="currentColor" />
          </div>
        )}

        {!isPhotoPost && (
          <div className="volume-control" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="icon-button"
              onClick={toggleMute}
              aria-label={muted ? 'Включить звук' : 'Выключить звук'}
              title={muted ? 'Включить звук' : 'Выключить звук'}
            >
              {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={muted ? 0 : volume}
              onChange={changeVolume}
              aria-label="Громкость"
            />
          </div>
        )}
      </div>

      <div className="feed-details">
        <div className="author-row">
          <button
            type="button"
            className="avatar-stack avatar-profile"
            onClick={(event) => {
              event.stopPropagation();
              onOpenProfile?.(video.user_id);
            }}
            aria-label="Открыть профиль автора"
            title="Открыть профиль автора"
          >
            <img src={video.avatar_url} alt="" className="avatar" />
          </button>
          <button
            type="button"
            className="author-copy"
            onClick={(event) => {
              event.stopPropagation();
              onOpenProfile?.(video.user_id);
            }}
          >
            <h2>{authorName}</h2>
            <span>@{video.username || 'user'}</span>
            <p>{isPhotoPost ? `${mediaUrls.length} фото` : formatDuration(video.duration_sec)}</p>
          </button>

          {!isOwnPost && (
            <button
              type="button"
              className={`follow-chip ${following ? 'follow-chip--active' : ''}`}
              onClick={toggleFollow}
              disabled={interactionsDisabled}
              aria-label={following ? 'Вы подписаны' : 'Подписаться'}
              title={following ? 'Вы подписаны' : 'Подписаться'}
            >
              {following ? <UserPlus size={15} /> : <Plus size={15} />}
              <span>{following ? 'Вы подписаны' : 'Подписаться'}</span>
            </button>
          )}
        </div>

        {cleanTitle && <h3 className="video-title">{cleanTitle}</h3>}

        {cleanDescription && (
          <button
            type="button"
            className={`video-description ${descriptionExpanded ? 'video-description--expanded' : ''}`}
            onClick={(event) => {
              event.stopPropagation();
              if (shouldCollapseDescription) setDescriptionExpanded((value) => !value);
            }}
          >
            {visibleDescription}
          </button>
        )}

        <div className="video-actions">
          <button type="button" className={`action-button ${liked ? 'action-button--active' : ''}`} onClick={toggleLike} disabled={interactionsDisabled} aria-label="Лайк" title="Лайк">
            <Heart size={24} fill={liked ? 'currentColor' : 'none'} />
            <span>{likesCount}</span>
          </button>

          <button type="button" className="action-button" onClick={openComments} aria-label="Комментарии" title="Комментарии">
            <MessageCircle size={24} />
            <span>{commentsCount}</span>
          </button>

          <button type="button" className={`action-button ${favorited ? 'action-button--active' : ''}`} onClick={toggleFavorite} disabled={interactionsDisabled} aria-label="В избранное" title="В избранное">
            <Bookmark size={24} fill={favorited ? 'currentColor' : 'none'} />
            <span>{favoritesCount}</span>
          </button>

          <button type="button" className="action-button" onClick={openShare} disabled={interactionsDisabled} aria-label="Отправить другу" title="Отправить другу">
            <Share2 size={24} />
          </button>

          {isOwnPost && (
            <button type="button" className="action-button action-button--danger" onClick={deletePost} disabled={interactionsDisabled || deleting} aria-label="Удалить публикацию" title="Удалить публикацию">
              <Trash2 size={24} />
            </button>
          )}
        </div>
      </div>

      {panel && (
        <div className="interaction-panel" onClick={(event) => event.stopPropagation()}>
          <div className="panel-header">
            <h3>{panel === 'comments' ? 'Комментарии' : panel === 'share' ? 'Отправить другу' : 'Уведомление'}</h3>
            <button type="button" className="icon-button" onClick={closePanel} aria-label="Закрыть" title="Закрыть">
              <X size={18} />
            </button>
          </div>

          {panelMessage && <p className="panel-message">{panelMessage}</p>}

          {panel === 'comments' && (
            <>
              <div className="comments-list">
                {comments.length === 0 ? (
                  <p className="muted-text">Комментариев пока нет.</p>
                ) : comments.map((comment) => {
                  const canDelete = currentUser?.is_admin || currentUser?.id === comment.user_id || isOwnPost;

                  return (
                    <div className="comment-row" key={comment.id}>
                      <img src={comment.avatar_url} alt="" />
                      <div>
                        <strong>{comment.display_name || comment.username}</strong>
                        <p>{comment.body}</p>
                      </div>
                      {canDelete && (
                        <button type="button" className="comment-delete" onClick={() => deleteComment(comment.id)} aria-label="Удалить комментарий" title="Удалить комментарий">
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <form className="comment-form" onSubmit={submitComment}>
                <input value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Добавить комментарий" maxLength={500} />
                <button type="submit" className="icon-button" aria-label="Отправить" title="Отправить">
                  <Send size={18} />
                </button>
              </form>
            </>
          )}

          {panel === 'share' && (
            <div className="friends-list">
              {friends.length === 0 ? (
                <p className="muted-text">Друзей пока нет. Дружба появляется, когда вы подписаны друг на друга.</p>
              ) : friends.map((friend) => (
                <button type="button" className="friend-row" key={friend.id} onClick={() => shareToFriend(friend.id)}>
                  <img src={friend.avatar_url} alt="" />
                  <span>{friend.display_name || friend.username}</span>
                  <Send size={17} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default VideoCard;
