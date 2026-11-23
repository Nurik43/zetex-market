# Zetex Market

Marketplace (B2C/B2B) for Uzbekistan: buyers, sellers and the administrator. The frontend is React + Vite (at the root), the backend is Express + embedded SQLite (`node:sqlite') in `server/'. In production, a single Node process outputs both the API and the assembled frontend (`dist/`, SPA fallback).

## Features

- Roles: buyer, seller, administrator. Registration, login (JWT in cookie), password change and reset, email confirmation.
- Catalog: 15 categories with subcategories, search, filters (price, rating, availability), sorting, search suggestions, similar products.
- Favorites, reviews and ratings, seller's responses to reviews, complaints about products.
- Orders: shopping cart, courier delivery or pickup from the pick-up point, promo codes, cancellation with refund of balances, automatic cancellation of unpaid online orders.
- Payment: cash, Payme, Click, demo payment (mock).
- Admin panel: statistics, users, product moderation, orders and refunds, complaints, reviews, promo codes.
- Notifications: emails (SMTP) and Telegram bot. To the seller — about new orders, to the buyer — about each stage of the order (completed, paid, confirmed, in delivery, delivered, canceled); Telegram is linked in the seller's profile or cabinet.
- The shopping cart is stored on the server (in the buyer's account), it is the same on all devices; it is used only by logged-in customers.
- Chat buyer ↔ seller: a question about a product or order, a list of conversations, an unread icon in the header, a letter and a Telegram notification to the recipient (at the first unread in the conversation). Messages are pulled up by polling every 4 seconds, without WebSocket.
- My data: uploading everything that is stored about the user (`GET /api/account/export`) and deleting the account by password (`POST /api/account/delete`): personal data is erased, orders remain without name, phone number and address; cannot be deleted while there are incomplete orders, and the administrator cannot be deleted.
- Legal pages: user agreement, privacy policy, refund and exchange, contacts, questions and answers. Upon registration, it is mandatory to agree to the terms (the time of consent is stored in `users.terms_accepted_at`).
- SEO: clean addresses (`/product/12`, `/catalog?category=...`; old links`/#/…`redirected), `title`/`description`/canonical/Open Graph and JSON-LD `Product` are substituted by the server in HTML, `sitemap.xml `, `robots.txt `personal sections are closed from indexing, non-existent pages and hidden goods give 404.

## Quick Start (development)

A Node is needed.js 22.5+.

```bash
npm i
cd server && npm i && cd ..
npm run dev:all # front http://localhost:5173 + API http://localhost:3001
```

Or in parts: `npm run dev` (front), `npm run server` (API). The `npm run setup` command sets the dependencies of both projects. Vite proxies `/api` and `/uploads` to port 3001.

At the first launch (outside of production), the 'server/data/zetex.db` database is filled with demo data: accounts and about 100 products. Demo data is not created in production; enable `SEED_DEMO=1` for the trial stand.

### Demo accounts

| Role | Email | Password |
|---|---|---|
| Buyer | info@zetex.uz | Password123! |
| Seller | seller@zetex.uz | SellerPassword123 |
| Admin | admin@zetex.uz | Admin12345! |

A demo administrator is created only outside of production. In production, set `ADMIN_EMAIL` and `ADMIN_PASSWORD`, otherwise there will be no administrator. Demo accounts of the buyer and seller are created with an empty database, including in production: after the first launch, change their passwords or delete them.

## Environment variables

For a complete list with comments, see `.env.example'. Key:

| Variable | Assignment | By default |
|---|---|---|
| `PORT` | server port | 3001 |
| `JWT_SECRET` | the session secret | is generated in `data/.jwt_secret` |
| `JWT_EXPIRES_IN` | session duration | 7d |
| `APP_URL` | the public address of the website | http://localhost:5173 |
| `CORS_ORIGIN` | comma-separated allowed origin | localhost:5173 |
| `TRUST_PROXY', `COOKIE_SECURE` | proxy operation / Secure cookies | enabled in production |
| `TZ_OFFSET_HOURS` | time zone shift | 5 |
| `ADMIN_EMAIL', `ADMIN_PASSWORD` | administrator account | demo outside production |
| `DATA_DIR`, `DB_FILE', `UPLOAD_DIR`, `DIST_DIR` | paths | `server/data`, `dist` |
| `SMTP_URL', `MAIL_FROM', `REQUIRE_VERIFIED_EMAIL` | mail | empty / 0 |
| `TELEGRAM_BOT_TOKEN', `TELEGRAM_ADMIN_CHAT_ID` | Telegram bot | empty |
| `PAYMENTS_MOCK`, `PAYMENT_HOLD_MINUTES` | demo payment, waiting time for payment | outside production 1, 30 min |
| `PAYME_MERCHANT_ID', `PAYME_KEY', `PAYME_TEST` | Payme | empty |
| `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_SECRET_KEY` | Click | empty |
| `DELIVERY_FEE', `FREE_DELIVERY_FROM` | delivery, bags | 25000 / 500000 |
| `DOMAIN` | domain for Caddy (docker-compose only) | — |

## API (overview)

All paths start with `/api'. Verification: `GET /api/health'.

| Group | Paths |
|---|---|
| `/auth` | `register`, `login`, `logout`, `me` (GET/PATCH), `change-password`, `forgot-password`, `reset-password`, `verify-email`, `resend-verification` |
| `/products` | a list with filters, `meta`, `suggest`, `categories', `mine/list`, `import` and `import/template' (CSV), `:id` (GET/PUT/DELETE), `:id/related`, `:id/report` |
| reviews | `products/:id/reviews` (GET/POST), `reviews/:id` (PATCH/DELETE), `reviews/:id/reply` |
| `/favorites` | list, `PUT/DELETE /:ProductID` |
| `/orders` | creation and list, `:id`, `:id/cancel`, to seller: `seller/list`, `seller/stats`, `seller/analytics`, `seller/:id/status` |
| `/uploads` | uploading photos (PNG/JPG/WEBP/GIF up to 2 MB) |
| `/promos` | `validate`, `mine` (CRUD for seller) |
| `/payments` | `link/:OrderID`, `mock/:OrderID/pay`, `payme`, `click/prepare`, `click/complete` |
| `/admin` | `stats`, `users`, `products`, `orders` (+ `refund-done`), `reports`, `reviews`, `promos` |
| other | `config`, `telegram/link-code', `telegram/link` |

For the exact schemes and access rights, see `server/src/routes/*'.

## Admin Panel

The tabs depend on the employee's role: **Full access**, **moderator** (users, products, complaints, reviews, chats) and **financier** (orders, payouts, uploads). Employees are created by an admin with full access in the "Team" tab.

- **Log** — each action (blocking, hiding the product, changing the order status, payment, settings, viewing someone else's correspondence) is written with the author, reason and time; uploading to CSV.
- **Reasons** — blocking, hiding and deleting require a reason; it is sent to the seller or user by mail / Telegram.
- **Moderation of products** — mode in "Settings": publish immediately, check new sellers or all products. "Approve and trust" makes the seller verified.
- **Money** — commission (total and by category), balance of each seller, record of payments; everything is uploaded to CSV.
- **Mass actions**, user and order cards, filters and sorting in all tables.
- **Chats** — complaints about messages, viewing correspondence (recorded in the log), deleting messages, blocking.
- **Security** — Two-factor login (Google/Microsoft Authenticator) in the Security tab. The administrator receives complaints from Telegram, new products for verification, and large orders (the threshold is in Settings).
- **Settings** — the ad above the header, delivery and pick-up points, contacts and banking details — without editing `.env'.

## Seller's account

Tabs: **My Products**, **Orders**, **Reviews**, **Finance**, **Analytics**, **Promo Codes**, **Store**, **CSV Import**, **Notifications**.

- Products: calculation "you will receive" after the commission, mass actions (price in %, balance, hide, promotion), editing the price and balance directly in the table, warnings about a small balance, promotions with a deadline (the "Discounts" block on the main page), copying the product, exporting to CSV (the file can be downloaded back).
- Orders: track number and comment to the buyer (visible in his order), invoice printing.
- Reviews: a list marked "unanswered". Chat: quick replies and a counter for conversations waiting for a response.
- Finance: sold, commission, paid, payable, payment history, banking details.
- Analytics: views, favorites, shopping cart, product conversion, comparison of periods, categories.
- Store: logo, banner, description, public page `/shop/:id' (link from the product card), "on vacation" mode (goods are hidden, return date is shown), employees without access to finances and promo codes.

## Deploy via Docker

We need a Docker server, a domain, a DNS record on the server, and open ports 80/443.

``bash
cp .env .example .env
# fill in DOMAIN, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD and the rest if necessary
docker compose up -d --build
```

The 'app` service is assembled from the `Dockerfile` (the front is assembled in the first stage, the runtime is powered by the user `node', port 3001, healthcheck on `/api/health`). The 'caddy` service receives a Let's Encrypt certificate and proxies traffic to the `app'. The data (SQLite, downloads, `.jwt_secret') is in the 'zetex-data` volume (`/app/server/data'), the certificates are in the `caddy-data`. Compose itself sets `NODE_ENV=production`, `TRUST_PROXY=1`, `COOKIE_SECURE=1`, `APP_URL` and `CORS_ORIGIN` from `DOMAIN`.

Update: `git pull && docker compose up -d --build'.

## Deploy without Docker

```bash
npm ci && npm run build
cd server && npm ci --omit=dev
NODE_ENV=production PORT=3001 JWT_SECRET=... ADMIN_EMAIL=... ADMIN_PASSWORD=... \
  APP_URL=https://your.domain npm start
```

Express distributes the 'dist/` itself. Put nginx or Caddy with HTTPS in front of it (cookies in production are marked Secure) and run the process under systemd/pm2.

## SQLite Backups

The entire state is in the data directory (`server/data/`, in the Docker volume `zetex—data`): `zetex.db`, `uploads/`, `.jwt_secret'.

- Hot copy of the database: `sqlite3 server/data/zetex.db'.backup 'backup.db'"`.
- Copying the catalog when the service is stopped: `docker compose stop app', then a copy of `data/` (in Docker, for example, `docker run --rm -v zetex-market_zetex-data:/d -v $PWD:/b alpine tar czf /b/data.tgz -C/d .`; the volume name depends on the project name, check `docker volume ls'), then `docker compose start app'.
