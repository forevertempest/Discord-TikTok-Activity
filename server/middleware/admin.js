const { ADMIN_IDS } = require('../config/admins');

function adminMiddleware(req, res, next) {
  if (!req.user || !req.user.discord_id) {
    return res.status(401).json({ error: 'Не выполнен вход' });
  }

  if (!ADMIN_IDS.has(req.user.discord_id)) {
    console.warn(`[WARN] Admin access denied for ${req.user.username} (${req.user.discord_id})`);
    return res.status(403).json({ error: 'Нужны права модератора' });
  }

  next();
}

module.exports = adminMiddleware;
