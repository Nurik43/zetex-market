import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zetex-feat-'));
process.env.DATA_DIR = dir;
process.env.NODE_ENV = 'test';
process.env.PAYME_KEY = 'paykey';
process.env.PAYME_MERCHANT_ID = 'merch1';
process.env.CLICK_SERVICE_ID = '777';
process.env.CLICK_MERCHANT_ID = '888';
process.env.CLICK_SECRET_KEY = 'clicksecret';

let server, base, outbox;
before(async () => {
  const { createApp } = await import('../src/app.js');
  const seed = await import('../src/seed.js');
  outbox = (await import('../src/mailer.js')).outbox;
  seed.seedIfEmpty(); seed.ensureDemoCatalog(); seed.ensureAdmin();
  await new Promise((r) => { server = createApp().listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function raw(method, url, { body, token, headers = {}, form } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers,
    },
    body: form ? new URLSearchParams(form).toString() : body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})), res };
}
const call = (m, u, body, token) => raw(m, u, { body, token });
const login = async (email, password) => (await call('POST', '/auth/login', { email, password })).data.token;
const buyerT = () => login('info@zetex.uz', 'Password123!');
const sellerT = () => login('seller@zetex.uz', 'SellerPassword123');
const adminT = () => login('admin@zetex.uz', 'Admin12345!');
const PICKUP = { deliveryMethod: 'pickup', city: 'Ташкент', pickupPoint: 'tash-1', recipient: 'Тест Тестов', phone: '+998901234567' };

async function deliveredOrder(buyer, seller, productId = 3, extra = {}) {
  const r = await call('POST', '/orders', { ...PICKUP, ...extra, items: [{ productId, qty: 1 }] }, buyer);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const id = r.data.order.id;
  for (const s of ['confirmed', 'shipped', 'delivered']) {
    assert.equal((await call('PATCH', `/orders/seller/${id}/status`, { status: s }, seller)).status, 200);
  }
  return r.data.order;
}

test('заказ: обязательны получатель и телефон, доставка требует адрес, пункт выдачи — из списка', async () => {
  const b = await buyerT();
  const items = [{ productId: 3, qty: 1 }];
  assert.equal((await call('POST', '/orders', { items }, b)).status, 400);
  assert.equal((await call('POST', '/orders', { items, recipient: 'Али', phone: '123', deliveryMethod: 'pickup', pickupPoint: 'tash-1', city: 'Ташкент' }, b)).status, 400);
  assert.equal((await call('POST', '/orders', { items, ...PICKUP, pickupPoint: 'nope' }, b)).status, 400);
  assert.equal((await call('POST', '/orders', { items, ...PICKUP, deliveryMethod: 'delivery', address: '' }, b)).status, 400);
  const ok = await call('POST', '/orders', { items, ...PICKUP, deliveryMethod: 'delivery', address: 'ул. Навои, 5' }, b);
  assert.equal(ok.status, 201);
  assert.ok(ok.data.order.deliveryFee >= 0);
});

test('отзывы: только после доставки, один на товар, рейтинг пересчитывается, ответ продавца', async () => {
  const b = await buyerT(), s = await sellerT();
  const pid = 4;
  assert.equal((await call('POST', `/products/${pid}/reviews`, { rating: 5, text: 'x' }, b)).status, 403);
  await deliveredOrder(b, s, pid);
  assert.equal((await call('POST', `/products/${pid}/reviews`, { rating: 9 }, b)).status, 400);
  const r = await call('POST', `/products/${pid}/reviews`, { rating: 4, text: 'Хорошо' }, b);
  assert.equal(r.status, 201);
  assert.equal((await call('POST', `/products/${pid}/reviews`, { rating: 5 }, b)).status, 409);
  const p = (await call('GET', `/products/${pid}`)).data.product;
  assert.equal(p.rating, 4); assert.equal(p.reviews, 1);
  assert.equal((await call('POST', `/reviews/${r.data.id}/reply`, { text: 'Спасибо!' }, b)).status, 403);
  assert.equal((await call('POST', `/reviews/${r.data.id}/reply`, { text: 'Спасибо!' }, s)).status, 200);
  const list = await call('GET', `/products/${pid}/reviews`);
  assert.equal(list.data.items[0].reply, 'Спасибо!');
  assert.equal((await call('DELETE', `/reviews/${r.data.id}`, null, b)).status, 200);
  assert.equal((await call('GET', `/products/${pid}`)).data.product.reviews, 0);
});

test('промокоды: скидка считается на сервере, лимиты, чужой продавец', async () => {
  const b = await buyerT(), s = await sellerT(), a = await adminT();
  assert.equal((await call('POST', '/promos/mine', { code: 'bad', type: 'percent', value: 10 }, b)).status, 403);
  const created = await call('POST', '/promos/mine', { code: 'sale10', type: 'percent', value: 10 }, s);
  assert.equal(created.status, 201);
  assert.equal((await call('POST', '/promos/mine', { code: 'SALE10', type: 'percent', value: 10 }, s)).status, 409);
  assert.equal((await call('POST', '/promos/mine', { code: 'BIG', type: 'percent', value: 99 }, s)).status, 400);
  const own = (await call('GET', '/products/mine/list', null, s)).data.items[0];
  const v = await call('POST', '/promos/validate', { code: 'sale10', deliveryMethod: 'pickup', items: [{ productId: own.id, qty: 2 }] }, b);
  assert.equal(v.status, 200);
  assert.equal(v.data.discount, Math.round(own.price * 2 * 0.1));
  assert.equal((await call('POST', '/promos/validate', { code: 'NOPE', items: [{ productId: own.id, qty: 1 }] }, b)).status, 400);
  // заказ с промокодом
  const o = await call('POST', '/orders', { ...PICKUP, promoCode: 'SALE10', items: [{ productId: own.id, qty: 1 }] }, b);
  assert.equal(o.status, 201);
  assert.equal(o.data.order.discount, Math.round(own.price * 0.1));
  assert.equal(o.data.order.total, own.price - o.data.order.discount);
  // общий промокод админа с лимитом 1 использование
  assert.equal((await call('POST', '/admin/promos', { code: 'ONCE', type: 'fixed', value: 1000, maxUses: 1 }, a)).status, 201);
  const first = await call('POST', '/orders', { ...PICKUP, promoCode: 'ONCE', items: [{ productId: own.id, qty: 1 }] }, b);
  assert.equal(first.status, 201);
  assert.equal((await call('POST', '/orders', { ...PICKUP, promoCode: 'ONCE', items: [{ productId: own.id, qty: 1 }] }, b)).status, 400);
  // отмена возвращает использование
  await call('POST', `/orders/${first.data.order.id}/cancel`, null, b);
  assert.equal((await call('POST', '/orders', { ...PICKUP, promoCode: 'ONCE', items: [{ productId: own.id, qty: 1 }] }, b)).status, 201);
});

test('товар: старая цена должна быть выше, галерея и характеристики сохраняются, скрытый не виден в каталоге', async () => {
  const s = await sellerT(), b = await buyerT();
  const base0 = { title: 'Тестовый товар галереи', price: 100000, category: 'Электроника', subcategory: 'Смартфоны', description: 'Описание', stock: 5, image: 'https://example.com/x.png' };
  const body = { ...base0, category: 'Электроника', subcategory: 'Смартфоны' };
  assert.equal((await call('POST', '/products', { ...body, oldPrice: 50000 }, s)).status, 400);
  const r = await call('POST', '/products', { ...body, oldPrice: 150000, images: ['https://example.com/y.png'], specs: [{ name: 'Цвет', value: 'Чёрный' }] }, s);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const p = r.data.product;
  assert.equal(p.oldPrice, 150000); assert.deepEqual(p.specs, [{ name: 'Цвет', value: 'Чёрный' }]); assert.ok(p.gallery.length >= 1);
  assert.equal((await call('PATCH', `/admin/products/${p.id}/status`, { status: 'hidden', reason: 'тест' }, await adminT())).status, 200);
  const list = (await call('GET', '/products?q=галереи')).data.items;
  assert.equal(list.length, 0);
  assert.equal((await call('GET', `/products/${p.id}`, null, b)).status, 404);
  assert.equal((await call('GET', `/products/${p.id}`, null, s)).status, 200);
});

test('CSV-импорт: предпросмотр не пишет в базу, импорт создаёт и обновляет', async () => {
  const s = await sellerT(), b = await buyerT();
  const csv = 'название;цена;категория;подкатегория;остаток;описание\nИмпорт тест 1;12000;Электроника;Смартфоны;3;Описание\n;100;Электроника;Смартфоны;1;без названия\n';
  assert.equal((await call('POST', '/products/import', { csv, dryRun: true }, b)).status, 403);
  const dry = await call('POST', '/products/import', { csv, dryRun: true }, s);
  assert.equal(dry.status, 200, JSON.stringify(dry.data));
  assert.equal((await call('GET', '/products?q=Импорт тест 1')).data.items.length, 0);
  const real = await call('POST', '/products/import', { csv }, s);
  assert.equal(real.status, 200);
  assert.equal(real.data.created, 1); assert.ok(real.data.errors.length >= 1);
  assert.equal((await call('GET', '/products?q=Импорт тест 1')).data.items.length, 1);
  const again = await call('POST', '/products/import', { csv: csv.replace(';12000;', ';15000;') }, s);
  assert.equal(again.data.updated, 1);
});

test('восстановление пароля и подтверждение почты', async () => {
  const email = 'reset@x.uz';
  const reg = await call('POST', '/auth/register', { acceptTerms: true, email, password: 'OldPassw0rd', firstName: 'Рита', lastName: 'Сброс' });
  assert.equal(reg.status, 201);
  assert.equal(reg.data.user.emailVerified, false);
  const verifyMail = outbox.findLast((m) => m.to === email);
  const vt = verifyMail.text.match(/token=([\w-]+)/)[1];
  assert.equal((await call('POST', '/auth/verify-email', { token: 'x'.repeat(20) })).status, 400);
  assert.equal((await call('POST', '/auth/verify-email', { token: vt })).status, 200);
  assert.equal((await call('POST', '/auth/verify-email', { token: vt })).status, 400); // одноразовый
  assert.equal((await call('GET', '/auth/me', null, reg.data.token)).data.user.emailVerified, true);

  // для несуществующей почты ответ такой же
  assert.equal((await call('POST', '/auth/forgot-password', { email: 'nobody@x.uz' })).status, 200);
  assert.equal((await call('POST', '/auth/forgot-password', { email })).status, 200);
  const rt = outbox.findLast((m) => m.to === email).text.match(/token=([\w-]+)/)[1];
  assert.equal((await call('POST', '/auth/reset-password', { token: rt, password: 'short' })).status, 400);
  assert.equal((await call('POST', '/auth/reset-password', { token: rt, password: 'NewPassw0rd!' })).status, 200);
  assert.equal((await call('POST', '/auth/reset-password', { token: rt, password: 'Another1Pass' })).status, 400);
  assert.equal((await call('GET', '/auth/me', null, reg.data.token)).status, 401); // старые сессии сброшены
  assert.equal((await call('POST', '/auth/login', { email, password: 'OldPassw0rd' })).status, 401);
  assert.equal((await call('POST', '/auth/login', { email, password: 'NewPassw0rd!' })).status, 200);
});

test('cookie-сессия: httpOnly, без заголовка клиента небезопасные запросы отклоняются (CSRF)', async () => {
  const web = { 'X-Zetex-Client': 'web' };
  const l = await raw('POST', '/auth/login', { body: { email: 'info@zetex.uz', password: 'Password123!' }, headers: web });
  assert.equal(l.status, 200);
  assert.equal(l.data.token, undefined); // токен не отдаётся скриптам
  const setCookie = l.res.headers.get('set-cookie');
  assert.match(setCookie, /ztx_session=/); assert.match(setCookie, /HttpOnly/i); assert.match(setCookie, /SameSite=Lax/i);
  const cookie = setCookie.split(';')[0];
  assert.equal((await raw('GET', '/auth/me', { headers: { cookie } })).status, 200);
  assert.equal((await raw('PUT', '/favorites/1', { headers: { cookie } })).status, 401); // нет X-Zetex-Client — сессия не принимается
  assert.equal((await raw('PUT', '/favorites/1', { headers: { cookie, ...web } })).status, 200);
  await raw('POST', '/auth/logout', { headers: { cookie, ...web } });
});

test('Click: подпись, prepare/complete, повторы и неверная сумма', async () => {
  const b = await buyerT();
  const o = (await call('POST', '/orders', { ...PICKUP, paymentMethod: 'click', items: [{ productId: 5, qty: 1 }] }, b)).data.order;
  assert.equal(o.paymentStatus, 'pending');
  const link = await call('GET', `/payments/link/${o.id}`, null, b);
  assert.match(link.data.url, /my\.click\.uz/);
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  const mk = (action, extra = {}) => {
    const f = { click_trans_id: '555', service_id: '777', merchant_trans_id: String(o.id), amount: String(o.total), action: String(action), sign_time: '2026-10-15 10:00:00', ...extra };
    const raw = f.click_trans_id + f.service_id + 'clicksecret' + f.merchant_trans_id + (action === 1 ? f.merchant_prepare_id : '') + f.amount + f.action + f.sign_time;
    return { ...f, sign_string: md5(raw) };
  };
  assert.equal((await raw('POST', '/payments/click/prepare', { form: { ...mk(0), sign_string: 'bad' } })).data.error, -1);
  assert.equal((await raw('POST', '/payments/click/prepare', { form: mk(0, { amount: String(o.total + 1) }) })).data.error, -2); // подпись верна, сумма не совпадает
  const prep = await raw('POST', '/payments/click/prepare', { form: mk(0) });
  assert.equal(prep.data.error, 0);
  const pid = prep.data.merchant_prepare_id;
  assert.ok(pid);
  const comp = await raw('POST', '/payments/click/complete', { form: mk(1, { merchant_prepare_id: String(pid) }) });
  assert.equal(comp.data.error, 0);
  assert.equal((await call('GET', `/orders/${o.id}`, null, b)).data.order.paymentStatus, 'paid');
  assert.equal((await raw('POST', '/payments/click/complete', { form: mk(1, { merchant_prepare_id: String(pid) }) })).data.error, -4); // уже оплачен
});

test('Payme: авторизация, CheckPerform, Create, Perform, идемпотентность, отмена', async () => {
  const b = await buyerT();
  const o = (await call('POST', '/orders', { ...PICKUP, paymentMethod: 'payme', items: [{ productId: 6, qty: 1 }] }, b)).data.order;
  const auth = { Authorization: 'Basic ' + Buffer.from('Paycom:paykey').toString('base64') };
  const rpc = (method, params, headers = auth) => raw('POST', '/payments/payme', { body: { id: 1, method, params }, headers });
  assert.equal((await rpc('CheckPerformTransaction', {}, { Authorization: 'Basic ' + Buffer.from('Paycom:wrong').toString('base64') })).data.error.code, -32504);
  const amount = o.total * 100;
  assert.equal((await rpc('CheckPerformTransaction', { amount: amount + 100, account: { order_id: String(o.id) } })).data.error.code, -31001);
  assert.equal((await rpc('CheckPerformTransaction', { amount, account: { order_id: '999999' } })).data.error.code, -31050);
  assert.equal((await rpc('CheckPerformTransaction', { amount, account: { order_id: String(o.id) } })).data.result.allow, true);
  const t = Date.now();
  const cr = await rpc('CreateTransaction', { id: 'tx1', time: t, amount, account: { order_id: String(o.id) } });
  assert.equal(cr.data.result.state, 1);
  assert.equal((await rpc('CreateTransaction', { id: 'tx1', time: t, amount, account: { order_id: String(o.id) } })).data.result.transaction, cr.data.result.transaction);
  assert.equal((await rpc('CreateTransaction', { id: 'tx2', time: t, amount, account: { order_id: String(o.id) } })).data.error.code, -31008); // на заказ уже есть другая транзакция
  const pf = await rpc('PerformTransaction', { id: 'tx1' });
  assert.equal(pf.data.result.state, 2);
  assert.equal((await rpc('PerformTransaction', { id: 'tx1' })).data.result.perform_time, pf.data.result.perform_time);
  assert.equal((await call('GET', `/orders/${o.id}`, null, b)).data.order.paymentStatus, 'paid');
  assert.equal((await rpc('CheckTransaction', { id: 'tx1' })).data.result.state, 2);
  assert.equal((await rpc('CheckTransaction', { id: 'zzz' })).data.error.code, -31003);

  // отмена до оплаты возвращает остаток и отменяет заказ
  const o2 = (await call('POST', '/orders', { ...PICKUP, paymentMethod: 'payme', items: [{ productId: 7, qty: 1 }] }, b)).data.order;
  await rpc('CreateTransaction', { id: 'tx9', time: Date.now(), amount: o2.total * 100, account: { order_id: String(o2.id) } });
  const cn = await rpc('CancelTransaction', { id: 'tx9', reason: 4 });
  assert.equal(cn.data.result.state, -1);
  assert.equal((await call('GET', `/orders/${o2.id}`, null, b)).data.order.status, 'cancelled');
});

test('демо-оплата mock: оплата переводит заказ в оплаченный, продавец может подтвердить только после', async () => {
  const b = await buyerT(), s = await sellerT();
  const cfg = (await call('GET', '/config')).data;
  assert.equal(cfg.payments.mock, true);
  const o = (await call('POST', '/orders', { ...PICKUP, paymentMethod: 'mock', items: [{ productId: 8, qty: 1 }] }, b)).data.order;
  assert.equal((await call('PATCH', `/orders/seller/${o.id}/status`, { status: 'confirmed' }, s)).status, 409);
  assert.equal((await call('POST', `/payments/mock/${o.id}/pay`, null, b)).status, 200);
  assert.equal((await call('POST', `/payments/mock/${o.id}/pay`, null, b)).status, 409);
  assert.equal((await call('PATCH', `/orders/seller/${o.id}/status`, { status: 'confirmed' }, s)).status, 200);
});

test('админка: доступ только админу, блокировка, модерация, жалобы, статистика', async () => {
  const a = await adminT(), b = await buyerT(), s = await sellerT();
  for (const u of ['/admin/stats', '/admin/users', '/admin/products', '/admin/orders', '/admin/reports']) {
    assert.equal((await call('GET', u, null, b)).status, 403);
    assert.equal((await call('GET', u, null, s)).status, 403);
    assert.equal((await call('GET', u)).status, 401);
    assert.equal((await call('GET', u, null, a)).status, 200);
  }
  const st = (await call('GET', '/admin/stats', null, a)).data;
  assert.ok(st.users.total >= 3 && st.products.active > 0);

  // жалоба → модерация → скрытие
  const rep = await call('POST', '/products/10/report', { reason: 'fake', text: 'Подделка' }, b);
  assert.equal(rep.status, 201, JSON.stringify(rep.data));
  const open = (await call('GET', '/admin/reports', null, a)).data.items;
  assert.ok(open.some((r) => r.productId === 10));
  assert.equal((await call('PATCH', '/admin/products/10/status', { status: 'hidden', reason: 'нарушение правил' }, a)).status, 200);
  assert.equal((await call('GET', '/products/10', null, b)).status, 404);
  assert.equal((await call('PATCH', `/admin/reports/${open[0].id}`, { status: 'resolved' }, a)).status, 200);

  // блокировка: старая сессия перестаёт работать, вход закрыт, админа блокировать нельзя
  const reg = await call('POST', '/auth/register', { acceptTerms: true, email: 'blockme@x.uz', password: 'Passw0rdX', firstName: 'Блок', lastName: 'Мне' });
  const users = (await call('GET', '/admin/users?q=blockme', null, a)).data.items;
  assert.equal(users.length, 1);
  assert.equal((await call('PATCH', `/admin/users/${users[0].id}`, { blocked: true, reason: 'спам' }, a)).status, 200);
  assert.equal((await call('GET', '/auth/me', null, reg.data.token)).status, 401);
  assert.equal((await call('POST', '/auth/login', { email: 'blockme@x.uz', password: 'Passw0rdX' })).status, 403);
  const adminRow = (await call('GET', '/admin/users?role=admin', null, a)).data.items[0];
  assert.equal((await call('PATCH', `/admin/users/${adminRow.id}`, { blocked: true }, a)).status, 400);
});

test('аналитика продавца: ряды за период, только для продавца', async () => {
  const s = await sellerT(), b = await buyerT();
  assert.equal((await call('GET', '/orders/seller/analytics', null, b)).status, 403);
  assert.equal((await call('GET', '/orders/seller/analytics?days=5', null, s)).status, 400);
  const r = await call('GET', '/orders/seller/analytics?days=7', null, s);
  assert.equal(r.status, 200);
  assert.equal(r.data.series.length, 7);
});

test('поиск: подсказки и /config', async () => {
  const sug = await call('GET', '/products/suggest?q=теле');
  assert.equal(sug.status, 200);
  assert.ok(Array.isArray(sug.data.products) && Array.isArray(sug.data.sections));
  const cfg = (await call('GET', '/config')).data;
  assert.ok(cfg.delivery.cities.length > 5 && cfg.delivery.pickupPoints.length > 0);
  assert.equal(cfg.payments.cash, true);
  assert.equal(cfg.payments.payme, true); assert.equal(cfg.payments.click, true);
});

test('регистрация требует принять условия; время согласия сохраняется', async () => {
  const body = { email: 'terms@x.uz', password: 'Passw0rdX', firstName: 'Тим', lastName: 'Терм' };
  assert.equal((await call('POST', '/auth/register', body)).status, 400);
  assert.equal((await call('POST', '/auth/register', { ...body, acceptTerms: false })).status, 400);
  assert.equal((await call('POST', '/auth/register', { ...body, acceptTerms: true })).status, 201);
  const { db } = await import('../src/db.js');
  assert.match(db.prepare("SELECT terms_accepted_at t FROM users WHERE email = 'terms@x.uz'").get().t, /^\d{4}-\d\d-\d\d/);
});
