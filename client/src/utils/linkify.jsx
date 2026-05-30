import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { Bell, X } from 'lucide-react';
import { notificationText } from '../utils/notificationText';

const POLL_MS = 7000;
const TOAST_TTL = 6200;
const LAST_TOAST_PREFIX = 'tiktok:last-toast-notification:';

function storageKey(userId) {
  return `${LAST_TOAST_PREFIX}${userId || 'anonymous'}`;
}

function readLastSeen(userId) {
  try {
    return Number(localStorage.getItem(storageKey(userId)) || 0);
  } catch (err) {
    return 0;
  }
}

function writeLastSeen(userId, value) {
  try {
    localStorage.setItem(storageKey(userId), String(value || 0));
  } catch (err) {
    // Ignore storage restrictions inside embeds.
  }
}

const ToastNotifications = ({ user, onOpenNotifications }) => {
  const [items, setItems] = useState([]);
  const knownIdsRef = useRef(new Set());
  const lastSeenRef = useRef(0);

  useEffect(() => {
    if (!user?.id) return undefined;
    let mounted = true;
    knownIdsRef.current = new Set();
    lastSeenRef.current = readLastSeen(user.id);

    async function poll() {
      if (document.hidden) return;

      try {
        const res = await axios.get('/api/users/notifications', {
          params: { limit: 5, offset: 0 },
        });
        if (!mounted) return;

        const fresh = res.data || [];
        const next = fresh.filter((item) => {
          const isUnknown = !knownIdsRef.current.has(item.id);
          const isNewer = Number(item.created_at || 0) > lastSeenRef.current;
          return isUnknown && isNewer;
        });
        fresh.forEach((item) => knownIdsRef.current.add(item.id));

        const newestCreatedAt = Math.max(lastSeenRef.current, ...fresh.map((item) => Number(item.created_at || 0)));
        lastSeenRef.current = newestCreatedAt;
        writeLastSeen(user.id, newestCreatedAt);

        if (next.length > 0) {
          setItems((current) => [
            ...next.slice(0, 3).map((item) => ({ ...item, toastId: `${item.id}:${Date.now()}` })),
            ...current,
          ].slice(0, 4));
        }
      } catch (err) {
        // Toasts are opportunistic; failed polling should never disturb the app.
      }
    }

    poll();
    const timer = window.setInterval(poll, POLL_MS);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [user?.id]);

  useEffect(() => {
    if (items.length === 0) return undefined;
    const timer = window.setTimeout(() => {
      setItems((current) => current.slice(0, -1));
    }, TOAST_TTL);
    return () => window.clearTimeout(timer);
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div className="toast-stack" aria-live="polite">
      {items.map((item) => (
        <article className="toast-card" key={item.toastId}>
          <button
            type="button"
            className="toast-main"
            onClick={() => onOpenNotifications?.()}
          >
            <Bell size={18} />
import React from 'react';
import { discordSdk } from '../hooks/useDiscordAuth';

const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
export const EXTERNAL_LINK_EVENT = 'tiktok:external-link-request';

function cleanUrl(value) {
  return value.replace(/[),.;!?]+$/g, '');
}

export function hasLink(value) {
  URL_RE.lastIndex = 0;
  return URL_RE.test(String(value || ''));
}

function stopLinkEvent(event) {
  event.stopPropagation();
}

function isDiscordEmbed() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('frame_id') || params.has('instance_id') || params.has('channel_id');
}

function openBrowserTab(href, allowCurrentWindow = true) {
  const opened = window.open(href, '_blank', 'noopener,noreferrer');
  if (!opened && allowCurrentWindow) {
    window.location.assign(href);
  }
}

function normalizeHref(href) {
  if (typeof window === 'undefined') return false;

  try {
    return new URL(href.startsWith('http') ? href : `https://${href}`);
  } catch (err) {
    return null;
  }
}

export async function openConfirmedExternalLink(href) {
  if (isDiscordEmbed() && discordSdk?.commands?.openExternalLink) {
    try {
      const result = await discordSdk.commands.openExternalLink({ url: href });
      if (result?.opened !== false) return;
    } catch (err) {
      // Fall back below for browsers/dev preview. Discord embeds should use the SDK command.
    }
  }

  openBrowserTab(href, !isDiscordEmbed());
}

async function openExternalLink(event, href) {
  event.preventDefault();
  event.stopPropagation();
  event.nativeEvent?.stopImmediatePropagation?.();

  const target = normalizeHref(href);
  if (!target) return;

  if (target.origin === window.location.origin) {
    openBrowserTab(target.href, !isDiscordEmbed());
    return;
  }

  const request = new CustomEvent(EXTERNAL_LINK_EVENT, {
    cancelable: true,
import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Heart,
  MessageCircle,
  Play,
  Plus,
  Send,
  Share2,
  Trash2,
  UserPlus,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useConfirm } from './ConfirmDialog';
import { formatDuration, getMediaUrl } from '../utils/media';
import LinkifiedText, { hasLink } from '../utils/linkify';

const getInitialVolume = () => {
  if (typeof window === 'undefined') return 0.65;
  return window.matchMedia('(max-width: 720px)').matches ? 0.45 : 0.72;
};

function getTouchDistance(touches) {
  if (touches.length < 2) return 0;
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function ignoreMediaError() {
  // Browser autoplay can reject play() without requiring a user-facing error.
}

const VideoCard = ({
  video, isActive, currentUser, onOpenProfile, onDeleted,
  soundEnabled, onSoundEnable, startCommentId, onOpenChat
}) => {
  const { confirm } = useConfirm();
  const videoRef = useRef(null);
  const commentRefs = useRef({});
  const photoTouchRef = useRef(null);
  const clickTimerRef = useRef(null);
  const lastTapRef = useRef(0);
  const holdTimerRef = useRef(null);
  const pinchRef = useRef(null);
  const panRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(getInitialVolume);
  const [uiHidden, setUiHidden] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [photoIndex, setPhotoIndex] = useState(0);
  const [videoError, setVideoError] = useState(false);
  const [progress, setProgress] = useState(0);
  const [liked, setLiked] = useState(Boolean(video.liked_by_me));
  const [favorited, setFavorited] = useState(Boolean(video.favorited_by_me));
  const [following, setFollowing] = useState(Boolean(video.following_author));
  const [likesCount, setLikesCount] = useState(video.likes_count || 0);
  const [commentsCount, setCommentsCount] = useState(video.comments_count || 0);
  const [favoritesCount, setFavoritesCount] = useState(video.favorites_count || 0);
  const [panel, setPanel] = useState('');
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState('');
  const [friends, setFriends] = useState([]);
  const [panelMessage, setPanelMessage] = useState('');
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const mediaType = video.media_type || 'video';
  const isPhotoPost = mediaType === 'photo';
  const mediaUrls = useMemo(() => {
    const fromApi = Array.isArray(video.media_urls) ? video.media_urls.filter(Boolean) : [];
    if (fromApi.length > 0) return fromApi.map(getMediaUrl);
    return [getMediaUrl(video.url || video.file_path)].filter(Boolean);
  }, [video.media_urls, video.url, video.file_path]);
  const videoSrc = mediaUrls[0];
  const posterSrc = getMediaUrl(video.thumbnail_url || video.thumb_path);
  const isOwnPost = currentUser?.id === video.user_id;
  const interactionsDisabled = Boolean(currentUser?.is_banned);
  const authorName = video.display_name || video.username || 'user';
  const cleanTitle = String(video.title || '').trim();
  const cleanDescription = String(video.description || '').trim();
  const shouldCollapseDescription = cleanDescription.length > 20 && !hasLink(cleanDescription);
  const visibleDescription = shouldCollapseDescription && !descriptionExpanded
    ? `${cleanDescription.slice(0, 20)}...`
    : cleanDescription;
  const isMuted = !soundEnabled || volume === 0;

  useEffect(() => {
    setLiked(Boolean(video.liked_by_me));
    setFavorited(Boolean(video.favorited_by_me));
    setFollowing(Boolean(video.following_author));
    setLikesCount(video.likes_count || 0);
    setCommentsCount(video.comments_count || 0);
    setFavoritesCount(video.favorites_count || 0);
    setPhotoIndex(0);
    setPanel('');
    setPanelMessage('');
    setDescriptionExpanded(false);
    setDeleting(false);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    pinchRef.current = null;
    panRef.current = null;
  }, [video.id, video.liked_by_me, video.favorited_by_me, video.following_author, video.likes_count, video.comments_count, video.favorites_count]);

  useEffect(() => {
    if (isActive && startCommentId && !panel) {
      openComments();
    }
  }, [isActive, startCommentId]);

  useEffect(() => {
    if (panel === 'comments' && startCommentId && comments.length > 0) {
      const target = commentRefs.current[startCommentId];
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.add('comment-row--highlight');
        setTimeout(() => target.classList.remove('comment-row--highlight'), 2500);
      }
    }
  }, [panel, comments, startCommentId]);

  useEffect(() => {
    const node = videoRef.current;
    if (!node || !videoSrc || videoError || isPhotoPost) return;

    node.muted = !soundEnabled || volume === 0;
    node.volume = soundEnabled ? volume : 0;

    if (!isActive || panel) {
      node.pause();
      setPlaying(false);
      return;
    }

    node.play()
      .then(() => setPlaying(true))
      .catch(() => {
        setPlaying(false);
      });
  }, [isActive, soundEnabled, volume, videoSrc, videoError, panel, isPhotoPost]);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isSeeking, setIsSeeking] = useState(false);

  const handleTimeUpdate = (event) => {
    if (isSeeking) return;
    const node = event.target;
    setCurrentTime(node.currentTime);
    if (!duration || duration !== node.duration) setDuration(node.duration);
    setProgress((node.currentTime / node.duration) * 100);
  };

  const handleSeekStart = (e) => {
    e.stopPropagation();
    if (isPhotoPost) return;
    const node = videoRef.current;
    if (!node || !node.duration) return;

    setIsSeeking(true);
    if (e.pointerId) e.currentTarget.setPointerCapture(e.pointerId);
    updateSeekPosition(e);
  };

  const handleSeekMove = (e) => {
    if (!isSeeking) return;
    updateSeekPosition(e);
  };

  const handleSeekEnd = (e) => {
    if (!isSeeking) return;
    setIsSeeking(false);
    if (e.pointerId) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {
        // ignore capture errors
      }
    }
  };

  const updateSeekPosition = (e) => {
    const node = videoRef.current;
    const container = e.currentTarget;
    if (!node || !node.duration || !container) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));

    const time = (percentage / 100) * node.duration;
    node.currentTime = time;
    setCurrentTime(time);
    setProgress(percentage);
  };

  useEffect(() => {
    const node = videoRef.current;
    if (!node) return;
    if (isActive) {
      if (node.paused && !isSeeking) {
        node.play().then(() => setPlaying(true)).catch(ignoreMediaError);
      }
