import { createApp } from './app.js';
import { config } from './config.js';
import { seedIfEmpty, ensureDemoCatalog, ensureAdmin } from './seed.js';
import { startTelegramBot } from './notify.js';
import { expireUnpaidOrders } from './orderOps.js';

if (config.isProd && config.seedDemo) console.warn('SEED_DEMO=1: в базе демо-аккаунты с публичными паролями (info@/seller@zetex.uz). Не используйте на боевом сайте.');
if (config.isProd && !config.seedDemo) console.log('Production: демо-данные не создаются. Каталог пуст, пока продавцы не добавят товары.');

if (seedIfEmpty()) console.log('Demo data seeded (buyer: info@zetex.uz / seller: seller@zetex.uz)');

const added = ensureDemoCatalog();
if (added) console.log(`Demo catalog: +${added} products`);

const admin = ensureAdmin();
if (admin) console.log(`Admin account: ${admin}${process.env.ADMIN_PASSWORD ? '' : ' / Admin12345! (demo; в production задайте ADMIN_EMAIL и ADMIN_PASSWORD)'}`);
else if (config.isProd && !process.env.ADMIN_EMAIL) console.warn('ADMIN_EMAIL/ADMIN_PASSWORD не заданы — администратора нет');

if (config.isProd && !process.env.JWT_SECRET) console.warn('JWT_SECRET не задан: секрет сохранён в data/.jwt_secret. Для нескольких серверов задайте его явно.');

startTelegramBot();

// раз в минуту отменяем онлайн-заказы, за которые не заплатили вовремя
setInterval(() => {
  try { const n = expireUnpaidOrders(); if (n) console.log(`Отменено неоплаченных заказов: ${n}`); } catch (e) { console.error(e); }
}, 60 * 1000).unref();

createApp().listen(config.port, () => {
  console.log(`Zetex API: http://localhost:${config.port}/api`);
});
