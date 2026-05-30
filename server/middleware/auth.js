const jwt = require('jsonwebtoken');
const env  = require('../config/env');
const db   = require('../config/databaseAsync');
const { ADMIN_IDS } = require('../config/admins');

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Не выполнен вход' });
  }

  const token = header.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Сессия устарела, откройте активность заново' });
  }

  let user;
  try {
    user = await db.get('SELECT * FROM users WHERE id = ?', [payload.sub]);
    if (!user) {
      return res.status(401).json({ error: 'Пользователь не найден' });
    }
    db.run('UPDATE users SET last_seen_at = unixepoch() WHERE id = ?', [user.id]).catch((err) => {
      console.warn('[AUTH WARN] last_seen update failed:', err.message);
    });
  } catch (err) {
    return next(err);
  }

  req.user = {
    id:         user.id,
    discord_id: user.discord_id,
    username:   user.username,
    display_name: user.display_name || user.username,
    avatar_url: user.avatar_url,
    bio: user.bio,
    is_private: Boolean(user.is_private),
    upload_disabled: user.upload_disabled,
    is_banned: Boolean(user.is_banned),
    ban_reason: user.ban_reason,
    is_admin: ADMIN_IDS.has(user.discord_id),
  };
  next();
}

module.exports = authMiddleware;
