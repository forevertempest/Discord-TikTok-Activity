const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const path    = require('path');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const env     = require('./config/env');
require('./database/migrate');

const authRoutes   = require('./routes/auth');
const videoRoutes  = require('./routes/videos');
const userRoutes   = require('./routes/users');
const adminRoutes  = require('./routes/admin');

const app = express();
app.set('etag', false);
app.set('trust proxy', 1);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 900,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Подождите немного.' },
  skip: (req) => req.path === '/health',
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[REQUEST] ${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
  });
  next();
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV
  });
});

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow:\n');
});

app.get('/sitemap.xml', (req, res) => {
  res.status(404).type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset />');
});

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  frameguard: false,
}));
app.use(cors());
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    const type = res.getHeader('Content-Type');
    if (type && (type.startsWith('video/') || type.startsWith('image/'))) {
      return false;
    }
    return compression.filter(req, res);
  },
}));
app.use(express.json());
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});
app.use('/api', apiLimiter);

const clientDistPath = path.join(__dirname, '../client/dist');
const safeUploadExtensions = new Set(['.mp4', '.mov', '.webm', '.jpg', '.jpeg', '.png', '.webp']);

app.use('/uploads', express.static(env.UPLOADS_DIR, {
  maxAge: '7d',
  immutable: true,
  setHeaders: (res, filePath) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; script-src 'none'; style-src 'none'; sandbox");

    if (!safeUploadExtensions.has(path.extname(filePath).toLowerCase())) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment');
    }
  },
}));
app.use('/assets', express.static(path.join(clientDistPath, 'assets'), {
  maxAge: '1y',
  immutable: true,
}));
app.use('/brand', express.static(path.join(clientDistPath, 'brand'), {
  maxAge: '7d',
}));
app.use(express.static(clientDistPath, {
  maxAge: 0,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));

app.use('/api/auth',   authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/users',  userRoutes);
app.use('/api/admin',  adminRoutes);

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next();
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(clientDistPath, 'index.html'), (err) => {
    if (err) {
      res.status(404).send('Frontend not built or index.html missing');
    }
  });
});

app.use((err, req, res, next) => {
  console.error('[SERVER ERROR]', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`[SERVER] TikTok backend running on http://0.0.0.0:${env.PORT}`);
  console.log(`[SERVER] Mode: ${env.NODE_ENV}`);
  console.log(`[SERVER] Uploads: ${env.UPLOADS_DIR}`);
});

server.timeout = 600000;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

server.on('error', (err) => {
  console.error('[SERVER STARTUP ERROR]', err);
});
