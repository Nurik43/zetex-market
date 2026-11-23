import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { db } from './db.js';
import { HttpError, toUser } from './util.js';

export const signToken = (userRow) =>
  jwt.sign({ sub: userRow.id, tv: userRow.token_version ?? 0 }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Токен берём из httpOnly-cookie (браузер) или из заголовка Bearer (скрипты, тесты). */
function readToken(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (m) return { token: m[1], viaCookie: false };
  const c = parseCookies(req.headers.cookie)[config.cookieName];
  return c ? { token: c, viaCookie: true } : { token: null };
}

function readUser(req) {
  const { token, viaCookie } = readToken(req);
  if (!token) return null;
  // Защита от CSRF для сессии в cookie: изменяющие запросы должны нести заголовок, который чужой сайт отправить не может
  if (viaCookie && !SAFE.has(req.method) && !req.headers['x-zetex-client']) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!row || row.blocked || (row.token_version ?? 0) !== (payload.tv ?? 0)) return null;
    return toUser(row);
  } catch {
    return null;
  }
}

export function setSessionCookie(res, userRow) {
  res.cookie(config.cookieName, signToken(userRow), {
    httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: 7 * 864e5,
  });
}
export const clearSessionCookie = (res) => res.clearCookie(config.cookieName, { path: '/' });

/** Подставляет req.user, если вход выполнен; иначе пропускает дальше. */
export function optionalAuth(req, _res, next) {
  req.user = readUser(req);
  next();
}

export function requireAuth(req, _res, next) {
  const user = readUser(req);
  if (!user) return next(new HttpError(401, 'Требуется авторизация'));
  req.user = user;
  next();
}

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(new HttpError(403, 'Недостаточно прав'));

/** Права внутри админки: full видит всё, moderator — модерацию, finance — деньги. */
export const requireScope = (...scopes) => (req, _res, next) => {
  const sc = req.user?.adminScope || 'full';
  return sc === 'full' || scopes.includes(sc) ? next() : next(new HttpError(403, 'Недостаточно прав для этого раздела'));
};
