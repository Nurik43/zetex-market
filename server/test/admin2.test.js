import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zetex-adm-'));
process.env.DATA_DIR = dir;
process.env.NODE_ENV = 'test';

let server, base, db, outbox, totp;
before(async () => {
  const { createApp } = await import('../src/app.js');
  const seed = await import('../src/seed.js');
  db = (await import('../src/db.js')).db;
  outbox = (await import('../src/mailer.js')).outbox;
  totp = await import('../src/totp.js');
  seed.seedIfEmpty(); seed.ensureDemoCatalog(); seed.ensureAdmin();
  await new Promise((r) => { server = createApp().listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function call(method, url, body, token) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {}; try { data = JSON.parse(text); } catch { /* csv */ }
  return { status: res.status, data, text, res };
}
const login = async (email, password, code) => (await call('POST', '/auth/login', { email, password, code })).data.token;
const buyerT = () => login('info@zetex.uz', 'Password123!');
const sellerT = () => login('seller@zetex.uz', 'SellerPassword123');
const adminT = () => login('admin@zetex.uz', 'Admin12345!');
const PICKUP = { deliveryMethod: 'pickup', city: 'Ташкент', pickupPoint: 'tash-1', recipient: 'Тест Тестов', phone: '+998901234567' };
const newProduct = (title) => ({ title, category: 'Электроника', subcategory: '', price: 100000, image: 'https://example.com/a.jpg', stock: 5 });

test('блокировка требует причину, пишется в журнал, причина видна при входе', async () => {
  const a = await adminT();
  const reg = await call('POST', '/auth/register', { acceptTerms: true, email: 'blk@x.uz', password: 'Passw0rdX', firstName: 'Блок', lastName: 'Тест' });
  const id = reg.data.user.id;
  assert.equal((await call('PATCH', `/admin/users/${id}`, { blocked: true }, a)).status, 400);
  assert.equal((await call('PATCH', `/admin/users/${id}`, { blocked: true, reason: 'рассылка спама' }, a)).status, 200);
  const r = await call('POST', '/auth/login', { email: 'blk@x.uz', password: 'Passw0rdX' });
  assert.equal(r.status, 403);
  assert.match(r.data.error, /рассылка спама/);
  assert.ok(outbox.some((m) => m.to === 'blk@x.uz' && /заблокирован/.test(m.subject)));
  const log = (await call('GET', '/admin/audit?action=user.block', null, a)).data.items;
  assert.equal(log[0].targetId, String(id));
  assert.equal(log[0].reason, 'рассылка спама');
  // карточка пользователя
  const d = (await call('GET', `/admin/users/${id}`, null, a)).data;
  assert.equal(d.user.blockedReason, 'рассылка спама');
  assert.equal(d.history[0].action, 'user.block');
  assert.equal((await call('PATCH', `/admin/users/${id}`, { blocked: false }, a)).status, 200);
  assert.ok(await login('blk@x.uz', 'Passw0rdX'));
});

test('модерация новых товаров: режимы, очередь, одобрение, проверенный продавец', async () => {
  const a = await adminT(), s = await sellerT();
  assert.equal((await call('PUT', '/admin/settings', { moderation: 'all' }, a)).status, 200);
  const p = (await call('POST', '/products', newProduct('Товар на проверке'), s)).data.product;
  assert.equal(p.status, 'pending');
  assert.equal((await call('GET', `/products/${p.id}`)).status, 404); // в каталоге не виден
  assert.ok((await call('GET', '/admin/products?status=pending', null, a)).data.items.some((x) => x.id === p.id));
  assert.equal((await call('GET', '/admin/stats', null, a)).data.products.pending, 1);
  // одобряем и доверяем продавцу
  assert.equal((await call('PATCH', `/admin/products/${p.id}/status`, { status: 'active', trustSeller: true }, a)).status, 200);
  assert.equal((await call('GET', `/products/${p.id}`)).status, 200);
  // режим «только новые продавцы»: проверенный публикует сразу
  await call('PUT', '/admin/settings', { moderation: 'new_sellers' }, a);
  assert.equal((await call('POST', '/products', newProduct('Товар проверенного'), s)).data.product.status, 'active');
  const sellerRow = db.prepare("SELECT id FROM users WHERE email = 'seller@zetex.uz'").get();
  await call('PATCH', `/admin/users/${sellerRow.id}`, { trusted: false }, a);
  assert.equal((await call('POST', '/products', newProduct('Товар непроверенного'), s)).data.product.status, 'pending');
  await call('PUT', '/admin/settings', { moderation: 'off' }, a);
  assert.equal((await call('POST', '/products', newProduct('Обычный товар'), s)).data.product.status, 'active');
});

test('массовые действия: скрыть с причиной, причина видна продавцу, удалить отзывы', async () => {
  const a = await adminT(), s = await sellerT();
  const ids = [];
  for (const t of ['Массовый А', 'Массовый Б']) ids.push((await call('POST', '/products', newProduct(t), s)).data.product.id);
  assert.equal((await call('POST', '/admin/products/bulk', { ids, action: 'hide' }, a)).status, 400); // без причины
  const r = await call('POST', '/admin/products/bulk', { ids, action: 'hide', reason: 'фото не по теме' }, a);
  assert.equal(r.data.done, 2);
  const mine = (await call('GET', '/products/mine/list', null, s)).data.items.find((x) => x.id === ids[0]);
  assert.equal(mine.status, 'hidden');
  assert.equal(mine.statusReason, 'фото не по теме');
  assert.equal((await call('POST', '/admin/products/bulk', { ids, action: 'activate' }, a)).data.done, 2);
  assert.equal((await call('POST', '/admin/products/bulk', { ids: [], action: 'activate' }, a)).status, 400);
  assert.equal((await call('POST', '/admin/products/bulk', { ids, action: 'delete', reason: 'дубликаты' }, a)).data.done, 2);
  assert.equal((await call('GET', `/products/${ids[0]}`)).status, 404);
});

test('комиссия и выплаты: баланс продавца, нельзя выплатить больше остатка', async () => {
  const a = await adminT(), b = await buyerT(), s = await sellerT();
  await call('PUT', '/admin/settings', { commissionDefault: 10, commissionCategories: {} }, a);
  const own = (await call('GET', '/products/mine/list', null, s)).data.items.find((x) => x.status === 'active');
  const o = await call('POST', '/orders', { ...PICKUP, items: [{ productId: own.id, qty: 2 }] }, b);
  assert.equal(o.status, 201);
  for (const st of ['confirmed', 'shipped', 'delivered']) assert.equal((await call('PATCH', `/orders/seller/${o.data.order.id}/status`, { status: st }, s)).status, 200);
  const gross = own.price * 2;
  const stats = (await call('GET', '/orders/seller/stats', null, s)).data;
  assert.equal(stats.gross, gross);
  assert.equal(stats.commission, Math.round(gross * 0.1));
  assert.equal(stats.balance, gross - Math.round(gross * 0.1));
  const sellerId = db.prepare("SELECT id FROM users WHERE email = 'seller@zetex.uz'").get().id;
  assert.equal((await call('POST', '/admin/finance/payouts', { sellerId, amount: stats.balance + 1 }, a)).status, 409);
  assert.equal((await call('POST', '/admin/finance/payouts', { sellerId, amount: 1000, note: 'на карту' }, a)).status, 201);
  const after = (await call('GET', '/orders/seller/stats', null, s)).data;
  assert.equal(after.paid, 1000);
  assert.equal(after.balance, stats.balance - 1000);
  const list = (await call('GET', '/admin/finance/sellers', null, a)).data;
  assert.ok(list.items.some((x) => x.id === sellerId && x.balance === after.balance));
  assert.equal((await call('GET', '/orders/seller/payouts', null, s)).data.items[0].amount, 1000);
  // комиссия по категории применяется к новым заказам
  await call('PUT', '/admin/settings', { commissionCategories: { [own.category]: 20 } }, a);
  const o2 = await call('POST', '/orders', { ...PICKUP, items: [{ productId: own.id, qty: 1 }] }, b);
  const item = db.prepare('SELECT commission_pct p FROM order_items WHERE order_id = ?').get(o2.data.order.id);
  assert.equal(item.p, 20);
  await call('PUT', '/admin/settings', { commissionCategories: {} }, a);
});

test('карточка заказа: события, ручная смена статуса, возврат', async () => {
  const a = await adminT(), b = await buyerT();
  const o = (await call('POST', '/orders', { ...PICKUP, paymentMethod: 'mock', items: [{ productId: 5, qty: 1 }] }, b)).data.order;
  let d = (await call('GET', `/admin/orders/${o.id}`, null, a)).data;
  assert.equal(d.events[0].type, 'placed');
  assert.equal(d.items.length, 1);
  assert.equal((await call('POST', `/admin/orders/${o.id}/status`, { status: 'confirmed' }, a)).status, 409); // не оплачен
  db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ?").run(o.id);
  assert.equal((await call('POST', `/admin/orders/${o.id}/status`, { status: 'cancelled' }, a)).status, 400); // нужна причина
  assert.equal((await call('POST', `/admin/orders/${o.id}/status`, { status: 'cancelled', reason: 'просьба покупателя' }, a)).status, 200);
  d = (await call('GET', `/admin/orders/${o.id}`, null, a)).data;
  assert.equal(d.order.status, 'cancelled');
  assert.equal(d.order.paymentStatus, 'refund_pending');
  assert.ok(d.events.some((e) => e.type === 'refund_pending'));
  assert.equal((await call('POST', `/admin/orders/${o.id}/refund-done`, { note: 'перевод в Payme' }, a)).status, 200);
  d = (await call('GET', `/admin/orders/${o.id}`, null, a)).data;
  assert.equal(d.order.paymentStatus, 'refunded');
  assert.equal(d.events.at(-1).type, 'refunded');
  // фильтры
  const f = (await call('GET', `/admin/orders?status=cancelled&minTotal=1&sort=total_desc&from=2020-01-01&to=2100-01-01`, null, a)).data;
  assert.ok(f.items.some((x) => x.id === o.id));
  assert.equal((await call('GET', `/admin/orders?from=bad`, null, a)).status, 400);
});

test('роли в админке: модератор, финансист, защита последнего полного админа', async () => {
  const a = await adminT();
  const mk = async (email, scope) => (await call('POST', '/admin/team', { email, password: 'StaffPassw0rd1', firstName: 'Сотр', scope }, a)).status;
  assert.equal(await mk('mod@zetex.uz', 'moderator'), 201);
  assert.equal(await mk('fin@zetex.uz', 'finance'), 201);
  assert.equal(await mk('mod@zetex.uz', 'finance'), 409);
  const m = await login('mod@zetex.uz', 'StaffPassw0rd1'), f = await login('fin@zetex.uz', 'StaffPassw0rd1');
  assert.equal((await call('GET', '/admin/users', null, m)).status, 200);
  assert.equal((await call('GET', '/admin/reports', null, m)).status, 200);
  assert.equal((await call('GET', '/admin/orders', null, m)).status, 403);
  assert.equal((await call('GET', '/admin/settings', null, m)).status, 403);
  assert.equal((await call('GET', '/admin/audit', null, m)).status, 403);
  assert.equal((await call('GET', '/admin/orders', null, f)).status, 200);
  assert.equal((await call('GET', '/admin/finance/sellers', null, f)).status, 200);
  assert.equal((await call('GET', '/admin/users', null, f)).status, 403);
  assert.equal((await call('GET', '/admin/team', null, f)).status, 403);
  assert.equal((await call('GET', '/admin/stats', null, f)).status, 200);
  assert.equal((await call('GET', '/auth/me', null, m)).data.user.adminScope, 'moderator');
  // последний полный админ
  const me = db.prepare("SELECT id FROM users WHERE email = 'admin@zetex.uz'").get().id;
  assert.equal((await call('PATCH', `/admin/team/${me}`, { scope: 'finance' }, a)).status, 400); // себя нельзя
  const modId = db.prepare("SELECT id FROM users WHERE email = 'mod@zetex.uz'").get().id;
  assert.equal((await call('PATCH', `/admin/team/${modId}`, { scope: 'finance' }, a)).status, 200);
  assert.equal((await call('PATCH', `/admin/team/${modId}`, { blocked: true }, a)).status, 200);
  assert.equal((await call('GET', '/admin/users', null, m)).status, 401); // сессия сброшена
});

test('двухфакторная защита админа: настройка, вход с кодом, отключение', async () => {
  const a = await adminT();
  assert.equal((await call('POST', '/admin/team', { email: 'tf@zetex.uz', password: 'StaffPassw0rd1', firstName: 'Два', scope: 'full' }, a)).status, 201);
  const t = await login('tf@zetex.uz', 'StaffPassw0rd1');
  const setup = await call('POST', '/auth/2fa/setup', {}, t);
  assert.equal(setup.status, 200);
  assert.match(setup.data.qr, /^data:image\/png;base64,/);
  assert.match(setup.data.otpauth, /^otpauth:\/\/totp\//);
  assert.equal((await call('POST', '/auth/2fa/enable', { code: '000000' }, t)).status, 400);
  assert.equal((await call('POST', '/auth/2fa/enable', { code: totp.totp(setup.data.secret) }, t)).status, 200);
  let r = await call('POST', '/auth/login', { email: 'tf@zetex.uz', password: 'StaffPassw0rd1' });
  assert.equal(r.status, 401);
  assert.equal(r.data.need2fa, true);
  r = await call('POST', '/auth/login', { email: 'tf@zetex.uz', password: 'StaffPassw0rd1', code: '123456' });
  assert.equal(r.status, 401);
  assert.equal(r.data.need2fa, true);
  r = await call('POST', '/auth/login', { email: 'tf@zetex.uz', password: 'StaffPassw0rd1', code: totp.totp(setup.data.secret) });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.totpEnabled, true);
  assert.equal((await call('POST', '/auth/2fa/disable', { password: 'bad', code: totp.totp(setup.data.secret) }, r.data.token)).status, 400);
  assert.equal((await call('POST', '/auth/2fa/disable', { password: 'StaffPassw0rd1', code: totp.totp(setup.data.secret) }, r.data.token)).status, 200);
  assert.ok(await login('tf@zetex.uz', 'StaffPassw0rd1'));
  // не-админам настройка недоступна
  assert.equal((await call('POST', '/auth/2fa/setup', {}, await buyerT())).status, 403);
});

test('TOTP совпадает с эталонным вектором RFC 6238', () => {
  // секрет «12345678901234567890» в base32, время 59 с → 94287082 (8 цифр) → последние 6: 287082
  assert.equal(totp.hotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1), '287082');
  assert.ok(totp.verifyTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287082', 59_000));
  assert.ok(!totp.verifyTotp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', '287082', 400_000));
});

test('настройки: пункты выдачи, доставка, контакты и объявление видны в /config', async () => {
  const a = await adminT();
  const pts = [{ id: 'new-1', city: 'Самарканд', name: 'Мой пункт', address: 'ул. Новая, 5' }];
  assert.equal((await call('PUT', '/admin/settings', { pickupPoints: [{ ...pts[0], city: 'Париж' }] }, a)).status, 400);
  assert.equal((await call('PUT', '/admin/settings', { commissionDefault: 80 }, a)).status, 400);
  assert.equal((await call('PUT', '/admin/settings', { announcement: { active: true, text: 'x', link: 'javascript:alert(1)' } }, a)).status, 400);
  const r = await call('PUT', '/admin/settings', {
    pickupPoints: pts, deliveryFee: 30000, freeDeliveryFrom: 700000,
    company: { phone: '+998 71 000 00 00' }, announcement: { active: true, text: 'Скидки недели', link: '/catalog' },
  }, a);
  assert.equal(r.status, 200);
  const cfg = (await call('GET', '/config')).data;
  assert.equal(cfg.delivery.pickupPoints[0].id, 'new-1');
  assert.equal(cfg.delivery.fee, 30000);
  assert.equal(cfg.delivery.freeFrom, 700000);
  assert.equal(cfg.company.phone, '+998 71 000 00 00');
  assert.deepEqual(cfg.announcement, { text: 'Скидки недели', link: '/catalog' });
  // новый пункт принимается при заказе, старый — нет
  const b = await buyerT();
  assert.equal((await call('POST', '/orders', { ...PICKUP, pickupPoint: 'new-1', city: 'Самарканд', items: [{ productId: 3, qty: 1 }] }, b)).status, 201);
  assert.equal((await call('POST', '/orders', { ...PICKUP, items: [{ productId: 3, qty: 1 }] }, b)).status, 400);
  await call('PUT', '/admin/settings', { announcement: { active: false, text: '', link: '' } }, a);
  assert.equal((await call('GET', '/config')).data.announcement, null);
});

test('модерация чатов: жалоба на сообщение, просмотр переписки, удаление', async () => {
  const a = await adminT(), b = await buyerT(), s = await sellerT();
  const own = (await call('GET', '/products/mine/list', null, s)).data.items.find((x) => x.status === 'active');
  const conv = (await call('POST', '/chats', { productId: own.id, text: 'Здравствуйте!' }, b)).data.conversationId;
  const msg = (await call('POST', `/chats/${conv}/messages`, { text: 'Пишите мне в мессенджер, дам скидку' }, s)).data.message;
  assert.equal((await call('POST', `/chats/messages/${msg.id}/report`, { reason: 'уводит из сервиса' }, s)).status, 400); // своё
  assert.equal((await call('POST', `/chats/messages/${msg.id}/report`, { reason: 'уводит из сервиса' }, b)).status, 201);
  const reports = (await call('GET', '/admin/chat-reports', null, a)).data;
  assert.equal(reports.items[0].text, 'Пишите мне в мессенджер, дам скидку');
  assert.equal((await call('GET', '/admin/stats', null, a)).data.openChatReports, 1);
  const thread = (await call('GET', `/admin/conversations/${conv}`, null, a)).data;
  assert.equal(thread.messages.length, 2);
  assert.equal(thread.messages[1].reports, 1);
  assert.equal((await call('DELETE', `/admin/messages/${msg.id}`, { reason: 'нарушение правил' }, a)).status, 200);
  assert.equal((await call('GET', `/admin/conversations/${conv}`, null, a)).data.messages.length, 1);
  assert.equal((await call('PATCH', `/admin/chat-reports/${reports.items[0].id}`, { status: 'resolved' }, a)).status, 404); // сообщение удалено вместе с жалобой
  // посторонний не может жаловаться
  const m2 = (await call('POST', `/chats/${conv}/messages`, { text: 'Ещё вопрос' }, b)).data.message;
  assert.equal((await call('POST', `/chats/messages/${m2.id}/report`, {}, await adminT())).status, 403);
  const audits = (await call('GET', '/admin/audit?action=chat', null, a)).data.items;
  assert.ok(audits.some((x) => x.action === 'chat.view'));
});

test('аналитика, выгрузки CSV и защита от формул', async () => {
  const a = await adminT();
  { const r0 = await call('POST', '/orders', { ...PICKUP, pickupPoint: 'new-1', city: 'Самарканд', items: [{ productId: 3, qty: 1 }] }, await buyerT()); assert.equal(r0.status, 201, JSON.stringify(r0.data)); }
  const an = (await call('GET', '/admin/analytics?days=30', null, a)).data;
  assert.equal(an.newUsers.length, 30);
  assert.ok(an.current.orders >= 1);
  assert.equal(an.funnel.length, 3);
  assert.ok(an.topSellers.length >= 1);
  assert.equal((await call('GET', '/admin/analytics?days=5', null, a)).status, 400);
  // имя с формулой не должно исполняться в Excel
  const rf = await call('POST', '/auth/register', { acceptTerms: true, email: 'f@x.uz', password: 'Passw0rdX', firstName: '=HYPERLINK("http://evil")', lastName: 'Фф' });
  assert.equal(rf.status, 201, JSON.stringify(rf.data));
  const csv = await call('GET', '/admin/export/users.csv', null, a);
  assert.match(csv.res.headers.get('content-type'), /text\/csv/);
  assert.ok(csv.text.replace(/^\uFEFF/, '').startsWith('ID;Почта'));
  assert.ok(csv.text.includes("'=HYPERLINK"));
  assert.ok(!/;=HYPERLINK/.test(csv.text));
  for (const u of ['orders', 'finance', 'payouts', 'audit']) {
    const r = await call('GET', `/admin/export/${u}.csv`, null, a);
    assert.equal(r.status, 200, u);
  }
  assert.equal((await call('GET', '/admin/export/users.csv')).status, 401);
  assert.ok((await call('GET', '/admin/audit?action=export', null, a)).data.items.length >= 5);
});

test('история входов и подозрительные заказы не ломают поток', async () => {
  const a = await adminT();
  await call('POST', '/auth/login', { email: 'info@zetex.uz', password: 'wrong' });
  const id = db.prepare("SELECT id FROM users WHERE email = 'info@zetex.uz'").get().id;
  const d = (await call('GET', `/admin/users/${id}`, null, a)).data;
  assert.ok(d.logins.some((l) => l.ok === 0));
  assert.ok(d.logins.some((l) => l.ok === 1));
  assert.ok(d.orders.length >= 1);
});

test('антиспам в чате: много ссылок и дубли отклоняются, при частых нарушениях — автоблокировка', async () => {
  const reg = await call('POST', '/auth/register', { acceptTerms: true, email: 'spam@x.uz', password: 'Passw0rdX', firstName: 'Спам', lastName: 'Бот' });
  const sp = reg.data.token;
  const s = await sellerT();
  const prod = (await call('GET', '/products/mine/list', null, s)).data.items[0];
  const ok = await call('POST', '/chats', { productId: prod.id, text: 'Добрый день, есть в наличии?' }, sp);
  assert.equal(ok.status, 201);
  const conv = ok.data.conversationId;
  const links = await call('POST', `/chats/${conv}/messages`, { text: 'http://a.uz http://b.uz http://c.uz http://d.uz' }, sp);
  assert.equal(links.status, 400);
  for (let i = 0; i < 3; i++) assert.equal((await call('POST', `/chats/${conv}/messages`, { text: 'Купите у меня' }, sp)).status, 201);
  assert.equal((await call('POST', `/chats/${conv}/messages`, { text: 'Купите у меня' }, sp)).status, 429);
  // ещё нарушения → автоблокировка
  for (let i = 0; i < 6; i++) await call('POST', `/chats/${conv}/messages`, { text: 'Купите у меня' }, sp);
  const u = db.prepare("SELECT blocked, blocked_reason FROM users WHERE email = 'spam@x.uz'").get();
  assert.equal(u.blocked, 1);
  assert.match(u.blocked_reason, /спам/);
  const log = db.prepare("SELECT admin_email FROM audit_log WHERE action = 'user.block' AND target_id = (SELECT id FROM users WHERE email = 'spam@x.uz') ORDER BY id DESC").get();
  assert.equal(log.admin_email, 'система');
  assert.equal((await call('POST', `/chats/${conv}/messages`, { text: 'ещё' }, sp)).status, 401);
});

test('главная из настроек: баннеры и тексты, в /config только активные', async () => {
  const a = await adminT();
  const home = {
    title: 'Осенняя распродажа', text: 'Скидки до 30%', button: 'Смотреть',
    banners: [
      { id: 'b1', active: true, title: 'Бесплатная доставка', text: 'от 500 000 сум', link: '/catalog', tone: 'accent' },
      { id: 'b2', active: false, title: 'Скрытый баннер', text: '', link: '', tone: 'brand' },
    ],
  };
  assert.equal((await call('PUT', '/admin/settings', { home: { ...home, banners: [{ ...home.banners[0], link: 'javascript:alert(1)' }] } }, a)).status, 400);
  const saved = await call('PUT', '/admin/settings', { home }, a);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.home.banners.length, 2);
  const cfg = (await call('GET', '/config')).data;
  assert.equal(cfg.home.title, 'Осенняя распродажа');
  assert.deepEqual(cfg.home.banners.map((b) => b.title), ['Бесплатная доставка']);
  await call('PUT', '/admin/settings', { home: { title: '', text: '', button: '', banners: [] } }, a);
  assert.equal((await call('GET', '/config')).data.home.banners.length, 0);
});

test('выгрузки за период: финансы продавцов и выручка по дням', async () => {
  const a = await adminT();
  const rev = await call('GET', '/admin/export/revenue.csv?from=2020-01-01&to=2030-01-01', null, a);
  assert.equal(rev.status, 200);
  assert.match(rev.text, /Оборот/);
  const fin = await call('GET', '/admin/export/finance.csv?from=2020-01-01&to=2030-01-01', null, a);
  assert.equal(fin.status, 200);
  assert.match(fin.text, /Продавец/);
  assert.equal((await call('GET', '/admin/export/finance.csv?from=вчера', null, a)).status, 400);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'export.revenue'").get());
});
