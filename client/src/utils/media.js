export function getMediaUrl(value) {
  if (!value) return '';

  if (/^https?:\/\//i.test(value)) return value;

  const normalized = String(value)
    .replace(/^\/+/, '')
    .replace(/^uploads\/+/i, '');

  return `/uploads/${normalized}`;
}

export function formatDuration(seconds) {
  const value = Number(seconds || 0);
  const minutes = Math.floor(value / 60);
  const remaining = Math.max(0, Math.round(value % 60));

  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}
function toUploadUrl(filePath) {
  if (!filePath) return null;

  const value = String(filePath);
  if (/^https?:\/\//i.test(value)) return value;

  const normalized = value
    .replace(/^\/+/, '')
    .replace(/^uploads\/+/i, '');

  return `/uploads/${normalized}`;
}

function withMediaUrls(row) {
  if (!row) return row;

  let mediaPaths = [];
  if (row.media_paths) {
    try {
      const parsed = JSON.parse(row.media_paths);
      if (Array.isArray(parsed)) mediaPaths = parsed.filter(Boolean);
    } catch (err) {
      mediaPaths = [];
    }
  }

  if (mediaPaths.length === 0 && row.file_path) {
    mediaPaths = [row.file_path];
  }

  return {
    ...row,
    media_type: row.media_type || 'video',
    media_paths: mediaPaths,
    media_urls: mediaPaths.map(toUploadUrl),
    media_count: mediaPaths.length,
    url: toUploadUrl(row.file_path),
    thumbnail_url: toUploadUrl(row.thumb_path),
  };
}

module.exports = {
  toUploadUrl,
  withMediaUrls,
};
