import crypto from 'node:crypto';

// Палитра по категориям (пары для градиента)
const PALETTE = [
  ['#1f4fe0', '#6d8cff'], ['#0f9d6e', '#5fe0b0'], ['#e5484d', '#ff9a9d'], ['#f5a524', '#ffd37a'],
  ['#7c5cff', '#b9a6ff'], ['#0ea5e9', '#7dd3fc'], ['#14b8a6', '#7ee8dc'], ['#ec4899', '#f9a8d4'],
  ['#475467', '#98a2b3'], ['#f97316', '#fdba74'],
];

const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const h = (str, n) => parseInt(crypto.createHash('md5').update(str).digest('hex').slice(n, n + 6), 16);

/** Имя файла (32 hex) и SVG-картинка-заглушка для демо-товара. Продавец заменит её своим фото. */
export function placeholderFor(title, subcategory, catIndex) {
  const name = crypto.createHash('md5').update(title).digest('hex') + '.svg';
  const [c1, c2] = PALETTE[catIndex % PALETTE.length];
  const r = (n, a, b) => a + (h(title, n) % (b - a));
  const cx = r(0, 190, 410), cy = r(6, 190, 360), big = r(12, 130, 200);
  const label = esc(subcategory);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="600" height="600" fill="url(#g)"/>
<circle cx="${cx}" cy="${cy}" r="${big}" fill="#fff" fill-opacity=".16"/>
<circle cx="${600 - cx}" cy="${620 - cy}" r="${Math.round(big * 0.55)}" fill="#fff" fill-opacity=".12"/>
<rect x="${r(18, 150, 250)}" y="${r(24, 170, 250)}" width="200" height="200" rx="44" fill="#fff" fill-opacity=".92" transform="rotate(${r(30, -14, 14)} 300 300)"/>
<text x="300" y="316" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="30" font-weight="700" fill="${c1}">${label.length > 16 ? label.slice(0, 15) + '…' : label}</text>
</svg>`;
  return { name, svg };
}
