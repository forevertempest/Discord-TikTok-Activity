const path = require('path');
const { Worker } = require('worker_threads');

const worker = new Worker(path.join(__dirname, 'database-worker.js'));
let nextId = 1;
const pending = new Map();
let closedError = null;

function rejectPending(err) {
  for (const request of pending.values()) request.reject(err);
  pending.clear();
}

worker.on('message', ({ id, result, error }) => {
  const request = pending.get(id);
  if (!request) return;

  pending.delete(id);

  if (error) {
    const err = new Error(error.message);
    err.stack = error.stack;
    err.code = error.code;
    request.reject(err);
    return;
  }

  request.resolve(result);
});

worker.on('error', (err) => {
  closedError = err;
  rejectPending(err);
});

worker.on('exit', (code) => {
  if (code === 0 && !closedError) return;
  const err = closedError || new Error(`Database worker stopped with code ${code}`);
  closedError = err;
  rejectPending(err);
  process.nextTick(() => process.exit(1));
});

function call(payload) {
  if (closedError) {
    return Promise.reject(closedError);
  }

  return new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    pending.set(id, { resolve, reject });

    try {
      worker.postMessage({ id, ...payload });
    } catch (err) {
      pending.delete(id);
      reject(err);
    }
  });
}

function get(sql, params) {
  return call({ method: 'get', sql, params });
}

function all(sql, params) {
  return call({ method: 'all', sql, params });
}

function run(sql, params) {
  return call({ method: 'run', sql, params });
}

function exec(sql) {
  return call({ method: 'exec', sql });
}

function transaction(ops) {
  return call({ method: 'transaction', ops });
}

module.exports = {
  get,
  all,
  run,
  exec,
  transaction,
};
