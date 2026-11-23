import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zetex-test-'));
process.env.DATA_DIR = dir;
process.env.NODE_ENV = 'test';

let server, base;
before(async () => {
  const { createApp } = await import('../src/app.js');
  const { seedIfEmpty, ensureDemoCatalog } = await import('../src/seed.js');
  seedIfEmpty();
  ensureDemoCatalog();
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
  return { status: res.status, data: await res.json() };
}
const PICKUP = { deliveryMethod: 'pickup', city: 'Ташкент', pickupPoint: 'tash-1', recipient: 'Тест Тестов', phone: '+998901234567' };
const login = async (email, password) => (await call('POST', '/auth/login', { email, password })).data.token;

test('регистрация: валидация, дубль, роль admin запрещена', async () => {
  let r = await call('POST', '/auth/register', { acceptTerms: true, email: 'bad', password: 'x', firstName: 'A', lastName: 'B' });
  assert.equal(r.status, 400);
  r = await call('POST', '/auth/register', { acceptTerms: true, email: 'new@x.uz', password: 'Passw0rdX', firstName: 'Али', lastName: 'Вали', role: 'admin' });
  assert.equal(r.status, 400);
  r = await call('POST', '/auth/register', { acceptTerms: true, email: 'new@x.uz', password: 'Passw0rdX', firstName: 'Али', lastName: 'Вали' });
  assert.equal(r.status, 201);
  assert.ok(r.data.token);
  assert.equal(r.data.user.password_hash, undefined);
  r = await call('POST', '/auth/register', { acceptTerms: true, email: 'NEW@x.uz', password: 'Passw0rdX', firstName: 'Али', lastName: 'Вали' });
  assert.equal(r.status, 409);
});

test('логин и /me', async () => {
  assert.equal((await call('POST', '/auth/login', { email: 'info@zetex.uz', password: 'wrong' })).status, 401);
  const token = await login('info@zetex.uz', 'Password123!');
  const me = await call('GET', '/auth/me', null, token);
  assert.equal(me.data.user.role, 'buyer');
  assert.equal((await call('GET', '/auth/me')).status, 401);
});

test('каталог: поиск по кириллице без учёта регистра, категория, сортировка', async () => {
  const all = await call('GET', '/products');
  assert.ok(all.data.total >= 6);
  const found = await call('GET', '/products?q=' + encodeURIComponent('СМАРТФОН'));
  assert.ok(found.data.items.length >= 1);
  const cat = await call('GET', '/products?category=' + encodeURIComponent('Спорт и отдых'));
  assert.ok(cat.data.items.every((p) => p.category === 'Спорт и отдых') && cat.data.items.length >= 1);
  const asc = (await call('GET', '/products?sort=price_asc')).data.items.map((p) => p.price);
  assert.deepEqual(asc, [...asc].sort((a, b) => a - b));
  assert.equal((await call('GET', '/products/999999')).status, 404);
});

test('товары: только продавец и только свои', async () => {
  const seller = await login('seller@zetex.uz', 'SellerPassword123');
  const buyer = await login('info@zetex.uz', 'Password123!');
  const body = { title: 'Тестовый товар', category: 'Одежда', price: 1000, image: 'https://example.com/a.png', stock: 5 };
  assert.equal((await call('POST', '/products', body, buyer)).status, 403);
  assert.equal((await call('POST', '/products', body)).status, 401);
  assert.equal((await call('POST', '/products', { ...body, price: -5 }, seller)).status, 400);
  assert.equal((await call('POST', '/products', { ...body, image: 'javascript:alert(1)' }, seller)).status, 400);
  const created = await call('POST', '/products', body, seller);
  assert.equal(created.status, 201);
  const id = created.data.product.id;

  // другой продавец не может менять чужой товар
  await call('POST', '/auth/register', { acceptTerms: true, email: 's2@x.uz', password: 'Passw0rdX', firstName: 'Сэм', lastName: 'Два', role: 'seller' });
  const seller2 = await login('s2@x.uz', 'Passw0rdX');
  assert.equal((await call('PUT', `/products/${id}`, body, seller2)).status, 403);
  assert.equal((await call('DELETE', `/products/${id}`, null, seller2)).status, 403);

  const upd = await call('PUT', `/products/${id}`, { ...body, price: 2000 }, seller);
  assert.equal(upd.data.product.price, 2000);
  assert.equal((await call('DELETE', `/products/${id}`, null, seller)).status, 200);
});

test('избранное', async () => {
  const buyer = await login('info@zetex.uz', 'Password123!');
  assert.equal((await call('PUT', '/favorites/1', null, buyer)).status, 200);
  assert.equal((await call('PUT', '/favorites/1', null, buyer)).status, 200); // идемпотентно
  assert.equal((await call('PUT', '/favorites/99999', null, buyer)).status, 404);
  assert.equal((await call('GET', '/favorites', null, buyer)).data.items.length, 1);
  await call('DELETE', '/favorites/1', null, buyer);
  assert.equal((await call('GET', '/favorites', null, buyer)).data.items.length, 0);
});

test('заказ: цена с сервера, остатки, отмена возвращает остаток, статусы продавца', async () => {
  const buyer = await login('info@zetex.uz', 'Password123!');
  const seller = await login('seller@zetex.uz', 'SellerPassword123');
  const before = (await call('GET', '/products/1')).data.product;

  // клиент не может подсунуть свою цену — поле игнорируется
  const r = await call('POST', '/orders', { ...PICKUP, items: [{ productId: 1, qty: 2, price: 1 }, { productId: 1, qty: 1 }] }, buyer);
  assert.equal(r.status, 201);
  assert.equal(r.data.order.total, before.price * 3);
  assert.equal((await call('GET', '/products/1')).data.product.stock, before.stock - 3);

  assert.equal((await call('POST', '/orders', { ...PICKUP, items: [{ productId: 1, qty: 999 }] }, buyer)).status, 409);
  assert.equal((await call('POST', '/orders', { ...PICKUP, items: [] }, buyer)).status, 400);
  assert.equal((await call('POST', '/orders', { ...PICKUP, items: [{ productId: 1, qty: 1 }] }, seller)).status, 403);

  const id = r.data.order.id;
  const sl = await call('GET', '/orders/seller/list', null, seller);
  assert.ok(sl.data.items.some((o) => o.id === id));
  assert.equal((await call('PATCH', `/orders/seller/${id}/status`, { status: 'delivered' }, seller)).status, 409); // нельзя перепрыгнуть
  assert.equal((await call('PATCH', `/orders/seller/${id}/status`, { status: 'confirmed' }, seller)).status, 200);
  assert.equal((await call('POST', `/orders/${id}/cancel`, null, buyer)).status, 409); // уже подтверждён

  const r2 = await call('POST', '/orders', { ...PICKUP, items: [{ productId: 2, qty: 1 }] }, buyer);
  const stock2 = (await call('GET', '/products/2')).data.product.stock;
  assert.equal((await call('POST', `/orders/${r2.data.order.id}/cancel`, null, buyer)).status, 200);
  assert.equal((await call('GET', '/products/2')).data.product.stock, stock2 + 1);

  // доведение до доставки → выручка
  await call('PATCH', `/orders/seller/${id}/status`, { status: 'shipped' }, seller);
  await call('PATCH', `/orders/seller/${id}/status`, { status: 'delivered' }, seller);
  const stats = await call('GET', '/orders/seller/stats', null, seller);
  assert.equal(stats.data.revenue, before.price * 3);

  // чужой покупатель не видит чужие заказы
  const mine = await call('GET', '/orders', null, buyer);
  assert.ok(mine.data.items.length >= 2);
});

test('загрузка фото: только продавец, проверка содержимого, в товар попадает путь', async () => {
  const seller = await login('seller@zetex.uz', 'SellerPassword123');
  const buyer = await login('info@zetex.uz', 'Password123!');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const send = async (token, buf, name = 'a.png') => {
    const fd = new FormData();
    fd.append('file', new Blob([buf]), name);
    const r = await fetch(base + '/uploads', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd });
    return { status: r.status, data: await r.json() };
  };
  assert.equal((await send(null, png)).status, 401);
  assert.equal((await send(buyer, png)).status, 403);
  assert.equal((await send(seller, Buffer.from('<script>alert(1)</script>'), 'x.png')).status, 400); // не картинка
  assert.equal((await send(seller, Buffer.alloc(3 * 1024 * 1024, 1))).status, 413);
  const ok = await send(seller, png);
  assert.equal(ok.status, 201);
  assert.match(ok.data.url, /^\/uploads\/[a-f0-9]{32}\.png$/);

  // файл отдаётся по этому пути
  const file = await fetch(base.replace('/api', '') + ok.data.url);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get('content-type'), 'image/png');

  // товар хранит путь; data-URL больше не принимается
  const body = { title: 'С фото', category: 'Одежда', price: 5000, image: ok.data.url };
  assert.equal((await call('POST', '/products', { ...body, image: 'data:image/png;base64,AAAA' }, seller)).status, 400);
  const p = await call('POST', '/products', body, seller);
  assert.equal(p.status, 201);
  assert.equal(p.data.product.image, ok.data.url);
});

test('каталог: подкатегории, фильтры, мета, валидация подкатегории', async () => {
  const tree = (await call('GET', '/products/categories')).data.tree;
  assert.ok(tree.length >= 15);
  const all = await call('GET', '/products?limit=100');
  assert.ok(all.data.total >= 90, 'демо-каталог должен быть ≥ 90 товаров');
  const sub = await call('GET', '/products?category=' + encodeURIComponent('Электроника') + '&subcategory=' + encodeURIComponent('Смартфоны'));
  assert.ok(sub.data.items.length >= 2 && sub.data.items.every((p) => p.subcategory === 'Смартфоны'));
  const cheap = await call('GET', '/products?maxPrice=100000&inStock=1');
  assert.ok(cheap.data.items.length > 0 && cheap.data.items.every((p) => p.price <= 100000 && p.stock > 0));
  const rated = await call('GET', '/products?minRating=4.8');
  assert.ok(rated.data.items.every((p) => p.rating >= 4.8));
  const pop = (await call('GET', '/products?sort=popular&limit=5')).data.items.map((p) => p.reviews);
  assert.deepEqual(pop, [...pop].sort((a, b) => b - a));
  const meta = await call('GET', '/products/meta');
  assert.equal(meta.data.total, all.data.total);
  assert.ok(meta.data.categories['Электроника'] >= 8 && meta.data.maxPrice > meta.data.minPrice);
  assert.ok(meta.data.subcategories['Электроника|Смартфоны'] >= 2);

  const seller = await login('seller@zetex.uz', 'SellerPassword123');
  const body = { title: 'Проверка подкатегории', category: 'Одежда', price: 1000, image: 'https://example.com/a.png' };
  assert.equal((await call('POST', '/products', { ...body, subcategory: 'Смартфоны' }, seller)).status, 400);
  assert.equal((await call('POST', '/products', { ...body, subcategory: 'Платья' }, seller)).status, 201);
});
