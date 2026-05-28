// Общий движок сбора отзывов с карт (Яндекс / 2ГИС / Google).
// Поддерживает два режима получения отзывов:
//   "api" — страница сама запрашивает JSON, мы читаем ответы сети;
//   "dom" — отзывы вычитываются прямо из вёрстки страницы.
// Каждый коллектор задаёт настройки своей карты и вызывает run().

import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { launch } from "cloakbrowser";
import { closeDb, isDbEnabled, upsertReviews } from "./db.js";

export type Point = {
  id: string;
  name: string;
  restaurantId: number; // id точки в MMANALYT (Bitrix)
  yandex: string;
  "2gis": string;
  google: string;
};

export type Review = {
  id: string;
  authorName: string | null;
  rating: number | null;
  date: string | null;
  text: string;
  businessReply: string | null;
};

export type ParsedReviews = { reviews: Review[]; total: number };

// Настройки одной карты. mode выбирает способ получения отзывов.
export type Platform = {
  source: string; // имя файла результата: data/output/<id>-<source>.json
  urlField: "yandex" | "2gis" | "google"; // поле точки со ссылкой
  reviewsUrl: (url: string) => string; // привести ссылку к странице отзывов
  // подготовка страницы (закрыть поп-апы, открыть вкладку, включить сортировку);
  // вернуть true, если список отсортирован по новизне
  prepare: (page: any) => Promise<boolean>;
} & (
  | {
      mode: "api";
      isReviewsResponse: (url: string) => boolean;
      parseResponse: (body: string) => ParsedReviews;
    }
  | {
      mode: "dom";
      extractReviews: (page: any) => Promise<ParsedReviews>;
    }
);

const MAX_SCROLLS = 400;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

// Кликает по первому видимому совпадению через координаты мыши
// (locator.click ненадёжен на выпадающих меню и поп-апах карт).
export async function clickFirstVisible(
  page: any,
  locator: any
): Promise<boolean> {
  const count = await locator.count();
  for (let i = 0; i < count; i++) {
    const box = await locator.nth(i).boundingBox();
    if (!box || box.width === 0 || box.height === 0) continue;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(200);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return true;
  }
  return false;
}

const outputPath = (source: string, point: Point) =>
  `data/output/${point.id}-${source}.json`;

async function loadExisting(
  source: string,
  point: Point
): Promise<Map<string, Review>> {
  try {
    const raw = await readFile(outputPath(source, point), "utf-8");
    const parsed = JSON.parse(raw) as { reviews?: Review[] };
    return new Map((parsed.reviews ?? []).map((r) => [r.id, r]));
  } catch {
    return new Map();
  }
}

async function save(source: string, point: Point, byId: Map<string, Review>) {
  const reviews = [...byId.values()].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? "")
  );
  const payload = {
    point,
    collectedAt: new Date().toISOString(),
    reviewsCount: reviews.length,
    reviews,
  };
  await writeFile(outputPath(source, point), JSON.stringify(payload, null, 2), "utf-8");
}

// Крутит колесо над левой панелью с отзывами — карта подгружает новую порцию.
async function scrollDown(page: any) {
  await page.mouse.move(215, 400); // точка внутри левой панели
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 1200);
    await sleep(150);
  }
}

async function collectPoint(
  page: any,
  platform: Platform,
  point: Point
): Promise<{ added: number; isUpdate: boolean }> {
  console.log(`\n[${point.id}] ${point.name}`);

  const reviewsById = await loadExisting(platform.source, point);
  const startSize = reviewsById.size; // сколько отзывов было собрано прежде
  const isUpdate = startSize > 0; // файл уже есть — значит это повторный запуск

  // harvest() отдаёт порцию отзывов, появившихся со времени прошлого вызова.
  let harvest: () => Promise<ParsedReviews>;
  let stopListening = () => {};
  let debug = "";

  if (platform.mode === "api") {
    // Запросы к API делает страница сама — копим ответы в буфер.
    const { isReviewsResponse, parseResponse } = platform;
    const buffer: Review[] = [];
    let apiTotal = 0;
    const onResponse = async (response: any) => {
      try {
        if (!isReviewsResponse(response.url())) return;
        const body = await response.text();
        if (!debug) debug = body;
        const parsed = parseResponse(body);
        apiTotal = Math.max(apiTotal, parsed.total);
        buffer.push(...parsed.reviews);
      } catch {}
    };
    page.on("response", onResponse);
    stopListening = () => page.off("response", onResponse);
    harvest = async () => {
      for (let w = 0; w < 10_000 && buffer.length === 0; w += 400) {
        await sleep(400);
      }
      return { reviews: buffer.splice(0), total: apiTotal };
    };
  } else {
    // Отзывы вычитываем прямо из вёрстки после каждого скролла.
    const { extractReviews } = platform;
    harvest = async () => {
      await sleep(2500); // дать вёрстке обновиться
      return extractReviews(page);
    };
  }

  let total = 0;
  try {
    await page.goto(platform.reviewsUrl(point[platform.urlField]), {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await sleep(6000);
    const sorted = await platform.prepare(page);

    let emptyScrolls = 0;
    for (let i = 0; i < MAX_SCROLLS; i++) {
      const sizeBefore = reviewsById.size;

      await scrollDown(page);
      const { reviews, total: t } = await harvest();
      total = Math.max(total, t);
      for (const review of reviews) reviewsById.set(review.id, review);

      await save(platform.source, point, reviewsById);
      console.log(`  скролл ${i + 1}: ${reviewsById.size}/${total || "?"}`);

      const gotNew = reviewsById.size > sizeBefore;
      if (total > 0 && reviewsById.size >= total) break; // собрали все отзывы
      if (isUpdate && sorted && reviews.length > 0 && !gotNew) break; // дошли до известных
      emptyScrolls = gotNew ? 0 : emptyScrolls + 1;
      if (emptyScrolls >= 5) break; // новые отзывы перестали появляться
    }
  } finally {
    stopListening();
  }

  await save(platform.source, point, reviewsById);
  // Записать отзывы в БД MMANALYT (если задан DATABASE_URL).
  await upsertReviews(platform.source, point, [...reviewsById.values()]);
  const added = reviewsById.size - startSize;
  console.log(
    `[${point.id}] всего отзывов: ${reviewsById.size}` +
      (isUpdate ? ` (новых за запуск: ${added})` : "")
  );

  // Если не собрали ничего — сохраняем диагностику для настройки парсера.
  if (reviewsById.size === 0) {
    const file =
      platform.mode === "api"
        ? `data/output/_debug-${platform.source}.txt`
        : `data/output/_debug-${platform.source}.html`;
    const content = platform.mode === "api" ? debug : await page.content();
    await writeFile(file, content.slice(0, 200_000), "utf-8").catch(() => {});
    console.log(`  (диагностика сохранена в ${file})`);
  }

  return { added, isUpdate };
}

export async function run(platform: Platform) {
  await mkdir("data/output", { recursive: true });

  const points = JSON.parse(
    await readFile("data/input/points.json", "utf-8")
  ) as Point[];
  const targets = points.filter((p) => clean(p[platform.urlField]));
  console.log(
    `[${platform.source}] точек со ссылкой: ${targets.length} из ${points.length}` +
      (isDbEnabled() ? " (запись в БД включена)" : "")
  );

  const browser = await launch({ headless: process.env.HEADLESS === "true" });
  const context = await browser.newContext({
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();

  let totalAdded = 0;
  let anyUpdate = false;
  for (const point of targets) {
    try {
      const { added, isUpdate } = await collectPoint(page, platform, point);
      totalAdded += added;
      anyUpdate = anyUpdate || isUpdate;
    } catch (error) {
      console.error(`[${point.id}] ошибка:`, error);
    }
  }

  await context.close();
  await browser.close();
  await closeDb();
  console.log(
    `\n[${platform.source}] готово.` +
      (anyUpdate ? ` Новых отзывов за запуск: ${totalAdded}` : "")
  );
}
