
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Bell, MessageCircle, Search, Send, Shield, X } from 'lucide-react';
import { getMediaUrl } from '../utils/media';

const NOTIFICATION_LIMIT = 30;
const CONVERSATION_LIMIT = 30;
const MESSAGE_LIMIT = 40;

function displayUserName(item) {
  return item?.display_name || item?.username || 'user';
}

function mergeUnique(current, fresh) {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...fresh.filter((item) => !seen.has(item.id))];
}

function notificationText(item) {
  const actor = displayUserName(item.actor || {
    username: item.payload?.actor_username,
    display_name: item.payload?.actor_display_name,
  });
  const reason = item.payload?.reason ? `\nПричина: ${item.payload.reason}` : '';

  switch (item.type) {
    case 'ACCOUNT_BLOCKED':
      return `Аккаунт заблокирован${reason}`;
    case 'ACCOUNT_UNBLOCKED':
      return 'Аккаунт разблокирован';
    case 'COMMENT_DELETED':
      return 'Комментарий удален модерацией';
    case 'FRIEND_VIDEO':
      return `${actor} загрузил новую публикацию`;
    case 'MODERATION_DECISION':
      return item.payload?.status === 'approved'
        ? 'Публикация одобрена'
        : `Публикация отклонена${reason}`;
    case 'NEW_COMMENT':
      return `${actor} написал комментарий\n${item.payload?.body || ''}`;
    case 'NEW_FOLLOW':
      return `${actor} подписался на вас`;
    case 'NEW_LIKE':
      return `${actor} поставил лайк публикации`;
    case 'NEW_MESSAGE':
      return `${actor} написал в личные сообщения`;
    case 'USER_RESET':
      return `Аккаунт очищен модерацией${reason}`;
    case 'USER_WARNING':
      return `Предупреждение системы безопасности${reason}`;
    case 'VIDEO_DELETED':
      return `Публикация удалена модерацией${reason}`;
    case 'VIDEO_SHARE':
      return `${actor} отправил публикацию`;
    default:
      return `Новое уведомление\n${item.type}`;
  }
}

const Notifications = ({ user, onOpenVideo, onOpenProfile }) => {
  const [section, setSection] = useState('notifications');
  const [activeType, setActiveType] = useState('general');
  const [notificationLists, setNotificationLists] = useState({ general: [], system: [] });
  const [notificationHasMore, setNotificationHasMore] = useState({ general: true, system: true });
  const [notificationsLoading, setNotificationsLoading] = useState(false);

  const [conversations, setConversations] = useState([]);
  const [conversationQuery, setConversationQuery] = useState('');
  const [conversationHasMore, setConversationHasMore] = useState(true);
  const [conversationsLoading, setConversationsLoading] = useState(false);

  const [activeConversation, setActiveConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesHasMore, setMessagesHasMore] = useState(true);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [panelMessage, setPanelMessage] = useState('');

  const activeNotifications = notificationLists[activeType] || [];

  const loadNotifications = useCallback(async (type = activeType, reset = false, silent = false) => {
    if (!silent) setNotificationsLoading(true);
    try {
      const offset = reset ? 0 : (notificationLists[type]?.length || 0);
      const res = await axios.get('/api/users/notifications', {
        params: { category: type, limit: NOTIFICATION_LIMIT, offset },
      });
      setNotificationLists((current) => ({
        ...current,
        [type]: reset ? res.data : mergeUnique(current[type] || [], res.data),
      }));
      setNotificationHasMore((current) => ({
        ...current,
        [type]: res.data.length === NOTIFICATION_LIMIT,
      }));
    } finally {
      if (!silent) setNotificationsLoading(false);
    }
  }, [activeType, notificationLists]);

  const loadConversations = useCallback(async (reset = false, silent = false) => {
    if (!silent) setConversationsLoading(true);
    try {
      const offset = reset ? 0 : conversations.length;
      const res = await axios.get('/api/users/conversations', {
        params: {
          q: conversationQuery.trim(),
          limit: CONVERSATION_LIMIT,
          offset,
        },
      });
      setConversations((current) => (reset ? res.data : mergeUnique(current, res.data)));
      setConversationHasMore(res.data.length === CONVERSATION_LIMIT);
    } finally {
      if (!silent) setConversationsLoading(false);
    }
  }, [conversationQuery, conversations.length]);

  useEffect(() => {
    loadNotifications('general', true).catch(() => {});
  }, []);

  useEffect(() => {
    if (section === 'notifications' && activeNotifications.length === 0) {
      loadNotifications(activeType, true).catch(() => {});
    }
    if (section === 'messages' && conversations.length === 0) {
      loadConversations(true).catch(() => {});
    }
  }, [section, activeType]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (section === 'notifications') {
        loadNotifications(activeType, true, true).catch(() => {});
      }
      if (section === 'messages') {
        loadConversations(true, true).catch(() => {});
      }
    }, 15000);

    return () => window.clearInterval(timer);
  }, [activeType, loadConversations, loadNotifications, section]);

  useEffect(() => {
    if (!activeConversation?.id) {
      setMessages([]);
      setMessagesHasMore(true);
      return;
    }

    let mounted = true;

    async function loadMessages() {
      setConversationLoading(true);
      try {
        const res = await axios.get(`/api/users/conversations/${activeConversation.id}/messages`, {
          params: { limit: MESSAGE_LIMIT },
        });
        if (mounted) {
          setMessages(res.data);
          setMessagesHasMore(res.data.length === MESSAGE_LIMIT);
        }
      } finally {
        if (mounted) setConversationLoading(false);
      }
    }

    loadMessages();

    return () => {
      mounted = false;
    };
  }, [activeConversation?.id]);

  const unreadSummary = useMemo(() => ({
    general: notificationLists.general.length,
    system: notificationLists.system.length,
  }), [notificationLists]);

  const openConversation = (conversation) => {
    setPanelMessage('');
    setActiveConversation(conversation);
  };

  const submitConversationSearch = (event) => {
    event.preventDefault();
    loadConversations(true).catch(() => {});
  };

  const loadOlderMessages = async () => {
    if (!activeConversation?.id || olderLoading || messages.length === 0 || !messagesHasMore) return;

    setOlderLoading(true);
    try {
      const res = await axios.get(`/api/users/conversations/${activeConversation.id}/messages`, {
        params: { limit: MESSAGE_LIMIT, before: messages[0].created_at },
      });
      setMessages((items) => [...res.data, ...items]);
      setMessagesHasMore(res.data.length === MESSAGE_LIMIT);
    } finally {
      setOlderLoading(false);
    }
  };

  const submitMessage = async (event) => {
    event.preventDefault();
    if (!activeConversation?.id || !messageText.trim() || user?.is_banned) return;

    try {
      const body = messageText.trim();
      const res = await axios.post(`/api/users/conversations/${activeConversation.id}/messages`, { body });
      setMessages((items) => [...items, res.data]);
      setMessageText('');
      setPanelMessage('');
      setConversations((items) => items.map((item) => (
        item.id === activeConversation.id
          ? { ...item, latest_body: body, latest_video: null, latest_created_at: Math.floor(Date.now() / 1000) }
          : item
      )));
    } catch (err) {
      setPanelMessage(err.response?.data?.error || 'Сообщение не отправлено.');
    }
  };

  const renderNotification = (item) => {
    const avatar = item.actor?.avatar_url || user?.avatar_url;

    return (
      <article className="v2-container" key={item.id}>
        <button
          type="button"
          className="v2-text"
          onClick={() => {
            setActiveConversation(null);
            if (item.video?.id) onOpenVideo?.(item.video.id);
            else if (item.actor?.id) onOpenProfile?.(item.actor.id);
          }}
        >
          <span>{notificationText(item)}</span>
          {item.video?.title?.trim() && <small>{item.video.title.trim()}</small>}
        </button>
        {avatar && <img className="v2-accessory" src={avatar} alt="" />}
      </article>
    );
  };

  const renderMessage = (message) => {
    const mine = message.sender_id === user?.id;

    return (
      <article className={`dm-message ${mine ? 'dm-message--mine' : ''}`} key={message.id}>
        <img src={message.sender_avatar_url || user?.avatar_url} alt="" />
        <div>
          <strong>{mine ? 'Вы' : displayUserName({ username: message.sender_username, display_name: message.sender_display_name })}</strong>
          {message.body && <p>{message.body}</p>}
          {message.video && (
            <button type="button" className="dm-video" onClick={() => onOpenVideo?.(message.video.id)}>
              {message.video.thumbnail_url ? <img src={getMediaUrl(message.video.thumbnail_url)} alt="" /> : null}
              <span>{message.video.title?.trim() || message.video.description || 'Публикация'}</span>
            </button>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="notifications-view">
      <section className="inbox-hero">
        <img src="/brand/avatar.png" alt="" />
        <div>
          <h1>Центр связи</h1>
          <p>Уведомления, система и личные сообщения без лишнего шума.</p>
        </div>
      </section>

      <div className="inbox-sections" role="tablist" aria-label="Разделы уведомлений">
        <button
          type="button"
          className={`tab-button ${section === 'notifications' ? 'tab-button--active' : ''}`}
          onClick={() => setSection('notifications')}
        >
          <Bell size={17} />
          Уведомления
        </button>
        <button
          type="button"
          className={`tab-button ${section === 'messages' ? 'tab-button--active' : ''}`}
          onClick={() => setSection('messages')}
        >
          <MessageCircle size={17} />
          Личные сообщения
        </button>
      </div>

      {section === 'notifications' ? (
        <section className="notifications-panel">
          <div className="section-title section-title--between">
            <div>
              <Bell size={20} />
              <h2>Уведомления</h2>
            </div>
          </div>

          <div className="notification-switch">
            <button
              type="button"
              className={`tab-button ${activeType === 'general' ? 'tab-button--active' : ''}`}
              onClick={() => setActiveType('general')}
            >
              <Bell size={16} />
              Общие
              <span>{unreadSummary.general}</span>
            </button>
            <button
              type="button"
              className={`tab-button ${activeType === 'system' ? 'tab-button--active' : ''}`}
              onClick={() => setActiveType('system')}
            >
              <Shield size={16} />
              Система
              <span>{unreadSummary.system}</span>
            </button>
          </div>

          <div className="v2-list">
            {notificationsLoading && activeNotifications.length === 0 ? (
              <p className="muted-text">Загружаем...</p>
            ) : activeNotifications.length === 0 ? (
              <p className="muted-text">Здесь пока пусто.</p>
            ) : activeNotifications.map(renderNotification)}
          </div>

          {notificationHasMore[activeType] && (
            <button type="button" className="ghost-button load-more-button" onClick={() => loadNotifications(activeType)}>
              Показать еще
            </button>
          )}
        </section>
      ) : (
        <section className="dm-panel">
          <div className="dm-sidebar">
            <div className="section-title">
              <MessageCircle size={20} />
              <h2>Личные сообщения</h2>
            </div>

            <form className="dm-search dm-search--input" onSubmit={submitConversationSearch}>
              <Search size={16} />
              <input
                value={conversationQuery}
                onChange={(event) => setConversationQuery(event.target.value)}
                placeholder="Поиск по ID или нику"
              />
            </form>

            <div className="dm-list">
              {conversationsLoading && conversations.length === 0 ? (
                <p className="muted-text">Загружаем диалоги...</p>
              ) : conversations.length === 0 ? (
                <p className="muted-text">Диалогов пока нет. ЛС доступны взаимным подписчикам.</p>
              ) : conversations.map((conversation) => (
                <button
                  type="button"
                  key={conversation.id}
                  className={`dm-friend ${activeConversation?.id === conversation.id ? 'dm-friend--active' : ''}`}
                  onClick={() => openConversation(conversation)}
                >
                  <span className="avatar-status">
                    <img src={conversation.avatar_url} alt="" />
                    <span className={`online-dot ${conversation.online ? 'online-dot--on' : ''}`} />
                  </span>
                  <div>
                    <strong>{displayUserName(conversation)}</strong>
                    <span>{conversation.latest_video ? 'Публикация' : conversation.latest_body || 'Нет сообщений'}</span>
                  </div>
                </button>
              ))}
            </div>

            {conversationHasMore && (
              <button type="button" className="ghost-button load-more-button" onClick={() => loadConversations(false)}>
                Еще диалоги
              </button>
            )}
          </div>

          <div className="dm-thread">
            <div className="dm-thread-header">
              {activeConversation ? (
                <>
                  <button type="button" className="dm-title" onClick={() => onOpenProfile?.(activeConversation.id)}>
                    <span className="avatar-status">
                      <img src={activeConversation.avatar_url} alt="" />
                      <span className={`online-dot ${activeConversation.online ? 'online-dot--on' : ''}`} />
                    </span>
                    <span>{displayUserName(activeConversation)}</span>
                  </button>
                  <button type="button" className="icon-button" onClick={() => setActiveConversation(null)} aria-label="Закрыть" title="Закрыть">
                    <X size={18} />
                  </button>
                </>
              ) : (
                <span>Выберите диалог</span>
              )}
            </div>

            {panelMessage && <p className="panel-message">{panelMessage}</p>}

            <div className="dm-messages">
              {conversationLoading ? (
                <p className="muted-text">Загружаем...</p>
              ) : messages.length === 0 ? (
                <p className="muted-text">Здесь будут сообщения и отправленные публикации.</p>
              ) : (
                <>
                  {messagesHasMore && (
                    <button type="button" className="ghost-button load-more-button" onClick={loadOlderMessages} disabled={olderLoading}>
                      {olderLoading ? 'Загружаем...' : 'Показать старые'}
                    </button>
                  )}
                  {messages.map(renderMessage)}
                </>
              )}
            </div>

            <form className="dm-form" onSubmit={submitMessage}>
              <textarea
                value={messageText}
                onChange={(event) => setMessageText(event.target.value.slice(0, 500))}
                placeholder="Сообщение"
                disabled={!activeConversation || user?.is_banned}
                rows={2}
              />
              <button type="submit" className="icon-button" disabled={!activeConversation || !messageText.trim() || user?.is_banned} aria-label="Отправить" title="Отправить">
                <Send size={18} />
              </button>
            </form>
          </div>
        </section>
      )}
    </div>
  );
};

export default Notifications;
