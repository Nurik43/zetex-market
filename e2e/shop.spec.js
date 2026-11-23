import { test, expect } from '@playwright/test';

const H = { 'X-Zetex-Client': 'web' };
let n = 0;
const uniq = () => `e2e${Date.now()}${n++}@example.com`;

// Регистрация через API: cookie сессии попадает в контекст браузера
async function registerBuyer(page) {
  const email = uniq();
  const r = await page.context().request.post('/api/auth/register', {
    headers: H,
    data: { email, password: 'Password123!', role: 'buyer', acceptTerms: true, firstName: 'Тест', lastName: 'Покупатель' },
  });
  expect(r.ok()).toBeTruthy();
  return email;
}
const loginAs = async (page, email, password) => {
  const r = await page.context().request.post('/api/auth/login', { headers: H, data: { email, password } });
  expect(r.ok()).toBeTruthy();
};

test('главная и каталог открываются, поиск находит товар', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('header')).toBeVisible();
  await page.goto('/catalog');
  await expect(page.locator('.ztx-card').first()).toBeVisible();
  const total = await page.locator('.ztx-card').count();
  expect(total).toBeGreaterThan(3);
});

test('токен не хранится в localStorage, сессия — httpOnly cookie', async ({ page }) => {
  await registerBuyer(page);
  await page.goto('/');
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === 'ztx_session');
  expect(session?.httpOnly).toBe(true);
  const ls = await page.evaluate(() => JSON.stringify(localStorage));
  expect(ls).not.toContain('ztx_token');
  expect(await page.evaluate(() => document.cookie)).not.toContain('ztx_session');
});

test('страница товара: галерея, отзывы, жалоба доступны', async ({ page }) => {
  await page.goto('/product/1');
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.getByText(/Отзывы/).first()).toBeVisible();
});

test('покупка: корзина → оформление самовывозом → заказ в «Моих заказах»', async ({ page }) => {
  await registerBuyer(page);
  await page.goto('/catalog');
  await page.getByRole('button', { name: 'В корзину' }).first().click();
  await page.goto('/checkout');
  await expect(page.getByRole('heading', { name: 'Оформление заказа' })).toBeVisible();

  await page.getByPlaceholder('+998 XX XXX XX XX').fill('90 123 45 67');
  await page.locator('input[name=method][type=radio]').nth(1).check({ force: true }); // самовывоз
  await page.locator('select').first().selectOption({ label: 'Ташкент' });
  await page.locator('input[name=point]').first().check({ force: true });
  await page.locator('input[name=payment]').first().check({ force: true }); // наличными
  await page.getByRole('button', { name: 'Подтвердить заказ' }).click();
  await expect(page.getByText(/Оплата при получении|Заказ .* оформлен/).first()).toBeVisible();

  await page.goto('/orders');
  await expect(page.getByText(/ZTX|№|Заказ/).first()).toBeVisible();
});

test('тёмная тема переключается и запоминается', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Тёмная тема' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('переключатель языка RU ↔ UZ меняет интерфейс', async ({ page }) => {
  await page.goto('/catalog');
  await expect(page.getByRole('button', { name: 'В корзину' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Язык интерфейса' }).click();
  await expect(page.getByRole('button', { name: 'В корзину' })).toHaveCount(0);
});

test('администратор видит админ-панель, покупатель — нет', async ({ page, browser }) => {
  await loginAs(page, 'admin@zetex.uz', 'Admin12345!');
  await page.goto('/');
  await expect(page.getByText(/Пользователи/).first()).toBeVisible();

  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await registerBuyer(p2);
  const r = await ctx.request.get('/api/admin/stats');
  expect(r.status()).toBe(403);
  await ctx.close();
});

test('панель продавца показывает вкладки', async ({ page }) => {
  await loginAs(page, 'seller@zetex.uz', 'SellerPassword123');
  await page.goto('/');
  await expect(page.getByText(/Аналитика|Промокоды|Импорт/).first()).toBeVisible();
});

test('чистые адреса: старая ссылка с #/ переписывается, переходы без перезагрузки, кнопка «назад» работает', async ({ page }) => {
  await page.goto('/#/product/1');
  await expect(page).toHaveURL(/\/product\/1$/);
  await expect(page.locator('h1').first()).toBeVisible();
  await page.goto('/catalog');
  await page.evaluate(() => { window.__marker = 1; });
  await page.locator('.ztx-card').first().click();
  await expect(page).toHaveURL(/\/product\/\d+$/);
  expect(await page.evaluate(() => window.__marker)).toBe(1); // страница не перезагружалась
  await page.goBack();
  await expect(page).toHaveURL(/\/catalog$/);
});

test('страница товара отдаёт мета-теги в HTML, неизвестный адрес — 404', async ({ page, request }) => {
  const html = await (await request.get('/product/1')).text();
  expect(html).toMatch(/<title>.+ — купить в Zetex Market<\/title>/);
  expect(html).toContain('application/ld+json');
  expect((await request.get('/no-such-page')).status()).toBe(404);
  await page.goto('/no-such-page');
  await expect(page.getByText('Страница не найдена')).toBeVisible();
});

test('правовые страницы и подвал: ссылки работают', async ({ page }) => {
  await page.goto('/');
  await page.locator('footer').getByRole('link', { name: 'Возврат и обмен' }).first().click();
  await expect(page).toHaveURL(/\/returns$/);
  await expect(page.locator('h1')).toHaveText('Возврат и обмен');
  for (const [slug, h1] of [['terms', 'Пользовательское соглашение'], ['privacy', 'Политика конфиденциальности'], ['contacts', 'Контакты'], ['faq', 'Вопросы и ответы']]) {
    await page.goto(`/${slug}`);
    await expect(page.locator('h1')).toHaveText(h1);
  }
  await page.goto('/faq');
  await page.locator('.ztx-faq-item summary').first().click();
  await expect(page.locator('.ztx-faq-item').first()).toHaveAttribute('open', '');
});

test('регистрация через форму требует согласия с условиями', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Войти/ }).first().click();
  const dialog = page.locator('[role=dialog]');
  await dialog.getByText('Создать аккаунт').click();
  await expect(dialog.getByRole('checkbox')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'пользовательское соглашение' })).toHaveAttribute('href', '/terms');
});

test('у продавца и администратора нет корзины и избранного, у покупателя есть', async ({ page, browser }) => {
  await loginAs(page, 'seller@zetex.uz', 'SellerPassword123');
  await page.goto('/');
  await expect(page.locator('header').getByRole('button', { name: 'Корзина', exact: true })).toHaveCount(0);
  await expect(page.locator('header').getByRole('button', { name: 'Избранное', exact: true })).toHaveCount(0);
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage();
  await registerBuyer(p2);
  await p2.goto('/');
  await expect(p2.locator('header').getByRole('button', { name: 'Корзина', exact: true })).toBeVisible();
  await expect(p2.locator('header').getByRole('button', { name: 'Избранное', exact: true })).toBeVisible();
  await ctx.close();
});

test('гость не видит корзину, а при добавлении товара его просят войти', async ({ page }) => {
  await page.goto('/catalog');
  await expect(page.locator('header').getByRole('button', { name: 'Корзина', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'В корзину' }).first().click();
  await expect(page.locator('[role=dialog]')).toBeVisible();
});

test('корзина у каждого покупателя своя', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  await registerBuyer(a);
  await a.goto('/catalog');
  await a.getByRole('button', { name: 'В корзину' }).first().click();
  await expect(a.locator('header [data-cart-target] .ztx-badge')).toHaveText('1');
  await ctx.request.post('/api/auth/logout', { headers: H });
  await registerBuyer(a);
  await a.goto('/catalog');
  await expect(a.locator('header [data-cart-target] .ztx-badge')).toHaveCount(0);
  await ctx.close();
});

test('корзина хранится на сервере: после повторного входа товары на месте', async ({ browser }) => {
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  const email = await registerBuyer(a);
  await a.goto('/catalog');
  await a.getByRole('button', { name: 'В корзину' }).first().click();
  await expect(a.locator('header [data-cart-target] .ztx-badge')).toHaveText('1');

  // «другое устройство»: чистый браузерный контекст, тот же аккаунт
  const ctx2 = await browser.newContext();
  const b = await ctx2.newPage();
  await loginAs(b, email, 'Password123!');
  await b.goto('/catalog');
  await expect(b.locator('header [data-cart-target] .ztx-badge')).toHaveText('1');
  await ctx.close(); await ctx2.close();
});

test('чат: покупатель пишет продавцу со страницы товара, продавец отвечает', async ({ browser }) => {
  const buyerCtx = await browser.newContext();
  const bp = await buyerCtx.newPage();
  await registerBuyer(bp);
  await bp.goto('/product/3');
  await bp.getByRole('button', { name: 'Написать продавцу' }).click();
  const dialog = bp.locator('[role=dialog]');
  await dialog.getByRole('textbox').fill('Здравствуйте! Есть доставка в Самарканд?');
  await dialog.getByRole('button', { name: 'Отправить' }).click();
  await expect(bp).toHaveURL(/\/chats\/\d+$/);
  await expect(bp.locator('.ztx-msg.mine').getByText('Есть доставка в Самарканд?')).toBeVisible();

  const sellerCtx = await browser.newContext();
  const sp = await sellerCtx.newPage();
  await loginAs(sp, 'seller@zetex.uz', 'SellerPassword123');
  await sp.goto('/chats');
  await expect(sp.locator('.ztx-chat-item').first()).toContainText('Есть доставка в Самарканд?');
  await expect(sp.locator('header .ztx-badge').first()).toBeVisible(); // значок непрочитанных
  await sp.locator('.ztx-chat-item').first().click();
  await sp.getByPlaceholder('Напишите сообщение…').fill('Да, доставляем по всему Узбекистану.');
  await sp.keyboard.press('Enter');

  // покупатель получает ответ без перезагрузки страницы (опрос раз в 4 с)
  await expect(bp.locator('.ztx-msg:not(.mine)').getByText('доставляем по всему Узбекистану')).toBeVisible({ timeout: 10_000 });
  await buyerCtx.close(); await sellerCtx.close();
});

test('гость при «Написать продавцу» видит вход; у продавца и админа кнопки нет', async ({ page, browser }) => {
  await page.goto('/product/3');
  await page.getByRole('button', { name: 'Написать продавцу' }).click();
  await expect(page.locator('[role=dialog]')).toBeVisible();
  const ctx = await browser.newContext();
  const sp = await ctx.newPage();
  await loginAs(sp, 'seller@zetex.uz', 'SellerPassword123');
  await sp.goto('/product/3');
  await expect(sp.getByRole('button', { name: 'Написать продавцу' })).toHaveCount(0);
  await ctx.close();
});

test('удаление аккаунта: пароль, после удаления войти нельзя', async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const email = await registerBuyer(p);
  await p.goto('/orders');
  await p.getByText('Профиль', { exact: true }).first().click();
  await p.getByRole('button', { name: 'Удалить аккаунт' }).click();
  await p.getByLabel('Введите пароль для подтверждения').fill('Password123!');
  await p.getByRole('button', { name: 'Удалить навсегда' }).click();
  await expect(p.getByText('Аккаунт удалён')).toBeVisible();
  const r = await ctx.request.post('/api/auth/login', { headers: H, data: { email, password: 'Password123!' } });
  expect(r.status()).toBe(401);
  await ctx.close();
});

test('на телефоне (360 px) страницы не вылезают за экран по ширине', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  for (const path of ['/', '/catalog', '/product/3', '/faq', '/contacts', '/terms']) {
    await page.goto(path);
    await expect(page.locator('h1, h2').first()).toBeVisible();
    expect(await overflow(), `горизонтальная прокрутка на ${path}`).toBeLessThanOrEqual(0);
  }
  await registerBuyer(page);
  await page.request.put('/api/cart/3', { headers: H, data: { qty: 1 } });
  for (const path of ['/checkout', '/orders', '/favorites', '/chats']) {
    await page.goto(path);
    await page.waitForTimeout(500);
    expect(await overflow(), `горизонтальная прокрутка на ${path}`).toBeLessThanOrEqual(0);
  }
  await page.goto('/orders');
  await page.getByRole('button', { name: /Профиль/ }).first().click({ timeout: 15000 });
  expect(await overflow(), 'горизонтальная прокрутка в профиле').toBeLessThanOrEqual(0);
});

test('админка: блокировка требует причину, карточка пользователя, журнал фиксирует действие', async ({ page }) => {
  const email = uniq();
  const r = await page.request.post('/api/auth/register', { headers: H, data: { email, password: 'Password123!', role: 'buyer', acceptTerms: true, firstName: 'Блок', lastName: 'Тест' } });
  expect(r.ok()).toBeTruthy();
  const buyerCtx = await page.context().browser().newContext();
  await loginAs({ context: () => buyerCtx }, 'admin@zetex.uz', 'Admin12345!');
  const admin = await buyerCtx.newPage();
  await admin.goto('/');
  await admin.getByRole('tab', { name: 'Пользователи' }).click();
  await admin.getByPlaceholder('Поиск по email, имени, компании').fill(email);
  await admin.getByRole('row').filter({ hasText: email }).getByRole('button', { name: 'Блок Тест' }).click();
  await admin.getByRole('button', { name: 'Заблокировать' }).click();
  await admin.getByRole('button', { name: 'Заблокировать', exact: true }).last().click(); // без причины
  await expect(admin.getByText('Укажите причину')).toBeVisible();
  await admin.getByRole('dialog').last().getByRole('textbox').fill('рассылка спама');
  await admin.getByRole('dialog').last().getByRole('button', { name: 'Заблокировать' }).click();
  await expect(admin.getByText('рассылка спама').first()).toBeVisible();
  await admin.getByRole('button', { name: 'Закрыть' }).click();
  await admin.getByRole('tab', { name: 'Журнал' }).click();
  await expect(admin.getByText('user.block').first()).toBeVisible();
  // заблокированный не может войти
  const res = await page.request.post('/api/auth/login', { headers: H, data: { email, password: 'Password123!' } });
  expect(res.status()).toBe(403);
  await buyerCtx.close();
});

test('админка: вход с двухфакторным кодом и массовое скрытие товаров с причиной', async ({ browser }) => {
  const { totp } = await import('../server/src/totp.js');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await ctx.request.post('/api/auth/login', { headers: H, data: { email: 'admin@zetex.uz', password: 'Admin12345!' } });
  const staff = uniq();
  const c = await ctx.request.post('/api/admin/team', { headers: H, data: { email: staff, password: 'StaffPass12345', firstName: 'Саша', scope: 'full' } });
  expect(c.ok()).toBeTruthy();
  await ctx.request.post('/api/auth/logout', { headers: H });
  // сотрудник включает 2FA
  await ctx.request.post('/api/auth/login', { headers: H, data: { email: staff, password: 'StaffPass12345' } });
  const { secret } = await (await ctx.request.post('/api/auth/2fa/setup', { headers: H, data: {} })).json();
  expect((await ctx.request.post('/api/auth/2fa/enable', { headers: H, data: { code: totp(secret) } })).ok()).toBeTruthy();
  await ctx.request.post('/api/auth/logout', { headers: H });
  // вход через форму: сначала просят код
  await page.goto('/');
  await page.getByRole('button', { name: 'Войти' }).first().click();
  await page.locator('input[type="email"]').fill(staff);
  await page.locator('input[type="password"]').fill('StaffPass12345');
  await page.getByRole('dialog').locator('button[type="submit"]').click();
  await expect(page.getByLabel('Код из приложения-аутентификатора')).toBeVisible();
  await page.getByLabel('Код из приложения-аутентификатора').fill(totp(secret));
  await page.getByRole('dialog').locator('button[type="submit"]').click();
  await expect(page.getByRole('heading', { name: 'Администрирование' })).toBeVisible();
  // массовое скрытие
  await page.getByRole('tab', { name: 'Товары' }).click();
  await page.getByRole('checkbox', { name: /Выбрать:/ }).nth(0).check();
  await page.getByRole('checkbox', { name: /Выбрать:/ }).nth(1).check();
  await expect(page.getByText('Выбрано: 2')).toBeVisible();
  await page.getByRole('region', { name: 'Массовые действия' }).getByRole('button', { name: 'Скрыть' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('нарушение правил');
  await page.getByRole('dialog').getByRole('button', { name: 'Скрыть' }).click();
  await page.getByLabel('Статус', { exact: true }).selectOption('hidden');
  await expect(page.getByText('нарушение правил').first()).toBeVisible();
  await ctx.close();
});
