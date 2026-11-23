import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Валидация тела/запроса через zod; бросает 400 с понятным текстом. */
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue.path.join('.');
    throw new HttpError(400, field ? `${field}: ${issue.message}` : issue.message);
  }
  return r.data;
}

const json = (v, fallback) => { try { return JSON.parse(v); } catch { return fallback; } };

export const toProduct = (r) => ({
  id: r.id,
  sellerId: r.seller_id,
  title: r.title,
  description: r.description,
  category: r.category,
  subcategory: r.subcategory,
  price: r.price,
  oldPrice: r.old_price && r.old_price > r.price ? r.old_price : null,
  monthlyPrice: r.monthly_price,
  badge: r.badge,
  image: r.image,
  images: json(r.images, []),
  gallery: [r.image, ...json(r.images, [])],
  specs: json(r.specs, []),
  status: r.status,
  statusReason: r.status_reason || '',
  rating: r.rating,
  reviews: r.reviews,
  stock: r.stock,
  createdAt: r.created_at,
  isNew: Date.now() - Date.parse(r.created_at.replace(' ', 'T') + 'Z') < 7 * 864e5,
});

export const toUser = (r) => ({
  id: r.id,
  email: r.email,
  role: r.role,
  firstName: r.first_name,
  lastName: r.last_name,
  middleName: r.middle_name,
  phone: r.phone,
  birthDate: r.birth_date,
  gender: r.gender,
  companyName: r.company_name,
  inn: r.inn,
  emailVerified: !!r.email_verified,
  telegramLinked: !!r.telegram_chat_id,
  ...(r.role === 'admin' ? { adminScope: r.admin_scope || 'full', totpEnabled: !!r.totp_enabled } : {}),
});

export { CATEGORIES } from './taxonomy.js';

export const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

export const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];

// SQLite LOWER() не понимает кириллицу, поэтому поисковая строка нормализуется в JS
export const searchText = (title, category, description = '', subcategory = '') =>
  `${title} ${category} ${subcategory} ${description}`.toLowerCase();
