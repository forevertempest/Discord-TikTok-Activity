require('dotenv').config({ path: require('path').join(__dirname, '../../config/.env') });

const required = [
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'JWT_SECRET',
  'ADMIN_DISCORD_IDS',
];

function intEnv(name, fallback) {
  const value = parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

for (const key of required) {
  if (!process.env[key] || process.env[key].startsWith('YOUR_') || process.env[key].startsWith('REPLACE_')) {
    console.warn(`[WARN] env var ${key} is not configured — some features may not work`);
  }
}

module.exports = {
  PORT:                   intEnv('PORT', 3000),
  NODE_ENV:               process.env.NODE_ENV || 'development',
  DISCORD_CLIENT_ID:      process.env.DISCORD_CLIENT_ID || '',
  DISCORD_CLIENT_SECRET:  process.env.DISCORD_CLIENT_SECRET || '',
  DISCORD_REDIRECT_URI:   process.env.DISCORD_REDIRECT_URI || '',
  DISCORD_ACTIVITY_URL:   process.env.DISCORD_ACTIVITY_URL || '',
  DISCORD_BOT_TOKEN:      process.env.DISCORD_BOT_TOKEN || '',
  JWT_SECRET:             process.env.JWT_SECRET || 'dev-secret-change-in-prod',
  JWT_EXPIRES_IN:         '24h',
  ADMIN_DISCORD_IDS_RAW:  process.env.ADMIN_DISCORD_IDS || '',
  UPLOADS_DIR:            process.env.UPLOADS_DIR || require('path').join(__dirname, '../../uploads'),
  DATABASE_PATH:          process.env.DATABASE_PATH || require('path').join(__dirname, '../../database/tiktok.db'),
  MAX_FILE_SIZE_MB:       intEnv('MAX_FILE_SIZE_MB', 80),
  MAX_VIDEO_FILE_SIZE_MB: intEnv('MAX_VIDEO_FILE_SIZE_MB', intEnv('MAX_FILE_SIZE_MB', 80)),
  MAX_VIDEO_DURATION_SEC: intEnv('MAX_VIDEO_DURATION_SEC', 180),
  MAX_PHOTOS_PER_POST:    intEnv('MAX_PHOTOS_PER_POST', 12),
  MAX_PHOTO_FILE_SIZE_MB: intEnv('MAX_PHOTO_FILE_SIZE_MB', 8),
  MAX_PHOTO_TOTAL_SIZE_MB: intEnv('MAX_PHOTO_TOTAL_SIZE_MB', 40),
};
