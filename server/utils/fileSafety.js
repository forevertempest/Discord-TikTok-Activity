const fs = require('fs/promises');

const SNIFF_BYTES = 4096;
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm']);
const MP4_FAMILY = new Set(['video/mp4', 'video/quicktime']);

function ascii(buffer, start, end) {
  return buffer.subarray(start, end).toString('ascii');
}

function startsWith(buffer, signature) {
  if (buffer.length < signature.length) return false;
  return signature.every((value, index) => buffer[index] === value);
}

async function readHeader(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function detectMediaType(buffer) {
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return { kind: 'image', mime: 'image/jpeg' };
  }

  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', mime: 'image/png' };
  }

  if (buffer.length >= 12 && ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 12) === 'WEBP') {
    return { kind: 'image', mime: 'image/webp' };
  }

  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { kind: 'video', mime: 'video/webm' };
  }

  if (buffer.length >= 12 && ascii(buffer, 4, 8) === 'ftyp') {
    const brands = ascii(buffer, 8, Math.min(buffer.length, 80));
    return {
      kind: 'video',
      mime: brands.includes('qt  ') ? 'video/quicktime' : 'video/mp4',
    };
  }

  return null;
}

async function validateUploadedFile(file) {
  if (!file?.path || !file?.mimetype) {
    return { ok: false, error: 'Файл не удалось проверить.' };
  }

  const detected = detectMediaType(await readHeader(file.path));
  if (!detected) {
    return { ok: false, error: 'Файл не похож на безопасное фото или видео.' };
  }

  if (file.mimetype.startsWith('image/')) {
    if (!IMAGE_MIME_TYPES.has(file.mimetype) || detected.kind !== 'image' || detected.mime !== file.mimetype) {
      return { ok: false, error: 'Формат фото не совпадает с содержимым файла.' };
    }
    return { ok: true, detected };
  }

  if (file.mimetype.startsWith('video/')) {
    const validWebm = file.mimetype === 'video/webm' && detected.mime === 'video/webm';
    const validMp4Family = MP4_FAMILY.has(file.mimetype) && MP4_FAMILY.has(detected.mime);
    if (!VIDEO_MIME_TYPES.has(file.mimetype) || detected.kind !== 'video' || (!validWebm && !validMp4Family)) {
      return { ok: false, error: 'Формат видео не совпадает с содержимым файла.' };
    }
    return { ok: true, detected };
  }

  return { ok: false, error: 'Этот тип файла не поддерживается.' };
}

module.exports = {
  IMAGE_MIME_TYPES,
  VIDEO_MIME_TYPES,
  validateUploadedFile,
};
