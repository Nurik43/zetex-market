import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zetex-r3-'));
process.env.DATA_DIR = dir;
process.env.NODE_ENV = 'test';

let server, base, outbox, db;
before(async () => {
  const { createApp } = await import('../src/app.js');
  const seed = await import('../src/seed.js');
  outbox = (await import('../src/mailer.js')).outbox;
  db = (await import('../src/db.js')).db;
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
  let data = {}; try { data = JSON.parse(text); } catch { /* не JSON */ }
  return { status: res.status, data, text, res };
}
const login = async (email, password) => (await call('POST', '/auth/login', { email, password })).data.token;
const sellerT = () => login('seller@zetex.uz', 'SellerPassword123');
const wait = () => new Promise((r) => setTimeout(r, 60));
const PICKUP = { deliveryMethod: 'pickup', city: 'Ташкент', pickupPoint: 'tash-1', recipient: 'Тест Тестов', phone: '+998901234567' };
let n = 0;
async function newBuyer(extra = {}) {
  const email = `r3-${Date.now()}-${n++}@x.uz`;
  const r = await call('POST', '/auth/register', { email, password: 'Passw0rdX', firstName: 'Роман', lastName: 'Третий', acceptTerms: true, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return { email, token: r.data.token, id: r.data.user.id };
}

test('корзина: только покупатель, остаток проверяется, одна на все устройства, очищается заказом', async () => {
  const b = await newBuyer();
  assert.equal((await call('GET', '/cart')).status, 401);
  assert.equal((await call('GET', '/cart', null, await sellerT())).status, 403);

  let r = await call('PUT', '/cart/3', { qty: 2 }, b.token);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.items.map((i) => [i.id, i.count]), [[3, 2]]);
  assert.ok(r.data.items[0].price > 0 && r.data.items[0].title);

  // тот же аккаунт в другом «устройстве» (новая сессия) видит ту же корзину
  const again = await login(b.email, 'Passw0rdX');
  assert.equal((await call('GET', '/cart', null, again)).data.items.length, 1);

  assert.equal((await call('PUT', '/cart/3', { qty: 100000 }, b.token)).status, 400);
  db.prepare('UPDATE products SET stock = 2 WHERE id = 4').run();
  const over = await call('PUT', '/cart/4', { qty: 3 }, b.token);
  assert.equal(over.status, 409);
  assert.match(over.data.error, /только 2/);
  db.prepare('UPDATE products SET stock = 100 WHERE id = 4').run();
  assert.equal((await call('PUT', '/cart/999999', { qty: 1 }, b.token)).status, 404);

  // заказ убирает купленное из корзины
  assert.equal((await call('POST', '/orders', { ...PICKUP, items: [{ productId: 3, qty: 2 }] }, b.token)).status, 201);
  assert.equal((await call('GET', '/cart', null, b.token)).data.items.length, 0);

  // скрытый товар из корзины пропадает
  await call('PUT', '/cart/5', { qty: 1 }, b.token);
  db.prepare("UPDATE products SET status = 'hidden' WHERE id = 5").run();
  assert.equal((await call('GET', '/cart', null, b.token)).data.items.length, 0);
  db.prepare("UPDATE products SET status = 'active' WHERE id = 5").run();
  await call('PUT', '/cart/5', { qty: 0 }, b.token);
  assert.equal((await call('DELETE', '/cart', null, b.token)).data.items.length, 0);
});

test('выгрузка данных: файл со всем, что хранится о пользователе', async () => {
  const b = await newBuyer();
  await call('PUT', '/favorites/3', null, b.token);
  await call('PUT', '/cart/3', { qty: 1 }, b.token);
  const r = await call('GET', '/account/export', null, b.token);
  assert.equal(r.status, 200);
  assert.match(r.res.headers.get('content-disposition'), /attachment/);
  assert.equal(r.data.profile.email, b.email);
  assert.equal(r.data.favorites.length, 1);
  assert.equal(r.data.cart[0].qty, 1);
  assert.ok(!('passwordHash' in r.data.profile) && !r.text.includes('password_hash'));
  assert.equal((await call('GET', '/account/export')).status, 401);
});

test('удаление аккаунта: нужен пароль, активные заказы мешают, данные обезличиваются, войти нельзя', async () => {
  const b = await newBuyer();
  const seller = await sellerT();
  assert.equal((await call('POST', '/account/delete', { password: 'неверный' }, b.token)).status, 400);

  const o = (await call('POST', '/orders', { ...PICKUP, items: [{ productId: 3, qty: 1 }] }, b.token)).data.order;
  const blocked = await call('POST', '/account/delete', { password: 'Passw0rdX' }, b.token);
  assert.equal(blocked.status, 409);
  assert.match(blocked.data.error, /незавершённые заказы/);

  await call('POST', `/orders/${o.id}/cancel`, null, b.token);
  await call('PUT', '/favorites/3', null, b.token);
  await call('PUT', '/cart/4', { qty: 1 }, b.token);
  await call('POST', '/chats', { productId: 3, text: 'Здравствуйте, есть в наличии?' }, b.token);

  outbox.length = 0;
  const del = await call('POST', '/account/delete', { password: 'Passw0rdX' }, b.token);
  assert.equal(del.status, 200);
  await wait();
  assert.ok(outbox.some((m) => m.to === b.email && m.subject.includes('удалён')));

  // сессия мертва, логин невозможен, почта освобождена
  assert.equal((await call('GET', '/auth/me', null, b.token)).status, 401);
  assert.equal((await call('POST', '/auth/login', { email: b.email, password: 'Passw0rdX' })).status, 401);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(b.id);
  assert.ok(!u.email.includes(b.email) && u.first_name === 'Пользователь' && u.phone === '' && u.deleted_at);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM favorites WHERE user_id = ?').get(b.id).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM cart_items WHERE user_id = ?').get(b.id).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM conversations WHERE buyer_id = ?').get(b.id).c, 0);
  const order = db.prepare('SELECT recipient, phone, address FROM orders WHERE id = ?').get(o.id);
  assert.deepEqual({ ...order }, { recipient: 'Удалённый пользователь', phone: '', address: '' });
  // продавец не видит переписку удалённого
  assert.equal((await call('GET', '/chats', null, seller)).data.items.every((c) => c.with.name !== 'Роман Т.'), true);
  // та же почта снова годится для регистрации
  assert.equal((await call('POST', '/auth/register', { email: b.email, password: 'Passw0rdX', firstName: 'Новый', lastName: 'Жилец', acceptTerms: true })).status, 201);
});

test('удаление: администратора удалить нельзя; продавец с активным заказом — нельзя, без — можно, товары уходят', async () => {
  const admin = await login('admin@zetex.uz', 'Admin12345!');
  assert.equal((await call('POST', '/account/delete', { password: 'Admin12345!' }, admin)).status, 403);

  const s = await call('POST', '/auth/register', { email: `s-${Date.now()}@x.uz`, password: 'Passw0rdX', firstName: 'Сэм', lastName: 'Продавец', role: 'seller', companyName: 'ООО Тест', inn: '123456789', acceptTerms: true });
  const st = s.data.token;
  const prod = (await call('POST', '/products', { title: 'Тестовый стул', category: 'Бытовая техника', subcategory: 'Пылесосы', price: 100000, stock: 5, description: 'Хороший стул', image: '/uploads/' + 'a'.repeat(32) + '.svg' }, st));
  assert.equal(prod.status, 201, JSON.stringify(prod.data));
  {
    const b = await newBuyer();
    const ord = await call('POST', '/orders', { ...PICKUP, items: [{ productId: prod.data.product.id, qty: 1 }] }, b.token);
    assert.equal(ord.status, 201, JSON.stringify(ord.data));
    assert.equal((await call('POST', '/account/delete', { password: 'Passw0rdX' }, st)).status, 409);
    await call('PATCH', `/orders/seller/${ord.data.order.id}/status`, { status: 'cancelled' }, st);
    assert.equal((await call('POST', '/account/delete', { password: 'Passw0rdX' }, st)).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM products WHERE id = ?').get(prod.data.product.id).c, 0);
    // история заказа покупателя осталась
    assert.equal((await call('GET', '/orders', null, b.token)).data.items.length, 1);
  }
});

test('чат: покупатель начинает о товаре, продавец отвечает, непрочитанные, письма, чужие разговоры закрыты', async () => {
  const b = await newBuyer();
  const other = await newBuyer();
  const seller = await sellerT();
  assert.equal((await call('POST', '/chats', { productId: 3, text: '   ' }, b.token)).status, 400);
  assert.equal((await call('POST', '/chats', { text: 'без товара' }, b.token)).status, 400);
  assert.equal((await call('POST', '/chats', { productId: 3, text: 'x'.repeat(2001) }, b.token)).status, 400);
  assert.equal((await call('POST', '/chats', { productId: 3, text: 'привет' })).status, 401);
  assert.equal((await call('POST', '/chats', { productId: 3, text: 'я продавец' }, seller)).status, 403); // начать может только покупатель

  outbox.length = 0;
  const start = await call('POST', '/chats', { productId: 3, text: 'Есть ли гарантия?' }, b.token);
  assert.equal(start.status, 201);
  const id = start.data.conversationId;
  await wait();
  // продавцу ушло письмо
  assert.ok(outbox.some((m) => m.to === 'seller@zetex.uz' && m.text.includes('Есть ли гарантия?') && m.text.includes(`/chats/${id}`)));

  // повторное «начать» продолжает тот же разговор
  assert.equal((await call('POST', '/chats', { productId: 3, text: 'И сколько?' }, b.token)).data.conversationId, id);
  // второе письмо не уходит, пока продавец не прочитал первое
  await wait();
  assert.equal(outbox.filter((m) => m.to === 'seller@zetex.uz').length, 1);

  assert.equal((await call('GET', '/chats/unread', null, seller)).data.count, 2);
  assert.equal((await call('GET', '/chats/unread', null, b.token)).data.count, 0);

  // чужие не видят и не пишут
  assert.equal((await call('GET', `/chats/${id}`, null, other.token)).status, 404);
  assert.equal((await call('POST', `/chats/${id}/messages`, { text: 'влезу' }, other.token)).status, 404);

  const open = await call('GET', `/chats/${id}`, null, seller);
  assert.equal(open.data.messages.length, 2);
  assert.equal(open.data.conversation.with.name, 'Роман Т.'); // продавец видит имя и инициал, без телефона и почты
  assert.ok(!JSON.stringify(open.data).includes(b.email));
  assert.equal((await call('GET', '/chats/unread', null, seller)).data.count, 0);

  outbox.length = 0;
  assert.equal((await call('POST', `/chats/${id}/messages`, { text: 'Гарантия 1 год' }, seller)).status, 201);
  await wait();
  assert.ok(outbox.some((m) => m.to === b.email));
  assert.equal((await call('GET', '/chats/unread', null, b.token)).data.count, 1);

  const list = await call('GET', '/chats', null, b.token);
  assert.equal(list.data.items.length, 1);
  assert.equal(list.data.items[0].product.id, 3);
  assert.equal(list.data.items[0].unread, 1);
  assert.equal(list.data.items[0].lastMessage.text, 'Гарантия 1 год');

  // опрос: только новые сообщения
  const last = (await call('GET', `/chats/${id}`, null, b.token)).data.messages.at(-1).id;
  assert.equal((await call('GET', `/chats/${id}?after=${last}`, null, b.token)).data.messages.length, 0);
  await call('POST', `/chats/${id}/messages`, { text: 'Спасибо!' }, b.token);
  assert.deepEqual((await call('GET', `/chats/${id}?after=${last}`, null, b.token)).data.messages.map((m) => m.text), ['Спасибо!']);
});

test('чат по заказу: только по своему заказу; заблокированный продавец недоступен', async () => {
  const b = await newBuyer();
  const other = await newBuyer();
  const o = (await call('POST', '/orders', { ...PICKUP, items: [{ productId: 3, qty: 1 }] }, b.token)).data.order;
  assert.equal((await call('POST', '/chats', { orderId: o.id, text: 'Где мой заказ?' }, other.token)).status, 404);
  const r = await call('POST', '/chats', { orderId: o.id, text: 'Где мой заказ?' }, b.token);
  assert.equal(r.status, 201);
  const list = await call('GET', '/chats', null, b.token);
  assert.equal(list.data.items[0].order.code, o.code);

  db.prepare("UPDATE users SET blocked = 1 WHERE email = 'seller@zetex.uz'").run();
  assert.equal((await call('POST', `/chats/${r.data.conversationId}/messages`, { text: 'ау' }, b.token)).status, 409);
  db.prepare("UPDATE users SET blocked = 0 WHERE email = 'seller@zetex.uz'").run();
});
