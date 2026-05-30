function ensureActiveUser(req, res) {
  if (!req.user?.is_banned) return true;

  res.status(403).json({
    error: 'Аккаунт заблокирован. Сейчас доступны только просмотр ленты и профилей.',
    reason: req.user.ban_reason || null,
  });
  return false;
}

module.exports = {
  ensureActiveUser,
};
