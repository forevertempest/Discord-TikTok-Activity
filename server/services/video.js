const ffmpeg = require('fluent-ffmpeg');
const path   = require('path');
const fs     = require('fs');

const FFMPEG_PATH = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const FFPROBE_PATH = process.env.FFPROBE_PATH || '/usr/bin/ffprobe';

if (fs.existsSync(FFMPEG_PATH)) {
  ffmpeg.setFfmpegPath(FFMPEG_PATH);
}

if (fs.existsSync(FFPROBE_PATH)) {
  ffmpeg.setFfprobePath(FFPROBE_PATH);
}

function generateThumbnail(videoPath, outputDir) {
  return new Promise((resolve, reject) => {
    const filename = path.basename(videoPath, path.extname(videoPath)) + '.jpg';
    const outputPath = path.join(outputDir, filename);

    ffmpeg(videoPath)
      .screenshots({
        timestamps: ['00:00:01'],
        filename: filename,
        folder: outputDir,
        size: '720x?'
      })
      .on('end', () => {
        resolve(filename);
      })
      .on('error', (err) => {
        console.error('[FFMPEG ERROR]', err);
        reject(err);
      });
  });
}

function getVideoMetadata(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata);
    });
  });
}

async function getVideoDuration(videoPath) {
  const metadata = await getVideoMetadata(videoPath);
  return metadata.format.duration;
}

module.exports = {
  generateThumbnail,
  getVideoMetadata,
  getVideoDuration
};
