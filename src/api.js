import { t } from './i18n';
// Тонкий клиент для REST API (/api проксируется на сервер через vite.config.js).
// Сессия живёт в httpOnly-cookie: скрипты страницы токена не видят (защита от кражи через XSS).
// Заголовок X-Zetex-Client — защита от CSRF: чужой сайт не может отправить его с изменяющим запросом.
const BASE = import.meta.env.VITE_API_URL || '/api';
const CLIENT_HEADERS = { 'X-Zetex-Client': 'web' };

// Старые версии хранили токен в localStorage — убираем его
try { localStorage.removeItem('ztx_token'); } catch { /* приватный режим */ }

// Путь загруженного фото (/uploads/…) → полный адрес. Внешние ссылки остаются как есть.
// Если фронт и API на разных доменах, задайте VITE_ASSET_URL (например https://api.zetex.uz).
export const imgUrl = (path) => (path && path.startsWith('/uploads/') ? (import.meta.env.VITE_ASSET_URL || '') + path : path);

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function send(path, init) {
  let res;
  try {
    res = await fetch(BASE + path, { credentials: 'include', ...init, headers: { ...CLIENT_HEADERS, ...init.headers } });
  } catch {
    throw new ApiError(t('Нет связи с сервером. Проверьте, что бэкенд запущен.'), 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* пустой ответ */ }
  // 502/503/504 без ответа от API — это прокси (vite/Caddy) не достучался до бэкенда
  if (!res.ok && !data?.error && [502, 503, 504].includes(res.status)) {
    throw new ApiError(t('Сервер API не отвечает. Запустите бэкенд: npm run dev:all (или npm run server) и посмотрите ошибки в терминале.'), res.status);
  }
  if (!res.ok) {
    const err = new ApiError(data?.error || t('Ошибка {n}', { n: res.status }), res.status);
    if (data?.need2fa) err.need2fa = true;
    throw err;
  }
  return data;
}

const request = (method, path, body) => send(path, {
  method,
  headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
  body: body !== undefined ? JSON.stringify(body) : undefined,
});

export const qs = (params) => {
  const u = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null && v !== false) u.set(k, v); });
  const s = u.toString();
  return s ? `?${s}` : '';
};

async function upload(file) {
  const fd = new FormData();
  fd.append('file', file);
  return (await send('/uploads', { method: 'POST', headers: {}, body: fd })).url;
}

export const api = {
  uploadImage: upload,
  config: () => request('GET', '/config'),
  // auth
  register: (d) => request('POST', '/auth/register', d),
  login: (d) => request('POST', '/auth/login', d),
  logout: () => request('POST', '/auth/logout'),
  twoFaSetup: () => request('POST', '/auth/2fa/setup', {}),
  twoFaEnable: (code) => request('POST', '/auth/2fa/enable', { code }),
  twoFaDisable: (password, code) => request('POST', '/auth/2fa/disable', { password, code }),
  me: () => request('GET', '/auth/me'),
  updateProfile: (d) => request('PATCH', '/auth/me', d),
  changePassword: (d) => request('POST', '/auth/change-password', d),
  forgotPassword: (email) => request('POST', '/auth/forgot-password', { email }),
  resetPassword: (token, password) => request('POST', '/auth/reset-password', { token, password }),
  verifyEmail: (token) => request('POST', '/auth/verify-email', { token }),
  resendVerification: () => request('POST', '/auth/resend-verification'),
  // корзина (на сервере, только покупатель)
  cart: () => request('GET', '/cart'),
  setCartQty: (productId, qty) => request('PUT', `/cart/${productId}`, { qty }),
  clearCart: () => request('DELETE', '/cart'),
  // сообщения покупателя и продавца
  chats: () => request('GET', '/chats'),
  chat: (id, after = 0) => request('GET', `/chats/${id}${qs({ after })}`),
  startChat: (d) => request('POST', '/chats', d),
  sendMessage: (id, text) => request('POST', `/chats/${id}/messages`, { text }),
  chatsUnread: () => request('GET', '/chats/unread'),
  // аккаунт
  exportUrl: `${BASE}/account/export`,
  deleteAccount: (password) => request('POST', '/account/delete', { password }),
  // products
  categories: () => request('GET', '/products/categories'),
  productsMeta: (params = {}) => request('GET', `/products/meta${qs(params)}`),
  product: (id) => request('GET', `/products/${id}`),
  products: (params = {}) => request('GET', `/products${qs(params)}`),
  suggest: (q) => request('GET', `/products/suggest${qs({ q })}`),
  related: (id) => request('GET', `/products/${id}/related`),
  reportProduct: (id, d) => request('POST', `/products/${id}/report`, d),
  myProducts: () => request('GET', '/products/mine/list'),
  createProduct: (d) => request('POST', '/products', d),
  updateProduct: (id, d) => request('PUT', `/products/${id}`, d),
  deleteProduct: (id) => request('DELETE', `/products/${id}`),
  importProducts: (csv, dryRun) => request('POST', '/products/import', { csv, dryRun }),
  importTemplateUrl: `${BASE}/products/import/template`,
  // reviews
  reviews: (productId, params = {}) => request('GET', `/products/${productId}/reviews${qs(params)}`),
  addReview: (productId, d) => request('POST', `/products/${productId}/reviews`, d),
  updateReview: (id, d) => request('PATCH', `/reviews/${id}`, d),
  deleteReview: (id) => request('DELETE', `/reviews/${id}`),
  replyReview: (id, text) => request('POST', `/reviews/${id}/reply`, { text }),
  // favorites
  favorites: () => request('GET', '/favorites'),
  addFavorite: (id) => request('PUT', `/favorites/${id}`),
  removeFavorite: (id) => request('DELETE', `/favorites/${id}`),
  // orders
  createOrder: (d) => request('POST', '/orders', d),
  orders: () => request('GET', '/orders'),
  order: (id) => request('GET', `/orders/${id}`),
  cancelOrder: (id) => request('POST', `/orders/${id}/cancel`),
  sellerOrders: () => request('GET', '/orders/seller/list'),
  sellerStats: () => request('GET', '/orders/seller/stats'),
  sellerPayouts: () => request('GET', '/orders/seller/payouts'),
  reportMessage: (id, reason = '') => request('POST', `/chats/messages/${id}/report`, { reason }),
  sellerAnalytics: (days = 30) => request('GET', `/orders/seller/analytics${qs({ days })}`),
  setOrderStatus: (id, status) => request('PATCH', `/orders/seller/${id}/status`, { status }),
  // promo codes
  validatePromo: (d) => request('POST', '/promos/validate', d),
  myPromos: () => request('GET', '/promos/mine'),
  createPromo: (d) => request('POST', '/promos/mine', d),
  updatePromo: (id, d) => request('PATCH', `/promos/mine/${id}`, d),
  deletePromo: (id) => request('DELETE', `/promos/mine/${id}`),
  // payments
  paymentLink: (orderId) => request('GET', `/payments/link/${orderId}`),
  mockPay: (orderId) => request('POST', `/payments/mock/${orderId}/pay`),
  // telegram (продавец)
  telegramLinkCode: () => request('POST', '/telegram/link-code'),
  telegramUnlink: () => request('DELETE', '/telegram/link'),
  // admin
  admin: {
    stats: () => request('GET', '/admin/stats'),
    analytics: (days) => request('GET', `/admin/analytics${qs({ days })}`),
    users: (p = {}) => request('GET', `/admin/users${qs(p)}`),
    user: (id) => request('GET', `/admin/users/${id}`),
    patchUser: (id, d) => request('PATCH', `/admin/users/${id}`, d),
    blockUser: (id, blocked, reason = '') => request('PATCH', `/admin/users/${id}`, { blocked, reason }),
    products: (p = {}) => request('GET', `/admin/products${qs(p)}`),
    setProductStatus: (id, status, extra = {}) => request('PATCH', `/admin/products/${id}/status`, { status, ...extra }),
    deleteProduct: (id, reason = '') => request('DELETE', `/admin/products/${id}`, { reason }),
    bulkProducts: (d) => request('POST', '/admin/products/bulk', d),
    orders: (p = {}) => request('GET', `/admin/orders${qs(p)}`),
    order: (id) => request('GET', `/admin/orders/${id}`),
    setOrderStatus: (id, status, reason = '') => request('POST', `/admin/orders/${id}/status`, { status, reason }),
    refundDone: (id, note = '') => request('POST', `/admin/orders/${id}/refund-done`, { note }),
    financeSellers: () => request('GET', '/admin/finance/sellers'),
    payouts: (p = {}) => request('GET', `/admin/finance/payouts${qs(p)}`),
    createPayout: (d) => request('POST', '/admin/finance/payouts', d),
    reports: (p = {}) => request('GET', `/admin/reports${qs(p)}`),
    setReportStatus: (id, status) => request('PATCH', `/admin/reports/${id}`, { status }),
    patchReport: (id, d) => request('PATCH', `/admin/reports/${id}`, d),
    bulkReports: (d) => request('POST', '/admin/reports/bulk', d),
    reviews: (p = {}) => request('GET', `/admin/reviews${qs(p)}`),
    deleteReview: (id, reason = '') => request('DELETE', `/admin/reviews/${id}`, { reason }),
    bulkReviews: (d) => request('POST', '/admin/reviews/bulk', d),
    chatReports: (p = {}) => request('GET', `/admin/chat-reports${qs(p)}`),
    patchChatReport: (id, status) => request('PATCH', `/admin/chat-reports/${id}`, { status }),
    conversations: (p = {}) => request('GET', `/admin/conversations${qs(p)}`),
    conversation: (id) => request('GET', `/admin/conversations/${id}`),
    deleteMessage: (id, reason = '') => request('DELETE', `/admin/messages/${id}`, { reason }),
    promos: () => request('GET', '/admin/promos'),
    createPromo: (d) => request('POST', '/admin/promos', d),
    updatePromo: (id, d) => request('PATCH', `/admin/promos/${id}`, d),
    deletePromo: (id) => request('DELETE', `/admin/promos/${id}`),
    team: () => request('GET', '/admin/team'),
    createStaff: (d) => request('POST', '/admin/team', d),
    patchStaff: (id, d) => request('PATCH', `/admin/team/${id}`, d),
    settings: () => request('GET', '/admin/settings'),
    saveSettings: (d) => request('PUT', '/admin/settings', d),
    audit: (p = {}) => request('GET', `/admin/audit${qs(p)}`),
    exportUrl: (name, p = {}) => `${BASE}/admin/export/${name}.csv${qs(p)}`,
  },
};

// onError для <img>: скрывает битую картинку, чтобы не показывался alt-текст поверх карточки
export const hideBrokenImg = (e) => { e.currentTarget.style.visibility = 'hidden'; };
