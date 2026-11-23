import fs from 'node:fs';
import { config } from './config.js';
import { db } from './db.js';
import { toProduct } from './util.js';

// Страницы приложения живут на клиенте (React), но поисковикам и соцсетям нужны title, description,
// Open Graph и структурированные данные уже в HTML — подставляем их здесь при отдаче index.html.

const SITE = 'Zetex Market';
const DEFAULT_DESC = 'Маркетплейс: товары от продавцов Узбекистана, цены в сумах, доставка и самовывоз.';

const STATIC_PAGES = {
  '': { title: `${SITE} — маркетплейс`, desc: DEFAULT_DESC, path: '/' },
  catalog: { title: `Каталог товаров — ${SITE}`, desc: 'Все товары маркетплейса: фильтры по категориям, цене и рейтингу.', path: '/catalog' },
  terms: { title: `Пользовательское соглашение — ${SITE}`, desc: 'Условия использования маркетплейса Zetex Market для покупателей и продавцов.', path: '/terms' },
  privacy: { title: `Политика конфиденциальности — ${SITE}`, desc: 'Какие данные мы собираем, зачем и как их защищаем.', path: '/privacy' },
  returns: { title: `Возврат и обмен — ${SITE}`, desc: 'Условия возврата товара и денег, сроки и порядок обращения.', path: '/returns' },
  contacts: { title: `Контакты — ${SITE}`, desc: 'Как связаться со службой поддержки Zetex Market.', path: '/contacts' },
  faq: { title: `Вопросы и ответы — ${SITE}`, desc: 'Ответы на частые вопросы о заказе, оплате, доставке и возврате.', path: '/faq' },
};
// Закрытые от индексации разделы (личные данные, корзина, служебные страницы)
const PRIVATE = new Set(['checkout', 'orders', 'pay', 'favorites', 'admin', 'compare', 'reset-password', 'verify-email']);

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const abs = (p) => (!p ? '' : /^https?:\/\//i.test(p) ? p : config.appUrl + (p.startsWith('/') ? p : `/${p}`));
const clip = (s, n) => { const x = String(s ?? '').replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n - 1).trimEnd()}…` : x; };
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

function productMeta(id) {
  if (!/^\d+$/.test(id)) return null;
  const row = db.prepare("SELECT * FROM products WHERE id = ? AND status = 'active'").get(Number(id));
  if (!row) return null;
  const p = toProduct(row);
  const url = `${config.appUrl}/product/${p.id}`;
  const desc = clip(p.description, 160) || `${p.title} — купить в ${SITE}`;
  const ld = {
    '@context': 'https://schema.org', '@type': 'Product', name: p.title, description: clip(p.description, 500) || p.title,
    image: p.gallery.map(abs), category: p.category, url,
    offers: { '@type': 'Offer', url, priceCurrency: 'UZS', price: p.price, availability: p.stock === 0 ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock' },
  };
  if (p.reviews > 0) ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: p.rating, reviewCount: p.reviews };
  return {
    title: `${p.title} — купить в ${SITE}`, desc, canonical: url, image: abs(p.image), type: 'product', ld,
    noscript: `<h1>${esc(p.title)}</h1><p>${esc(clip(p.description, 400))}</p><p>${esc(p.price.toLocaleString('ru-RU'))} сум</p>`,
  };
}

/** Мета-данные страницы по адресу; null — такой страницы нет (отдаём 404). */
export function metaFor(pathname, query = {}) {
  const parts = pathname.split('/').filter(Boolean);
  const name = parts[0] || '';
  if (name === 'product' && parts.length === 2) return productMeta(parts[1]);
  if (parts.length > 1) return null;
  if (PRIVATE.has(name)) return { title: SITE, desc: DEFAULT_DESC, noindex: true };
  const page = STATIC_PAGES[name];
  if (!page) return null;
  const meta = { title: page.title, desc: page.desc, canonical: config.appUrl + page.path, type: 'website' };
  if (name === 'catalog') {
    // каноничным остаётся адрес только с категорией: поиск, сортировка и страницы не плодят дубли
    const q = new URLSearchParams();
    for (const k of ['category', 'subcategory']) if (typeof query[k] === 'string' && query[k]) q.set(k, query[k]);
    if (q.size) {
      meta.canonical += `?${q}`;
      meta.title = `${query.subcategory || query.category} — купить в каталоге ${SITE}`;
    }
    if (typeof query.q === 'string' && query.q) meta.noindex = true;
  }
  return meta;
}

/** Подставляет мета-данные в index.html (title, description, canonical, Open Graph, JSON-LD). */
export function renderHtml(template, meta) {
  const tags = [
    `<meta name="description" content="${esc(meta.desc)}" />`,
    meta.noindex && '<meta name="robots" content="noindex, nofollow" />',
    meta.canonical && `<link rel="canonical" href="${esc(meta.canonical)}" />`,
    `<meta property="og:site_name" content="${SITE}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.desc)}" />`,
    `<meta property="og:type" content="${meta.type || 'website'}" />`,
    meta.canonical && `<meta property="og:url" content="${esc(meta.canonical)}" />`,
    meta.image && `<meta property="og:image" content="${esc(meta.image)}" />`,
    `<meta name="twitter:card" content="${meta.image ? 'summary_large_image' : 'summary'}" />`,
    meta.ld && `<script type="application/ld+json">${jsonLd(meta.ld)}</script>`,
  ].filter(Boolean).join('\n    ');
  let html = template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(meta.title)}</title>`)
    .replace(/<meta name="description"[^>]*>\s*/g, '')
    .replace('</head>', `    ${tags}\n  </head>`);
  if (meta.noscript) html = html.replace('<div id="root"></div>', `<div id="root"></div>\n    <noscript>${meta.noscript}</noscript>`);
  return html;
}

/** Обработчик для всех «страничных» адресов: отдаёт index.html с нужными мета-данными и правильным кодом ответа. */
export function spaHandler(indexFile) {
  // Шаблон перечитывается, если index.html изменился (после новой сборки хэши файлов в нём другие)
  let template = '';
  let mtime = 0;
  const load = () => {
    const m = fs.statSync(indexFile).mtimeMs;
    if (m !== mtime) { template = fs.readFileSync(indexFile, 'utf8'); mtime = m; }
    return template;
  };
  load();
  return (req, res) => {
    const html = load();
    const meta = metaFor(req.path, req.query);
    res.set('Cache-Control', 'no-cache').type('html');
    if (!meta) return res.status(404).send(renderHtml(html, { title: `Страница не найдена — ${SITE}`, desc: DEFAULT_DESC, noindex: true }));
    res.send(renderHtml(html, meta));
  };
}

export function robotsTxt() {
  return [
    'User-agent: *',
    'Disallow: /api/',
    ...[...PRIVATE].map((p) => `Disallow: /${p}`),
    'Allow: /',
    '',
    `Sitemap: ${config.appUrl}/sitemap.xml`,
    '',
  ].join('\n');
}

export function sitemapXml() {
  const urls = Object.values(STATIC_PAGES).map((p) => ({ loc: config.appUrl + p.path }));
  const cats = db.prepare("SELECT DISTINCT category FROM products WHERE status = 'active' AND category != ''").all();
  for (const { category } of cats) urls.push({ loc: `${config.appUrl}/catalog?${new URLSearchParams({ category })}` });
  const rows = db.prepare("SELECT id, created_at FROM products WHERE status = 'active' ORDER BY id LIMIT 49000").all();
  for (const r of rows) urls.push({ loc: `${config.appUrl}/product/${r.id}`, lastmod: r.created_at.slice(0, 10) });
  const body = urls.map((u) => `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
