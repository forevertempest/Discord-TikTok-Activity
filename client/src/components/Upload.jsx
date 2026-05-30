import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Images, Upload as UploadIcon, X } from 'lucide-react';

const MAX_PHOTOS = 30;
const MAX_VIDEO_SECONDS = 300;

function getVideoDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration || 0);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('metadata'));
    };
    video.src = url;
  });
}

const Upload = ({ user, onComplete }) => {
  const [files, setFiles] = useState([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [previews, setPreviews] = useState([]);
  const [previewIndex, setPreviewIndex] = useState(0);

  const hasVideo = files.some((file) => file.type.startsWith('video/'));
  const hasPhotos = files.some((file) => file.type.startsWith('image/'));

  useEffect(() => {
    const urls = files.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));

    setPreviews(urls);
    setPreviewIndex(0);

    return () => {
      urls.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, [files]);

  const chooseFiles = async (event) => {
    const selected = Array.from(event.target.files || []);
    const videos = selected.filter((file) => file.type.startsWith('video/'));
    const photos = selected.filter((file) => file.type.startsWith('image/'));

    setError(null);
    event.target.value = '';

    if ((videos.length > 0 && photos.length > 0) || videos.length > 1) {
      setError('Можно загрузить одно видео или до 30 фотографий, без смешивания.');
      return;
    }

    if (hasVideo && selected.length > 0) {
      setError('Для видео доступен только один файл.');
      return;
    }

    if (videos.length === 1) {
      if (files.length > 0) {
        setError('Видео нельзя смешивать с фотографиями.');
        return;
      }

      try {
        const duration = await getVideoDuration(videos[0]);
        if (duration > MAX_VIDEO_SECONDS) {
          setError('Видео должно быть до 5 минут.');
          return;
        }
      } catch (err) {
        setError('Не удалось проверить длительность видео.');
        return;
      }

      setFiles(videos);
      return;
    }

    if (photos.length > 0) {
      if (hasVideo) {
        setError('Видео нельзя смешивать с фотографиями.');
        return;
      }

      const next = [...files, ...photos];
      if (next.length > MAX_PHOTOS) {
        setError('Можно загрузить максимум 30 фотографий.');
        return;
      }

      setFiles(next);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    if (files.length === 0) return;

    setUploading(true);
    setError(null);

    const formData = new FormData();
    files.forEach((file) => formData.append('media', file));
    formData.append('title', title);
    formData.append('description', description);

    try {
      await axios.post('/api/videos/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSuccess(true);
      setFiles([]);
      setTitle('');
      setDescription('');
      setTimeout(() => onComplete?.(), 1600);
    } catch (err) {
      setError(err.response?.data?.error || 'Загрузка не удалась.');
    } finally {
      setUploading(false);
    }
  };

  const movePreview = (direction) => {
    if (previews.length <= 1) return;
    setPreviewIndex((value) => (value + direction + previews.length) % previews.length);
  };

  const activePreview = previews[previewIndex];

  if (user?.is_banned) {
    return (
      <div className="upload-view">
        <div className="state-view state-view--panel">
          <AlertCircle size={42} />
          <p>Аккаунт заблокирован. Загрузка публикаций недоступна.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="upload-view">
      <div className="upload-header">
        <Images size={28} />
        <div>
          <h1>Новая публикация</h1>
          <p>Одно видео до 5 минут или до 30 фотографий.</p>
        </div>
      </div>

      {success ? (
        <div className="state-view state-view--panel upload-success">
          <CheckCircle size={56} />
          <p>Публикация загружена и ждет проверки.</p>
        </div>
      ) : (
        <form className="upload-layout" onSubmit={handleUpload}>
          <div className="upload-drop">
            {activePreview ? (
              <div className="upload-preview">
                {activePreview.file.type.startsWith('video/') ? (
                  <video src={activePreview.url} controls playsInline preload="metadata" />
                ) : (
                  <img src={activePreview.url} alt="" />
                )}

                {previews.length > 1 && (
                  <div className="photo-arrows">
                    <button type="button" className="icon-button" onClick={() => movePreview(-1)} aria-label="Предыдущее фото" title="Предыдущее фото">
                      <ChevronLeft size={20} />
                    </button>
                    <span>{previewIndex + 1}/{previews.length}</span>
                    <button type="button" className="icon-button" onClick={() => movePreview(1)} aria-label="Следующее фото" title="Следующее фото">
                      <ChevronRight size={20} />
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  className="icon-button upload-clear"
                  onClick={() => setFiles([])}
                  aria-label="Убрать файлы"
                  title="Убрать файлы"
                >
                  <X size={20} />
                </button>
              </div>
            ) : (
              <label className="upload-picker">
                <UploadIcon size={44} />
                <span>Выбрать видео или фото</span>
                <input
                  type="file"
                  accept="video/*,image/*"
                  multiple
                  onChange={chooseFiles}
                />
              </label>
            )}
          </div>

          <div className="upload-fields">
            {files.length > 0 && (
              <div className="selected-file">
                <strong>{hasVideo ? files[0].name : `${files.length} фото`}</strong>
                <span>{(files.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toFixed(1)} MB · {hasPhotos ? 'фото' : 'видео'}</span>
              </div>
            )}

            {hasPhotos && files.length < MAX_PHOTOS && (
              <label className="add-more-media">
                <Images size={18} />
                Добавить еще фото
                <input type="file" accept="image/*" multiple onChange={chooseFiles} />
              </label>
            )}

            <label className="field-label" htmlFor="media-title">Название</label>
            <input
              id="media-title"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, 15))}
              placeholder="До 15 символов"
              maxLength={15}
            />
            <span className="field-counter">{title.length}/15</span>

            <label className="field-label" htmlFor="media-description">Описание</label>
            <textarea
              id="media-description"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, 100))}
              placeholder="До 100 символов"
              maxLength={100}
            />
            <span className="field-counter">{description.length}/100</span>

            {error && (
              <div className="form-error">
                <AlertCircle size={20} />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              className="primary-button"
              disabled={files.length === 0 || uploading}
            >
              {uploading ? 'Загружаем...' : 'Отправить на модерацию'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default Upload;
