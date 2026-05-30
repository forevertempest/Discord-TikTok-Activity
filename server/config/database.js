const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const env      = require('./env');

const dbPath = env.DATABASE_PATH;
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath, {});

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -32000');
db.pragma('temp_store = MEMORY');

console.log(`[DB] Connected: ${dbPath}`);

module.exports = db;
