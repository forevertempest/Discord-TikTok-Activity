function runLater(name, task) {
  setImmediate(async () => {
    try {
      await task();
    } catch (err) {
      console.error(`[JOB ERROR] ${name}`, err);
    }
  });
}

function runChunked(name, items, handler, chunkSize = 25) {
  const list = Array.isArray(items) ? items.slice() : [];
  let index = 0;

  const next = async () => {
    try {
      const end = Math.min(index + chunkSize, list.length);
      for (; index < end; index += 1) {
        await handler(list[index], index);
      }
    } catch (err) {
      console.error(`[JOB ERROR] ${name}`, err);
      return;
    }

    if (index < list.length) setImmediate(next);
  };

  setImmediate(next);
}

module.exports = {
  runLater,
  runChunked,
};
