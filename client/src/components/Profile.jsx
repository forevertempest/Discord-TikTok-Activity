import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import {
  Bookmark,
  Clapperboard,
  Edit3,
  Heart,
  Save,
  Search,
  Trash2,
  UserCheck,
  UserPlus,
  UserX,
  Users,
  Video,
  X,
  Send,
} from 'lucide-react';
import { useConfirm } from './ConfirmDialog';
import { formatDuration, getMediaUrl } from '../utils/media';
import LinkifiedText from '../utils/linkify';

const tabs = [
  { id: 'published', label: 'Опубликованные', sourceLabel: 'Публикации профиля', icon: Video },
  { id: 'liked', label: 'Лайки', sourceLabel: 'Лайкнутые публикации', icon: Heart },
  { id: 'favorites', label: 'Избранное', sourceLabel: 'Избранные публикации', icon: Bookmark },
];

const relationLabels = {
  followers: 'Подписчики',
  following: 'Подписки',
  blocks: 'Заблокированные',
};

function displayUserName(item) {
  return item?.display_name || item?.username || 'user';
}

const Profile = ({ user, profileUserId, onOpenVideo, onOpenProfile, onOpenChat }) => {
  const { confirm } = useConfirm();
  const [profile, setProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('published');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [bioDraft, setBioDraft] = useState('');
  const [editingBio, setEditingBio] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [relationView, setRelationView] = useState('');
  const [relationUsers, setRelationUsers] = useState([]);
  const [relationLoading, setRelationLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    setRelationView('');
    setRelationUsers([]);

    async function loadProfile(silent = false) {
      if (!silent) setLoading(true);
      setProfileMessage('');

      try {
        const url = !profileUserId || profileUserId === user?.id
          ? '/api/users/me/profile'
          : `/api/users/${profileUserId}/profile`;
        const res = await axios.get(url);

        if (mounted) {
          setProfile(res.data);
          if (!silent) {
            setBioDraft(res.data?.user?.bio || '');
            setEditingBio(false);
          }
        }
      } catch (err) {
        if (mounted) setProfileMessage(err.response?.data?.error || 'Профиль не найден.');
      } finally {
        if (mounted && !silent) setLoading(false);
      }
    }

    loadProfile();
    const timer = window.setInterval(() => {
      if (!document.hidden) loadProfile(true);
    }, 30000);

    const onGlobalDelete = (event) => {
      const videoId = event.detail;
      setProfile((current) => {
        if (!current) return current;
        return {
          ...current,
          videos: {
            published: current.videos.published?.filter(v => v.id !== videoId) || [],
            liked: current.videos.liked?.filter(v => v.id !== videoId) || [],
            favorites: current.videos.favorites?.filter(v => v.id !== videoId) || [],
          }
        };
      });
    };
    window.addEventListener('tiktok:video-deleted', onGlobalDelete);

    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener('tiktok:video-deleted', onGlobalDelete);
    };
  }, [profileUserId, user?.id]);

  const data = profile || {
    user,
    stats: {},
    videos: { published: [], liked: [], favorites: [] },
  };

  const isOwnProfile = data.user?.id === user?.id;
  const visibleTabs = isOwnProfile ? tabs : tabs.slice(0, 1);
  const currentTab = isOwnProfile ? activeTab : 'published';
  const currentTabMeta = visibleTabs.find((tab) => tab.id === currentTab) || visibleTabs[0];
  const visibleVideos = useMemo(() => data.videos?.[currentTab] || [], [data.videos, currentTab]);

  useEffect(() => {
    if (!isOwnProfile && activeTab !== 'published') setActiveTab('published');
  }, [isOwnProfile, activeTab]);

  const searchUsers = async (event) => {
    event.preventDefault();
    const value = query.trim();
    if (!value) {
      setResults([]);
      return;
    }

    setSearching(true);
    try {
      const res = await axios.get('/api/users/search', { params: { q: value } });
      setResults(res.data);
    } finally {
      setSearching(false);
    }
  };

  const toggleFollowInList = async (targetUserId) => {
    if (user?.is_banned) return;

    const update = (items, payload) => items.map((item) => (
      item.id === targetUserId
        ? {
            ...item,
            following: payload.following,
            is_friend: payload.is_friend,
          }
        : item
    ));

    try {
      const res = await axios.post(`/api/users/${targetUserId}/follow`);
      setResults((items) => update(items, res.data));
      setRelationUsers((items) => update(items, res.data));
      if (profile?.user?.id === targetUserId) {
        setProfile((current) => current ? { ...current, following: res.data.following } : current);
      }
    } catch (err) {
      setProfileMessage(err.response?.data?.error || 'Действие недоступно.');
    }
  };

  const saveBio = async () => {
    try {
      await axios.post('/api/users/me/update', { bio: bioDraft });
      setProfile((current) => current
        ? { ...current, user: { ...current.user, bio: bioDraft.trim() } }
        : current);
      setEditingBio(false);
      setProfileMessage('Описание сохранено.');
    } catch (err) {
      setProfileMessage(err.response?.data?.error || 'Описание не сохранено.');
    }
  };

  const loadRelation = async (type) => {
    if (!data.user?.id) return;

    setRelationView(type);
    setRelationLoading(true);
    try {
      const res = type === 'blocks'
        ? await axios.get('/api/users/blocks')
        : await axios.get(`/api/users/${data.user.id}/${type}`);
      setRelationUsers(res.data);
    } finally {
      setRelationLoading(false);
    }
  };

  const deleteVideo = async (event, videoId) => {
    event.stopPropagation();
    const ok = await confirm({
      title: 'Удалить публикацию?',
      message: 'Публикация исчезнет из профиля и ленты.',
      confirmText: 'Удалить',
      danger: true,
    });
    if (!ok) return;

    try {
      await axios.delete(`/api/videos/${videoId}`);
      window.dispatchEvent(new CustomEvent('tiktok:video-deleted', { detail: videoId }));
      setProfile((current) => {
        if (!current) return current;
        const nextPublished = current.videos.published?.filter((item) => item.id !== videoId) || [];
        return {
          ...current,
          videos: {
            ...current.videos,
            published: nextPublished,
          },
        };
      });
    } catch (err) {
      setProfileMessage(err.response?.data?.error || 'Публикация не удалена.');
    }
  };

  const toggleBlock = async (targetUserId, targetName = 'пользователя') => {
    if (user?.is_banned || targetUserId === user?.id) return;

    const listedUser = [...results, ...relationUsers].find((item) => item.id === targetUserId);
    const alreadyBlocked = relationView === 'blocks'
      || Boolean(data.user?.id === targetUserId ? data.blocked_by_me : listedUser?.blocked_by_me);

    if (!alreadyBlocked) {
      const ok = await confirm({
        title: 'Заблокировать пользователя?',
        message: `${targetName} не сможет видеть ваши публикации и профиль.`,
        confirmText: 'Заблокировать',
        danger: true,
      });
      if (!ok) return;
    }

    try {
      const res = await axios.post(`/api/users/${targetUserId}/block`);
      const blocked = Boolean(res.data.blocked);
      const update = (items) => items
        .map((item) => (item.id === targetUserId ? { ...item, blocked_by_me: blocked, following: false, is_friend: false } : item))
        .filter((item) => !(relationView === 'blocks' && item.id === targetUserId && !blocked));

      setResults((items) => update(items));
      setRelationUsers((items) => update(items));
      setProfile((current) => {
        if (!current || current.user?.id !== targetUserId) return current;
        return {
          ...current,
          blocked_by_me: blocked,
          following: blocked ? false : current.following,
        };
      });
      setProfileMessage(blocked ? 'Пользователь заблокирован.' : 'Пользователь разблокирован.');
    } catch (err) {
      setProfileMessage(err.response?.data?.error || 'Действие недоступно.');
    }
  };

  const renderPersonRow = (item, listType = '') => (
    <article className="search-user" key={item.id}>
      <button
        type="button"
        className="person-open"
        onClick={() => onOpenProfile?.(item.id)}
        aria-label="Открыть профиль"
        title="Открыть профиль"
      >
        <span className="avatar-status">
          <img src={item.avatar_url} alt="" />
          <span className={`online-dot ${item.online ? 'online-dot--on' : ''}`} />
        </span>
        <div>
          <strong>{displayUserName(item)}</strong>
          <span>@{item.username} · {item.is_friend ? 'друг' : item.follows_me ? 'подписан на вас' : item.discord_id || item.id}</span>
        </div>
      </button>

      {item.id !== user?.id && !item.is_banned && listType === 'blocks' ? (
        <button
          type="button"
          className="small-button"
          onClick={() => toggleBlock(item.id, displayUserName(item))}
          disabled={user?.is_banned}
        >
          <UserX size={16} />
          Разблокировать
        </button>
      ) : item.id !== user?.id && !item.is_banned && item.blocked_by_me ? (
        <button
          type="button"
          className="small-button"
          onClick={() => toggleBlock(item.id, displayUserName(item))}
          disabled={user?.is_banned}
        >
          <UserX size={16} />
          Разблокировать
        </button>
      ) : item.id !== user?.id && !item.is_banned && (
        <button
          type="button"
          className="small-button"
          onClick={() => {
            if (item.following && item.is_friend) {
              onOpenChat?.(item.id, item);
            } else {
              toggleFollowInList(item.id);
            }
          }}
          disabled={user?.is_banned}
        >
          {item.following ? (item.is_friend ? <Send size={16} /> : <UserCheck size={16} />) : <UserPlus size={16} />}
          {item.following ? (item.is_friend ? 'Отправить сообщение' : 'Вы подписаны') : 'Подписаться'}
        </button>
      )}
    </article>
  );

  if (loading) {
    return (
      <div className="state-view">
        <div className="loader" />
        <p>Загружаем профиль...</p>
      </div>
    );
  }

  return (
    <div className="profile-view">
      {profileMessage && <div className="profile-message">{profileMessage}</div>}

      <section className="profile-hero">
        <span className="profile-avatar-wrap">
          <img src={data.user.avatar_url} alt="" className="profile-avatar" />
          <span className={`online-dot online-dot--profile ${data.user.online ? 'online-dot--on' : ''}`} />
        </span>
        <div className="profile-copy">
          <h1>{displayUserName(data.user)}</h1>
          <span>@{data.user.username}</span>

          {editingBio ? (
            <div className="bio-editor">
              <textarea
                value={bioDraft}
                onChange={(event) => setBioDraft(event.target.value.slice(0, 160))}
                maxLength={160}
              />
              <div className="bio-actions">
                <span>{bioDraft.length}/160</span>
                <button type="button" className="small-button" onClick={() => setEditingBio(false)}>
                  <X size={16} />
                  Отмена
                </button>
                <button type="button" className="small-button" onClick={saveBio}>
                  <Save size={16} />
                  Сохранить
                </button>
              </div>
            </div>
          ) : (
            <LinkifiedText as="p" text={data.user.bio || ''} />
          )}
        </div>

        <div className="profile-actions">
          {isOwnProfile && !data.user.is_banned && !editingBio && (
            <button type="button" className="small-button" onClick={() => setEditingBio(true)}>
              <Edit3 size={16} />
              Описание
            </button>
          )}

          {isOwnProfile && (
            <button type="button" className="small-button" onClick={() => loadRelation('blocks')}>
              <UserX size={16} />
              Заблокированные
            </button>
          )}

          {!isOwnProfile && !data.user.is_banned && !data.blocked_by_me && (
            <button
              type="button"
              className="small-button"
              onClick={() => {
                if (data.following && data.is_friend) {
                  onOpenChat?.(data.user.id, data.user);
                } else {
                  toggleFollowInList(data.user.id);
                }
              }}
              disabled={user?.is_banned}
            >
              {data.following ? (data.is_friend ? <Send size={16} /> : <UserCheck size={16} />) : <UserPlus size={16} />}
              {data.following ? (data.is_friend ? 'Отправить сообщение' : 'Вы подписаны') : 'Подписаться'}
            </button>
          )}

          {!isOwnProfile && !data.user.is_banned && (
            <button
              type="button"
              className={`small-button ${data.blocked_by_me ? '' : 'small-button--danger'}`}
              onClick={() => toggleBlock(data.user.id, displayUserName(data.user))}
              disabled={user?.is_banned}
            >
              <UserX size={16} />
              {data.blocked_by_me ? 'Разблокировать' : 'Заблокировать'}
            </button>
          )}
        </div>

        <div className="profile-stats">
          <button type="button" onClick={() => loadRelation('following')}>
            <strong>{data.stats?.following_count || 0}</strong>
            <span>подписки</span>
          </button>
          <button type="button" onClick={() => loadRelation('followers')}>
            <strong>{data.stats?.followers_count || 0}</strong>
            <span>подписчики</span>
          </button>
          <div>
            <strong>{data.stats?.total_likes || 0}</strong>
            <span>лайки</span>
          </div>
        </div>
      </section>

      {relationView && (
        <section className="people-panel">
          <div className="section-title section-title--between">
            <div>
              <Users size={20} />
              <h2>{relationLabels[relationView]}</h2>
            </div>
            <button type="button" className="icon-button" onClick={() => setRelationView('')} aria-label="Закрыть" title="Закрыть">
              <X size={18} />
            </button>
          </div>

          {relationLoading ? (
            <p className="muted-text">Загружаем...</p>
          ) : relationUsers.length === 0 ? (
            <p className="muted-text">Список пока пуст.</p>
          ) : (
            <div className="search-results">
              {relationUsers.map((item) => renderPersonRow(item, relationView))}
            </div>
          )}
        </section>
      )}

      <section className="people-panel">
        <div className="section-title">
          <Users size={20} />
          <h2>Поиск людей</h2>
        </div>

        <form className="user-search" onSubmit={searchUsers}>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ID, никнейм или username"
          />
          <button type="submit" className="icon-button" aria-label="Найти" title="Найти">
            <Search size={18} />
          </button>
        </form>

        <div className="search-results">
          {searching ? (
            <p className="muted-text">Ищем...</p>
          ) : results.map((item) => renderPersonRow(item, 'search'))}
        </div>
      </section>

      <section className="profile-videos">
        <div className="profile-tabs">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const active = currentTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                className={`tab-button ${active ? 'tab-button--active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={18} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {visibleVideos.length === 0 ? (
          <div className="state-view state-view--panel">
            <Clapperboard size={38} />
            <p>Здесь пока пусто.</p>
          </div>
        ) : (
          <div className="video-grid">
            {visibleVideos.map((item) => {
              const itemTitle = String(item.title || '').trim();
              const itemDescription = String(item.description || '').trim();

              return (
                <article className="mini-video-card" key={item.id}>
                  <button
                    type="button"
                    onClick={() => onOpenVideo?.(item.id, {
                      key: `profile:${data.user?.id}:${currentTab}`,
                      title: currentTabMeta?.sourceLabel || 'Публикации профиля',
                      subtitle: `@${data.user?.username || 'user'}`,
                      videos: visibleVideos,
                    })}
                  >
                    <img src={getMediaUrl(item.thumbnail_url || item.thumb_path)} alt="" />
                    <div>
                      <span>{item.media_type === 'photo' ? `${item.media_count || 1} фото` : formatDuration(item.duration_sec)}</span>
                      <strong>{itemTitle || itemDescription || ''}</strong>
                    </div>
                  </button>

                  {isOwnProfile && activeTab === 'published' && (
                    <button type="button" className="mini-delete" onClick={(event) => deleteVideo(event, item.id)} aria-label="Удалить публикацию" title="Удалить публикацию">
                      <Trash2 size={16} />
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default Profile;
