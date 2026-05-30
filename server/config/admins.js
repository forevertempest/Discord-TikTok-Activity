const env = require('./env');

const ADMIN_IDS = new Set(
  env.ADMIN_DISCORD_IDS_RAW
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
);

if (ADMIN_IDS.size === 0) {
  console.warn('[WARN] ADMIN_DISCORD_IDS is empty — no admins configured!');
} else {
  console.log(`[INFO] Admin IDs loaded: ${ADMIN_IDS.size} admin(s)`);
}

module.exports = { ADMIN_IDS };
