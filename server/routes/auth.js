const express = require('express');
const fetch   = require('node-fetch');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const env     = require('../config/env');
const db      = require('../config/databaseAsync');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Не получен код авторизации' });
  }

  try {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      body: new URLSearchParams({
        client_id:     env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type:    'authorization_code',
        code:          code,
      }),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const tokenData = await tokenResponse.json();
    if (tokenData.error) {
      console.error('[AUTH] Token error:', tokenData);
      return res.status(401).json({ error: 'Авторизация Discord не удалась', details: tokenData.error_description });
    }

    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const discordUser = await userResponse.json();

    if (!discordUser.id) {
      return res.status(401).json({ error: 'Не удалось получить данные пользователя Discord' });
    }

    const displayName = discordUser.global_name || discordUser.username;

    let user = await db.get('SELECT * FROM users WHERE discord_id = ?', [discordUser.id]);

    if (!user) {
      const id = uuidv4();
      const avatarUrl = discordUser.avatar 
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/${Number(discordUser.discriminator || 0) % 5}.png`;

      await db.run(`
        INSERT INTO users (id, discord_id, username, display_name, avatar_url, updated_at)
        VALUES (?, ?, ?, ?, ?, unixepoch())
      `, [id, discordUser.id, discordUser.username, displayName, avatarUrl]);

      user = await db.get('SELECT * FROM users WHERE id = ?', [id]);
      console.log(`[AUTH] New user created: ${user.username} (${user.discord_id})`);
    } else {
      const avatarUrl = discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
        : user.avatar_url;

      await db.run('UPDATE users SET username = ?, display_name = ?, avatar_url = ?, updated_at = unixepoch() WHERE id = ?',
        [discordUser.username, displayName, avatarUrl, user.id]);
      user = await db.get('SELECT * FROM users WHERE id = ?', [user.id]);
    }

    const token = jwt.sign(
      { sub: user.id, did: user.discord_id },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN }
    );

    res.json({
      token,
      user: {
        id:         user.id,
        discord_id: user.discord_id,
        username:   user.username,
        display_name: user.display_name || user.username,
        avatar_url: user.avatar_url,
        bio:        user.bio,
        is_private: Boolean(user.is_private),
        is_banned:  Boolean(user.is_banned),
        ban_reason: user.ban_reason,
        is_admin:   require('../config/admins').ADMIN_IDS.has(user.discord_id),
      }
    });

  } catch (err) {
    console.error('[AUTH ERROR]', err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

module.exports = router;
