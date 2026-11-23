import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { requireAuth, requireRole } from '../auth.js';
import { HttpError } from '../util.js';

const router = Router();
const MAX_BYTES = 2 * 1024 * 1024;

// Тип определяем по содержимому (magic bytes), а не по имени файла или заголовку клиента
function detectType(b) {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'webp';
  if (b.length > 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString())) return 'gif';
  return null;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 10_000 : 60,
  message: { error: 'Слишком много загрузок. Попробуйте позже.' },
});

router.post('/', requireAuth, requireRole('seller'), limiter, (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'Фото слишком большое — максимум 2 МБ'));
    if (err) return next(new HttpError(400, 'Не удалось прочитать файл'));
    if (!req.file) return next(new HttpError(400, 'Выберите файл в поле «file»'));
    const ext = detectType(req.file.buffer);
    if (!ext) return next(new HttpError(400, 'Допустимы только изображения PNG, JPG, WEBP или GIF'));
    const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(config.uploadDir, name), req.file.buffer, { flag: 'wx' });
    res.status(201).json({ url: `/uploads/${name}` });
  });
});

/** Удаляет файл из /uploads, если на него больше никто не ссылается (вызывать после удаления/замены). */
export function removeUploadIfUnused(db, imagePath) {
  const m = /^\/uploads\/([a-f0-9]{32}\.(?:jpg|png|webp|gif|svg))$/.exec(imagePath || '');
  if (!m) return;
  const used = db.prepare("SELECT 1 FROM products WHERE image = ? OR images LIKE ? UNION SELECT 1 FROM order_items WHERE image = ?")
    .get(imagePath, `%${imagePath}%`, imagePath);
  if (!used) fs.rm(path.join(config.uploadDir, m[1]), { force: true }, () => {});
}

export default router;
