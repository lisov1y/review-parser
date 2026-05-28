# Образ для парсера отзывов. Бинарник Chromium ставится при сборке,
# чтобы ежедневные запуски не качали его заново.

FROM node:20-bookworm-slim

# Системные библиотеки, нужные Chromium внутри cloakbrowser.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates wget tini \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libpango-1.0-0 libpangocairo-1.0-0 libcairo2 libasound2 \
    libgtk-3-0 libxshmfence1 fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

# Предзагрузка бинарника Chromium. Если не получилось — скачается при первом запуске.
RUN node -e "(async () => { const { ensureBinary } = await import('cloakbrowser'); await ensureBinary(); })()" \
    || echo "[warn] предзагрузка Chromium не удалась, попробуем при первом запуске"

COPY tsconfig.json ./
COPY src ./src

ENV HEADLESS=true
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "all"]
