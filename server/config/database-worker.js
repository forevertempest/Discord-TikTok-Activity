const { parentPort } = require('worker_threads');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const env = require('./env');

const dbPath = env.DATABASE_PATH;
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath, {});
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000');
db.pragma('temp_store = MEMORY');
db.pragma('busy_timeout = 5000');

function normalizeParams(params) {
  if (params === undefined || params === null) return [];
  if (Array.isArray(params)) return params;
  return [params];
}

function execute(method, sql, params) {
  const statement = db.prepare(sql);
  const bind = normalizeParams(params);
  return statement[method](...bind);
}

function executeTransaction(ops) {
  return db.transaction((items) => items.map((op) => {
    if (op.method === 'exec') {
      db.exec(op.sql);
      return { success: true };
    }
    return execute(op.method || 'run', op.sql, op.params);
  }))(ops);
}

parentPort.on('message', (message) => {
  const { id, method, sql, params, ops } = message;

  try {
    let result;

    if (method === 'exec') {
      db.exec(sql);
      result = { success: true };
    } else if (method === 'transaction') {
      result = executeTransaction(ops || []);
    } else {
      result = execute(method, sql, params);
    }

    parentPort.postMessage({ id, result });
  } catch (err) {
    parentPort.postMessage({
      id,
      error: {
        message: err.message,
        stack: err.stack,
        code: err.code,
      },
    });
  }
});
