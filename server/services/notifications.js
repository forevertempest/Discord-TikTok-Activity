const db = require('../config/databaseAsync');
const fetch = require('node-fetch');
const env = require('../config/env');

const COMPONENTS_V2_FLAG = 1 << 15;
const BRAND_COLOR = 0x8df7ff;

const SYSTEM_TYPES = new Set([
  'ACCOUNT_BLOCKED',
  'ACCOUNT_UNBLOCKED',
  'COMMENT_DELETED',
  'MODERATION_DECISION',
  'USER_RESET',
  'USER_WARNING',
  'VIDEO_DELETED',
]);

function getNotificationCategory(type) {
  return SYSTEM_TYPES.has(type) ? 'system' : 'general';
}

async function createNotification(userId, type, payload = {}) {
  if (!userId || !type) return null;

  try {
    const result = await db.run(`
      INSERT INTO notifications (user_id, type, payload, created_at)
      VALUES (?, ?, ?, unixepoch())
    `, [userId, type, JSON.stringify(payload || {})]);

    sendDiscordDm(userId, type, payload).catch((err) => {
      console.warn('[DISCORD DM WARN]', err.message);
    });

    return result;
  } catch (err) {
    console.warn('[NOTIFICATION WARN]', err.message);
    return null;
  }
}

function truncate(value, max = 900) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function absoluteUrl(value) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  if (!env.DISCORD_ACTIVITY_URL) return null;

  try {
    return new URL(value, env.DISCORD_ACTIVITY_URL).toString();
  } catch (err) {
    return null;
  }
}

async function getActor(payload = {}) {
  if (!payload.actor_id) return null;
  return db.get('SELECT username, display_name, avatar_url FROM users WHERE id = ?', [payload.actor_id]);
}

function dmText(type, payload = {}, actorUser = null) {
  const actorName = actorUser?.display_name || payload.actor_display_name || payload.actor_username || actorUser?.username || 'Пользователь';
  const actor = actorUser?.username || payload.actor_username ? `@${actorUser?.username || payload.actor_username}` : actorName;

  switch (type) {
    case 'VIDEO_SHARE':
      return `**${actor}** отправил вам публикацию в TikTok.`;
    case 'NEW_MESSAGE':
      return `**${actor}** написал вам в TikTok.`;
    case 'NEW_LIKE':
      return `**${actor}** поставил лайк вашей публикации.`;
    case 'NEW_COMMENT':
      return `**${actor}** оставил комментарий.\n> ${truncate(payload.body || 'Комментарий', 260)}`;
    case 'NEW_FOLLOW':
      return `**${actor}** подписался на вас.`;
    case 'USER_WARNING':
      return `***Системное предупреждение***\n${payload.reason ? `Причина: \`${truncate(payload.reason, 180)}\`` : 'Причина не указана.'}`;
    case 'MODERATION_DECISION':
      return payload.status === 'approved'
        ? '***Публикация одобрена***\nОна уже доступна в TikTok.'
        : `***Публикация отклонена***\n${payload.reason ? `Причина: \`${truncate(payload.reason, 180)}\`` : 'Причина не указана.'}`;
    case 'ACCOUNT_BLOCKED':
      return `***Аккаунт заблокирован***\n${payload.reason ? `Причина: \`${truncate(payload.reason, 180)}\`` : 'Причина не указана.'}`;
    case 'ACCOUNT_UNBLOCKED':
      return '***Аккаунт разблокирован***\nДоступ к TikTok восстановлен.';
    case 'COMMENT_DELETED':
      return '***Комментарий удалён***\nКомментарий удалён автором публикации или модерацией.';
    case 'USER_RESET':
      return `***Аккаунт очищен модерацией***\n${payload.reason ? `Причина: \`${truncate(payload.reason, 180)}\`` : 'Причина не указана.'}`;
    case 'VIDEO_DELETED':
      return `***Публикация удалена***\n${payload.reason ? `Причина: \`${truncate(payload.reason, 180)}\`` : 'Причина не указана.'}`;
    default:
      return '***Новое уведомление***\nОткройте TikTok, чтобы посмотреть детали.';
  }
}

function buildDiscordPayload(type, payload = {}, actorUser = null) {
  const avatarUrl = absoluteUrl(actorUser?.avatar_url) || absoluteUrl('/brand/avatar.png?v=2') || 'https://cdn.discordapp.com/embed/avatars/0.png';
  const content = `## TikTok\n${dmText(type, payload, actorUser)}`;

  return {
    flags: COMPONENTS_V2_FLAG,
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 17,
        accent_color: BRAND_COLOR,
        components: [
          {
            type: 9,
            components: [
              {
                type: 10,
                content: truncate(content, 1200),
              },
            ],
            accessory: {
              type: 11,
              media: { url: avatarUrl },
              description: 'TikTok',
            },
          },
        ],
      },
    ],
  };
}

async function sendDiscordDm(userId, type, payload = {}) {
  if (!env.DISCORD_BOT_TOKEN) return;

  const [user, actorUser] = await Promise.all([
    db.get('SELECT discord_id FROM users WHERE id = ?', [userId]),
    getActor(payload),
  ]);
  if (!user?.discord_id) return;

  const channelRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ recipient_id: user.discord_id }),
  });

  if (!channelRes.ok) return;
  const channel = await channelRes.json();
  if (!channel?.id) return;

  const messageRes = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildDiscordPayload(type, payload, actorUser)),
  });

  if (!messageRes.ok) {
    const details = await messageRes.text().catch(() => '');
    console.warn('[DISCORD DM WARN]', details || `status ${messageRes.status}`);
  }
}

function parsePayload(value) {
  try {
    return JSON.parse(value || '{}');
  } catch (err) {
    return {};
  }
}

module.exports = {
  SYSTEM_TYPES,
  createNotification,
  getNotificationCategory,
  parsePayload,
};
