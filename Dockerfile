# syntax=docker/dockerfile:1

# ---- Стадия 1: сборка фронтенда ----
FROM node:22-alpine AS web
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js eslint.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

# ---- Стадия 2: рантайм ----
# node:sqlite доступен без флагов в Node 22.13+ (в образе 22-alpine версия новее);
# предупреждение ExperimentalWarning скрывается флагом --disable-warning.
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=3001
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server/src ./src
COPY --from=web /build/dist /app/dist
# SQLite и загрузки: /app/server/data (DATA_DIR по умолчанию). dist лежит в /app/dist, как ждёт config.js
RUN mkdir -p /app/server/data && chown -R node:node /app/server/data
VOLUME /app/server/data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
