import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zetex-seo-'));
const dist = path.join(dir, 'dist');
fs.mkdirSync(dist);
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><html><head><title>старый</title><meta name="description" content="старое" /></head><body><div id="root"></div></body></html>');
process.env.DATA_DIR = dir;
process.env.DIST_DIR = dist;
process.env.APP_URL = 'https://shop.example.uz';
process.env.NODE_ENV = 'test';

let server, origin;
before(async () => {
  const { createApp } = await import('../src/app.js');
  const seed = await import('../src/seed.js');
  seed.seedIfEmpty(); seed.ensureDemoCatalog();
  await new Promise((r) => { server = createApp().listen(0, r); });
  origin = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const get = async (p) => { const r = await fetch(origin + p); return { status: r.status, type: r.headers.get('content-type'), text: await r.text() }; };

test('страница товара: title, description, canonical, Open Graph и JSON-LD в HTML', async () => {
  const r = await get('/product/3');
  assert.equal(r.status, 200);
  assert.doesNotMatch(r.text, /старый|старое/);
  assert.match(r.text, /<title>.+ — купить в Zetex Market<\/title>/);
  assert.match(r.text, /<link rel="canonical" href="https:\/\/shop\.example\.uz\/product\/3" \/>/);
  assert.match(r.text, /property="og:title"/);
  const ld = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(r.text)[1]);
  assert.equal(ld['@type'], 'Product');
  assert.equal(ld.offers.priceCurrency, 'UZS');
  assert.ok(ld.offers.price > 0);
});

test('несуществующий и скрытый товар, неизвестный адрес — 404 с noindex', async () => {
  for (const p of ['/product/999999', '/product/abc', '/nothing-here', '/product/3/extra']) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    assert.match(r.text, /noindex/);
  }
  const { db } = await import('../src/db.js');
  db.prepare("UPDATE products SET status = 'hidden' WHERE id = 4").run();
  assert.equal((await get('/product/4')).status, 404);
});

test('главная, каталог, юридические страницы — 200; личные разделы закрыты от индексации', async () => {
  for (const p of ['/', '/catalog', '/terms', '/privacy', '/returns', '/contacts', '/faq']) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
    assert.doesNotMatch(r.text, /noindex/, p);
  }
  for (const p of ['/orders', '/checkout', '/admin', '/pay/5']) {
    const r = await get(p === '/pay/5' ? '/pay' : p);
    assert.equal(r.status, 200);
    assert.match(r.text, /noindex/);
  }
  const c = await get('/catalog?category=%D0%AD&sort=price&q=x');
  assert.match(c.text, /noindex/); // поисковая выдача не индексируется
});

test('XSS: в мета-данные всё экранируется', async () => {
  const { db } = await import('../src/db.js');
  db.prepare("UPDATE products SET title = ?, description = ? WHERE id = 5").run('"><script>alert(1)</script>', '</script><img src=x onerror=alert(1)>');
  const r = await get('/product/5');
  assert.doesNotMatch(r.text, /<script>alert/);
  assert.doesNotMatch(r.text, /<img src=x/);
  assert.match(r.text, /&lt;script&gt;/);
});

test('robots.txt и sitemap.xml', async () => {
  const robots = await get('/robots.txt');
  assert.match(robots.text, /Disallow: \/api\//);
  assert.match(robots.text, /Sitemap: https:\/\/shop\.example\.uz\/sitemap\.xml/);
  const sm = await get('/sitemap.xml');
  assert.match(sm.type, /xml/);
  assert.match(sm.text, /<loc>https:\/\/shop\.example\.uz\/product\/3<\/loc>/);
  assert.match(sm.text, /<loc>https:\/\/shop\.example\.uz\/terms<\/loc>/);
  assert.doesNotMatch(sm.text, /product\/4</); // скрытый товар не попадает
});

test('после новой сборки (index.html изменился) отдаётся свежий шаблон без перезапуска', async () => {
  const file = path.join(dist, 'index.html');
  fs.writeFileSync(file, '<!doctype html><html><head><title>x</title></head><body><div id="root"></div><script src="/assets/new-hash.js"></script></body></html>');
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000)); // гарантированно другое время изменения
  const r = await get('/');
  assert.match(r.text, /new-hash\.js/);
});
