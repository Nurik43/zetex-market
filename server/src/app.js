import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import './db.js';
import authRoutes from './routes/auth.js';
import productRoutes from './routes/products.js';
import reviewRoutes from './routes/reviews.js';
import favoriteRoutes from './routes/favorites.js';
import uploadRoutes from './routes/uploads.js';
import orderRoutes from './routes/orders.js';
import cartRoutes from './routes/cart.js';
import accountRoutes from './routes/account.js';
import chatRoutes from './routes/chats.js';
import promoRoutes from './routes/promos.js';
import paymentRoutes from './routes/payments.js';
import adminRoutes from './routes/admin.js';
import miscRoutes from './routes/misc.js';
import { HttpError } from './util.js';
import { spaHandler, robotsTxt, sitemapXml } from './seo.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1); // за Caddy/nginx: нужен реальный IP для лимитов

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  }));
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  // Общий лимит запросов; callbacks платёжных систем под него не попадают
  app.use('/api', rateLimit({
    windowMs: 60 * 1000,
    limit: Number(process.env.API_RATE_LIMIT) || (process.env.NODE_ENV === 'test' ? 100_000 : 300),
    skip: (req) => req.path.startsWith('/payments/payme') || req.path.startsWith('/payments/click'),
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Слишком много запросов. Подождите минуту.' },
  }));

  app.use('/uploads', express.static(config.uploadDir, {
    maxAge: '30d', immutable: true, index: false, dotfiles: 'deny',
    setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
  }));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/products', productRoutes);
  app.use('/api', reviewRoutes);
  app.use('/api/favorites', favoriteRoutes);
  app.use('/api/cart', cartRoutes);
  app.use('/api/account', accountRoutes);
  app.use('/api/chats', chatRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/promos', promoRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', miscRoutes);

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Маршрут не найден')));

  app.get('/robots.txt', (_req, res) => res.type('text/plain').send(robotsTxt()));
  app.get('/sitemap.xml', (_req, res) => res.set('Cache-Control', 'public, max-age=3600').type('application/xml').send(sitemapXml()));

  // Одним сервером раздаём и API, и собранный фронтенд (npm run build) — удобно для Docker
  const indexFile = path.join(config.distDir, 'index.html');
  if (fs.existsSync(indexFile)) {
    app.use('/assets', express.static(path.join(config.distDir, 'assets'), { maxAge: '1y', immutable: true }));
    app.use(express.static(config.distDir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|uploads\/).*/, spaHandler(indexFile));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Слишком большой запрос' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Некорректный JSON' });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.need2fa ? { need2fa: true } : {}) });
    console.error(err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });
  return app;
}
