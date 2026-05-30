import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { ChevronDown, ChevronUp } from 'lucide-react';
import VideoCard from './VideoCard';

const PAGE_SIZE = 12;
const REFRESH_MS = 30000;

function createFeedSeed() {
  return Math.floor(Math.random() * 900000) + 100000;
}

function storageGet(key, fallback = null) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch (err) {
    return fallback;
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    // Storage can be restricted inside embeds; sound still works for this session.
  }
}

const Feed = ({ user, source, startVideoId, startCommentId, feedSessionKey, onStarted, onOpenProfile, onOpenChat }) => {
  const [videos, setVideos] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  const [feedType, setFeedType] = useState('recommended'); // 'recommended', 'following'
  const [feedRefreshKey, setFeedRefreshKey] = useState(0);
  const [soundEnabled, setSoundEnabled] = useState(() => storageGet('tiktok:sound') === 'on');
  const containerRef = useRef(null);
  const cardRefs = useRef([]);
  const feedSeedRef = useRef(createFeedSeed());
  const lastFeedSessionKeyRef = useRef(feedSessionKey);
  const sourceKey = source?.key || 'main';
  const isProfileSource = Array.isArray(source?.videos);
  const isMainFeed = !isProfileSource && !source;

  const goToVideo = useCallback((index) => {
    if (videos.length === 0) return;

    const nextIndex = Math.max(0, Math.min(index, videos.length - 1));
    const target = cardRefs.current[nextIndex];
    if (!target) return;

    target.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
      inline: 'nearest',
    });

    setActiveIndex(nextIndex);
  }, [videos.length]);

  const goToNext = useCallback(() => {
    goToVideo(activeIndex + 1);
  }, [activeIndex, goToVideo]);

  const goToPrevious = useCallback(() => {
    goToVideo(activeIndex - 1);
  }, [activeIndex, goToVideo]);

  const removeVideo = useCallback((videoId) => {
    // Legacy support, the global event listener will handle the main state update.
  }, []);

  useEffect(() => {
    const onGlobalDelete = (event) => {
      setVideos((items) => {
        const next = items.filter(v => v.id !== event.detail);
        if (next.length < items.length) {
          setActiveIndex((idx) => Math.max(0, Math.min(idx, Math.max(0, next.length - 1))));
        }
        return next;
      });
    };
    window.addEventListener('tiktok:video-deleted', onGlobalDelete);
    return () => window.removeEventListener('tiktok:video-deleted', onGlobalDelete);
  }, []);

  const enableSound = useCallback(() => {
    storageSet('tiktok:sound', 'on');
    setSoundEnabled(true);
  }, []);

  const refreshFeed = useCallback((type) => {
    if (!isMainFeed) return;
    setFeedType(type);
    feedSeedRef.current = createFeedSeed();
    setActiveIndex(0);
    setHasMore(true);
    setError('');
    setVideos([]);
    setFeedRefreshKey((value) => value + 1);
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [isMainFeed]);

  useEffect(() => {
    if (lastFeedSessionKeyRef.current === feedSessionKey) return;
    lastFeedSessionKeyRef.current = feedSessionKey;
    if (!isMainFeed) return;

    feedSeedRef.current = createFeedSeed();
    setActiveIndex(0);
    setHasMore(true);
    setError('');
    setVideos([]);
    setFeedRefreshKey((value) => value + 1);
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [feedSessionKey, isMainFeed]);

  const loadMore = useCallback(async () => {
    if (isProfileSource || loading || loadingMore || !hasMore || videos.length === 0) return;

    setLoadingMore(true);
    try {
      const endpoint = feedType === 'following' ? '/api/videos/following' : '/api/videos/trending';
      const res = await axios.get(endpoint, {
        params: { limit: PAGE_SIZE, offset: videos.length, seed: feedSeedRef.current },
      });
      setVideos((items) => {
        const ids = new Set(items.map((item) => item.id));
        const fresh = res.data.filter((item) => !ids.has(item.id));
        return [...items, ...fresh];
      });
      setHasMore(res.data.length === PAGE_SIZE);
    } catch (err) {
      // The visible feed should stay usable if the next page fails.
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, isProfileSource, loading, loadingMore, videos.length, feedType]);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    async function fetchVideos() {
      setLoading(true);
      try {
        if (isProfileSource) {
          if (!mounted) return;
          setVideos(source.videos || []);
          setActiveIndex(0);
          setHasMore(false);
          setError('');
          return;
        }

        if (source?.type === 'single' && source?.videoId) {
          const res = await axios.get(`/api/videos/trending?limit=100`); // Load a bunch so we can find it, but the UI will focus on one
          // Actually, we want a specific video view. Let's just fetch it if the API supports it, or filter.
          const single = res.data.find(v => v.id === source.videoId);
          if (single) {
            setVideos([single]);
            setActiveIndex(0);
            setHasMore(false);
          } else {
            // Fallback to trending if not found
            setVideos(res.data);
            setActiveIndex(0);
            setHasMore(true);
          }
          setError('');
          return;
        }

        const endpoint = feedType === 'following' ? '/api/videos/following' : '/api/videos/trending';
        const res = await axios.get(endpoint, {
          params: { limit: PAGE_SIZE, offset: 0, seed: feedSeedRef.current },
          signal: controller.signal,
        });
        if (!mounted) return;

        setVideos(res.data);
        setActiveIndex(0);
        setHasMore(res.data.length === PAGE_SIZE);
        setError('');
      } catch (err) {
        if (axios.isCancel?.(err) || err.name === 'CanceledError') return;
        console.error('[FEED ERROR]', err);
        if (mounted) setError('Не удалось загрузить ленту.');
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchVideos();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [isProfileSource, sourceKey, feedType, feedRefreshKey]);

  useEffect(() => {
    if (isProfileSource) return undefined;

    const timer = window.setInterval(async () => {
      if (document.hidden) return;

      try {
        const endpoint = feedType === 'following' ? '/api/videos/following' : '/api/videos/trending';
        const res = await axios.get(endpoint, {
          params: {
            limit: Math.max(PAGE_SIZE, Math.min(videos.length || PAGE_SIZE, 36)),
            seed: feedSeedRef.current,
          },
        });
        setVideos((items) => {
          const freshById = new Map(res.data.map((item) => [item.id, item]));
          return items.map((item) => (
            freshById.has(item.id) ? { ...item, ...freshById.get(item.id) } : item
          ));
        });
      } catch (err) {
        // Counts are opportunistic; the current video should not blink on transient polling failures.
      }
    }, REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [isProfileSource, videos.length]);

  useEffect(() => {
    if (activeIndex >= videos.length - 4) {
      loadMore();
    }
  }, [activeIndex, loadMore, videos.length]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || videos.length === 0) return undefined;
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
    detail: {
      href: target.href,
      hostname: target.hostname,
    },
  });

  const wasNotHandled = window.dispatchEvent(request);
  if (wasNotHandled) {
    await openConfirmedExternalLink(target.href);
  }
}

export function LinkifiedText({ text, className, as: Tag = 'span' }) {
  const value = String(text || '');
  if (!value) return null;

  const nodes = [];
  let lastIndex = 0;
  URL_RE.lastIndex = 0;

  value.replace(URL_RE, (match, _url, offset) => {
    const clean = cleanUrl(match);
    const suffix = match.slice(clean.length);

    if (offset > lastIndex) nodes.push(value.slice(lastIndex, offset));

    const href = clean.startsWith('http') ? clean : `https://${clean}`;
    nodes.push(
      <a
        key={`${href}-${offset}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => openExternalLink(event, href)}
        onMouseDown={stopLinkEvent}
        onPointerDown={stopLinkEvent}
        onPointerUp={stopLinkEvent}
        onTouchStart={stopLinkEvent}
        onTouchMove={stopLinkEvent}
        onTouchEnd={stopLinkEvent}
      >
        {clean}
      </a>
    );

    if (suffix) nodes.push(suffix);
    lastIndex = offset + match.length;
    return match;
  });

/**
 * client/src/hooks/useDiscordAuth.js
 * Handles Discord SDK identification and JWT session management.
 */
import { useEffect, useState } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import axios from 'axios';

axios.defaults.timeout = 300000;

export const discordSdk = new DiscordSDK(import.meta.env.VITE_DISCORD_CLIENT_ID);
const USER_CACHE_KEY = 'tiktok:user';
let authPromise = null;

function readCachedSession() {
  let token = null;
  let rawUser = null;
  let user = null;

  try {
    token = localStorage.getItem('token');
    rawUser = localStorage.getItem(USER_CACHE_KEY);
  } catch (err) {
    return { token: null, user: null };
  }

  if (rawUser) {
    try {
      user = JSON.parse(rawUser);
    } catch (err) {
      try {
        localStorage.removeItem(USER_CACHE_KEY);
      } catch (removeErr) {
        // Ignore storage cleanup failures in restricted embeds.
      }
    }
  }

  if (token) {
    axios.defaults.headers.common.Authorization = `Bearer ${token}`;
  }

  return { token, user };
}

const initialSession = readCachedSession();

function timeout(ms, message) {
  return new Promise((_, reject) => {
    window.setTimeout(() => reject(new Error(message)), ms);
  });
}

function withTimeout(promise, ms, message) {
  return Promise.race([promise, timeout(ms, message)]);
}

async function loginWithDiscord() {
  await withTimeout(discordSdk.ready(), 8000, 'Discord SDK долго не отвечает');

  const { code } = await withTimeout(discordSdk.commands.authorize({
    client_id: import.meta.env.VITE_DISCORD_CLIENT_ID,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify'],
  }), 10000, 'Discord не успел выдать код авторизации');

  const response = await axios.post('/api/auth/login', { code });
  const { token, user: userData } = response.data;

  try {
    localStorage.setItem('token', token);
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(userData));
  } catch (err) {
    console.warn('[AUTH CACHE WARN]', err.message);
  }
  axios.defaults.headers.common.Authorization = `Bearer ${token}`;

  return userData;
}

function getAuthPromise() {
  if (!authPromise) {
    authPromise = loginWithDiscord().catch((err) => {
      authPromise = null;
      throw err;
    });
  }

  return authPromise;
}

function clearCachedSession() {
  try {
    localStorage.removeItem('token');
    localStorage.removeItem(USER_CACHE_KEY);
  } catch (err) {
    // Restricted embeds can block storage writes; the next OAuth attempt still repairs state.
  }
  delete axios.defaults.headers.common.Authorization;
}

async function refreshCachedUser() {
  if (!initialSession.token) return null;

  const res = await axios.get('/api/users/me');
  try {
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(res.data));
  } catch (storageErr) {
    console.warn('[AUTH CACHE WARN]', storageErr.message);
  }

  return res.data;
}

export function useDiscordAuth() {
  const [user, setUser] = useState(initialSession.user);
  const [loading, setLoading] = useState(!initialSession.user);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function setup() {
      try {
        let userData = null;

        if (initialSession.token && initialSession.user) {
          userData = await refreshCachedUser();
