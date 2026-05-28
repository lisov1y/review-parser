# Интеграция парсера с MMANALYT

Пошаговая инструкция: добавляем таблицу `map_reviews` в БД MMANALYT, разворачиваем
парсер рядом с ним в docker-compose, ставим ежедневный крон.

Все операции **аддитивные** — существующая логика MMANALYT не трогается.

---

## 1. Подготовка сервера

На сервере должны жить рядом два каталога:

```
/root/
  MMANALYT/    — уже есть
  parser/      — клонируем сюда наш репозиторий
```

```bash
cd /root
git clone <ваш-url-репозитория-парсера> parser
```

> Если репозитория ещё нет — просто скопируйте папку парсера на сервер любым способом (rsync, scp).

## 2. Миграция БД (новая таблица `map_reviews`)

### 2.1. Добавить модель в Prisma-схему

Открыть `/root/MMANALYT/backend/prisma/schema.prisma` и в конец файла дописать
содержимое **`schema-addition.prisma`** (рядом с этим README).

### 2.2. Скопировать миграцию

```bash
cp -r /root/parser/mmanalyt-patch/migrations/20260528000000_add_map_reviews \
      /root/MMANALYT/backend/prisma/migrations/
```

### 2.3. Применить миграцию

Поднять стек, чтобы был доступен Postgres:

```bash
cd /root/MMANALYT
docker compose up -d postgres
```

Затем выполнить миграцию через backend-контейнер (Prisma уже установлен):

```bash
docker compose run --rm backend npx prisma migrate deploy
```

Проверить, что таблица создалась:

```bash
docker compose exec postgres psql -U moremania -d moremania -c "\dt map_reviews"
```

Должна показаться одна строка с `map_reviews`.

## 3. Добавить сервис парсера в docker-compose

В `/root/MMANALYT/docker-compose.yml`:

- В блок `services:` дописать содержимое **`compose-snippet.yml`** (сервис `parser`).
- В блок `volumes:` внизу файла добавить именованный том `parser_cache:`.

Собрать образ парсера (займёт несколько минут — внутри качается Chromium):

```bash
cd /root/MMANALYT
docker compose build parser
```

## 4. Первый запуск

```bash
cd /root/MMANALYT
docker compose run --rm parser
```

Парсер обойдёт все 33 точки по трём картам и зальёт отзывы в `map_reviews`.
Файлы-зеркала JSON останутся в `/root/parser/data/output/<id>-<source>.json` для бэкапа.

Первый прогон может занять час-два (зависит от Google).

Проверить, что данные пришли в БД:

```bash
docker compose exec postgres psql -U moremania -d moremania \
  -c "SELECT source, COUNT(*) FROM map_reviews GROUP BY source"
```

## 5. Ежедневный запуск (cron)

На хосте, под root:

```bash
crontab -e
```

Добавить строку:

```
0 4 * * * cd /root/MMANALYT && /usr/bin/docker compose run --rm parser >> /var/log/mm-parser.log 2>&1
```

Парсер будет запускаться каждый день в 04:00. Поскольку файл уже наполнен — повторные
запуски быстро дозабирают только новые отзывы (отсортировано «по новизне»; как только
скролл доходит до уже известных id — останавливается).

В логе по каждой точке будет: `[001] всего отзывов: 1750 (новых за запуск: 2)`.
В конце по каждой карте: `[yandex] готово. Новых отзывов за запуск: 15`.

## 6. Что в БД

Каждый отзыв — одна строка в `map_reviews`:

| поле           | пример                                  |
|----------------|-----------------------------------------|
| source         | `yandex` / `2gis` / `google`            |
| external_id    | id отзыва в источнике                   |
| restaurant_id  | `788` (совпадает с `restaurants.id`)    |
| author_name    | `Иван Иванов`                           |
| rating         | `5`                                     |
| text           | текст отзыва                            |
| review_date    | `2026-05-20T13:51:15.213Z` / `10 месяцев назад` |
| business_reply | ответ заведения (если есть)             |
| collected_at   | когда впервые добавили в БД             |

Уникальность: `(source, external_id)` — повторный сбор того же отзыва не создаёт дубликата,
а обновляет text/rating/reply (на случай редактирования).

## 7. Подключение к дашборду (Фаза 2)

Делается отдельно, в MMANALYT:

- **Общий балл точки** — добавить в существующий расчёт среднюю оценку из `map_reviews` для точки.
- **Облако тегов и тренды** — расширить AI-воркер так, чтобы он, кроме `Lead.review_text`,
  обрабатывал и `MapReview.text` (та же классификация в `complaintTypeName`-категории).

Эта часть — на стороне MMANALYT, парсера не касается.
