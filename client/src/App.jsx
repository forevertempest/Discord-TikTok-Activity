import React, { Suspense, lazy, useEffect, useState } from 'react';
import { useDiscordAuth } from './hooks/useDiscordAuth';
import { ConfirmProvider } from './components/ConfirmDialog';
import { Bell, Home, User, PlusSquare, Shield } from 'lucide-react';
import ToastNotifications from './components/ToastNotifications';
import Feed from './components/Feed';
import { EXTERNAL_LINK_EVENT, openConfirmedExternalLink } from './utils/linkify';
import './index.css';

const Upload = lazy(() => import('./components/Upload'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const Profile = lazy(() => import('./components/Profile'));
const Notifications = lazy(() => import('./components/Notifications'));

const App = () => {
  const { user, loading, error } = useDiscordAuth();
  const [view, setView] = useState('feed'); // 'feed', 'upload', 'admin', 'profile'
  const [startVideoId, setStartVideoId] = useState(null);
  const [startCommentId, setStartCommentId] = useState(null);
  const [startChatUserId, setStartChatUserId] = useState(null);
  const [startChatUserData, setStartChatUserData] = useState(null);
  const [feedSource, setFeedSource] = useState(null);
  const [profileUserId, setProfileUserId] = useState(null);
  const [externalLink, setExternalLink] = useState(null);

  useEffect(() => {
    if (!user?.id) return undefined;

    const run = () => {
      import('./components/Upload');
      import('./components/Profile');
      import('./components/Notifications');
      if (user.is_admin) import('./components/AdminDashboard');
    };
    const requestIdle = window.requestIdleCallback || ((callback) => window.setTimeout(callback, 700));
    const cancelIdle = window.cancelIdleCallback || window.clearTimeout;
    const id = requestIdle(run);
    return () => cancelIdle(id);
  }, [user?.id, user?.is_admin]);

  useEffect(() => {
    const onExternalLinkRequest = (event) => {
      event.preventDefault();
      setExternalLink(event.detail);
    };

    window.addEventListener(EXTERNAL_LINK_EVENT, onExternalLinkRequest);
    return () => window.removeEventListener(EXTERNAL_LINK_EVENT, onExternalLinkRequest);
  }, []);

  const confirmExternalLink = async () => {
    const href = externalLink?.href;
    setExternalLink(null);
    if (href) await openConfirmedExternalLink(href);
  };

  if (loading) {
    return (
      <div className="state-view">
        <div className="loader" />
        <p>Запускаем TikTok...</p>
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="state-view state-view--error">
        <p>Ошибка авторизации или Discord SDK: {error}</p>
        <button type="button" className="ghost-button" onClick={() => window.location.reload()}>
          Повторить
        </button>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="state-view state-view--error">
        <p>Сессия не загрузилась. Откройте активность заново.</p>
        <button type="button" className="ghost-button" onClick={() => window.location.reload()}>
          Обновить
        </button>
      </div>
    );
  }

  const navItems = [
    { id: 'feed', label: 'Главная', icon: Home },
    { id: 'upload', label: 'Загрузка', icon: PlusSquare },
    { id: 'notifications', label: 'Уведомления', icon: Bell },
    { id: 'profile', label: 'Профиль', icon: User },
    ...(user?.is_admin ? [{ id: 'admin', label: 'Модерация', icon: Shield }] : []),
  ];

  const openProfile = (id) => {
    setProfileUserId(id || null);
    setView('profile');
  };

  const openChat = (userId, userData = null) => {
    setStartChatUserId(userId);
    setStartChatUserData(userData);
    setView('notifications');
  };

  const openVideo = (id, options = null) => {
    if (typeof options === 'string' || Array.isArray(options?.videos)) {
      // Legacy support for (id, source)
      setFeedSource(options);
      setStartCommentId(null);
    } else {
      // If we are coming from a notification, we want a 'focused' view
      const source = options?.focused ? { type: 'single', videoId: id, key: `focused-${id}` } : (options?.source || null);
      setFeedSource(source);
      setStartCommentId(options?.commentId || null);
    }
    setStartVideoId(id);
    setView('feed');
  };

  const renderView = () => {
    switch (view) {
      case 'feed': return (
        <Feed
          user={user}
          source={feedSource}
          startVideoId={startVideoId}
          startCommentId={startCommentId}
          onStarted={() => { setStartVideoId(null); setStartCommentId(null); }}
          onOpenProfile={openProfile}
          onOpenChat={openChat}
        />
      );
      case 'upload': return <Upload user={user} onComplete={() => { setFeedSource(null); setView('feed'); }} />;
      case 'admin': return <AdminDashboard />;
      case 'notifications': return (
        <Notifications
          user={user}
          onOpenVideo={(id, opts) => openVideo(id, opts)}
          onOpenProfile={openProfile}
          startChatUserId={startChatUserId}
          startChatUserData={startChatUserData}
          onStarted={() => { setStartChatUserId(null); setStartChatUserData(null); }}
        />
      );
      case 'profile': return <Profile user={user} profileUserId={profileUserId} onOpenProfile={openProfile} onOpenVideo={openVideo} onOpenChat={openChat} />;
      default: return <Feed user={user} onOpenProfile={openProfile} />;
    }
  };

  return (
    <ConfirmProvider>
      <div className="app-shell">
        <main className="app-content app-view-animate" key={view}>
          <Suspense fallback={(
            <div className="state-view">
              <div className="loader" />
              <p>Открываем раздел...</p>
            </div>
          )}
          >
            {renderView()}
          </Suspense>
        </main>

        <ToastNotifications user={user} onOpenNotifications={() => setView('notifications')} />

        {externalLink && (
          <div className="external-link-backdrop" role="presentation" onMouseDown={() => setExternalLink(null)}>
            <div className="external-link-dialog" role="dialog" aria-modal="true" aria-labelledby="external-link-title" onMouseDown={(event) => event.stopPropagation()}>
              <div>
                <span className="external-link-kicker">Внешняя ссылка</span>
                <h2 id="external-link-title">Открыть сайт?</h2>
                <p>{externalLink.hostname}</p>
                <small>Внешний сайт может видеть ваш IP-адрес и данные браузера.</small>
              </div>
              <div className="external-link-actions">
                <button type="button" className="ghost-button" onClick={() => setExternalLink(null)}>
                  Отмена
                </button>
                <button type="button" className="primary-button" onClick={confirmExternalLink}>
                  Открыть
                </button>
              </div>
            </div>
          </div>
        )}

        <nav className="app-nav" aria-label="Главная навигация">
          <div className="brand-mark" aria-hidden="true">
            <img src="/brand/avatar.png" alt="" />
            <span>TikTok</span>
          </div>

          {navItems.map((item) => {
            const Icon = item.icon;
            const active = view === item.id;

            return (
              <button
                key={item.id}
                type="button"
                className={`nav-button ${active ? 'nav-button--active' : ''}`}
                onClick={() => {
                  if (item.id === 'feed') {
                    setFeedSource(null);
                    setStartVideoId(null);
                  }
                  if (item.id === 'profile') setProfileUserId(null);
                  setView(item.id);
                }}
                aria-label={item.label}
                title={item.label}
              >
                <Icon size={24} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </ConfirmProvider>
  );
};

export default App;
