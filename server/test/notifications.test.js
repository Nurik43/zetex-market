import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zetex-notif-'));
process.env.DATA_DIR = dir;
process.env.NODE_ENV = 'test';
process.env.TELEGRAM_BOT_TOKEN = 'test-token';

let server, base, outbox, tgSent, notify;
before(async () => {
  notify = await import('../src/notify.js');
  tgSent = [];
  notify.setTelegramTransport(async (method, body) => {
    if (method === 'sendMessage') tgSent.push(body);
    return { ok: true, result: method === 'getMe' ? { username: 'zetex_test_bot' } : [] };
  });
  const { createApp } = await import('../src/app.js');
  const seed = await import('../src/seed.js');
  outbox = (await import('../src/mailer.js')).outbox;
  seed.seedIfEmpty(); seed.ensureDemoCatalog();
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
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const login = async (email, password) => (await call('POST', '/auth/login', { email, password })).data.token;
const PICKUP = { deliveryMethod: 'pickup', city: 'Ташкент', pickupPoint: 'tash-1', recipient: 'Тест Тестов', phone: '+998901234567' };
const wait = () => new Promise((r) => setTimeout(r, 50)); // письма уходят без ожидания в запросе

test('покупатель получает письма на каждый этап заказа', async () => {
  const buyer = await login('info@zetex.uz', 'Password123!');
  const seller = await login('seller@zetex.uz', 'SellerPassword123');
  outbox.length = 0;
  const r = await call('POST', '/orders', { ...PICKUP, items: [{ productId: 3, qty: 1 }] }, buyer);
  assert.equal(r.status, 201);
  const id = r.data.order.id;
  for (const s of ['confirmed', 'shipped', 'delivered']) {
    assert.equal((await call('PATCH', `/orders/seller/${id}/status`, { status: s }, seller)).status, 200);
  }
  await wait();
  const subjects = outbox.filter((m) => m.to === 'info@zetex.uz').map((m) => m.subject);
  for (const word of ['оформлен', 'подтверждён', 'передан в доставку', 'доставлен']) {
    assert.ok(subjects.some((s) => s.includes(word)), `нет письма «${word}»: ${subjects.join(' | ')}`);
  }
  assert.match(outbox.at(-1).text, /Итого: .* сум/);
  assert.match(outbox.at(-1).text, /\/orders/);
});

test('отмена продавцом и отмена неоплаченного: покупателю приходит письмо, своя отмена — нет', async () => {
  const buyer = await login('info@zetex.uz', 'Password123!');
  const seller = await login('seller@zetex.uz', 'SellerPassword123');
  const o1 = (await call('POST', '/orders', { ...PICKUP, items: [{ productId: 3, qty: 1 }] }, buyer)).data.order;
  outbox.length = 0;
  assert.equal((await call('PATCH', `/orders/seller/${o1.id}/status`, { status: 'cancelled' }, seller)).status, 200);
  await wait();
  assert.ok(outbox.some((m) => m.subject.includes('отменён')));

  const o2 = (await call('POST', '/orders', { ...PICKUP, items: [{ productId: 3, qty: 1 }] }, buyer)).data.order;
  await wait(); outbox.length = 0;
  assert.equal((await call('POST', `/orders/${o2.id}/cancel`, null, buyer)).status, 200);
  await wait();
  assert.equal(outbox.length, 0);
});

test('Telegram покупателя: привязка по коду и сообщения о статусе', async () => {
  const buyer = await login('info@zetex.uz', 'Password123!');
  const seller = await login('seller@zetex.uz', 'SellerPassword123');
  const { code } = (await call('POST', '/telegram/link-code', null, buyer)).data;
  assert.ok(code);
  const upd = notify.handleUpdate({ message: { text: `/start ${code}`, chat: { id: 555 } } });
  assert.match(upd.reply, /Статусы ваших заказов/);
  assert.equal((await call('GET', '/auth/me', null, buyer)).data.user.telegramLinked, true);

  tgSent.length = 0;
  const o = (await call('POST', '/orders', { ...PICKUP, items: [{ productId: 3, qty: 1 }] }, buyer)).data.order;
  await call('PATCH', `/orders/seller/${o.id}/status`, { status: 'confirmed' }, seller);
  await wait();
  const toBuyer = tgSent.filter((m) => m.chat_id === '555');
  assert.ok(toBuyer.length >= 2, `сообщений покупателю: ${toBuyer.length}`);
  assert.ok(toBuyer.some((m) => m.text.includes('подтверждён')));

  assert.equal((await call('DELETE', '/telegram/link', null, buyer)).status, 200);
  assert.equal((await call('GET', '/auth/me', null, buyer)).data.user.telegramLinked, false);
});
