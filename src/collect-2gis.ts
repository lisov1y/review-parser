// Сбор отзывов из 2ГИС по всем точкам из points.json.
// Запуск: npm run 2gis
//
// 2ГИС не отдаёт отзывы отдельным JSON-API, поэтому читаем их прямо из вёрстки.

import { createHash } from "node:crypto";
import {
  run,
  sleep,
  clean,
  clickFirstVisible,
  type Review,
  type ParsedReviews,
} from "./lib.js";

// У карточки 2ГИС нет своего id — синтезируем его из автора и текста.
function makeId(author: string | null, text: string): string {
  return createHash("sha256")
    .update(`${author ?? ""}|${text}`)
    .digest("hex")
    .slice(0, 16);
}

// Приводит любую ссылку 2ГИС к странице отзывов филиала.
function reviewsUrl(url: string): string {
  const city = url.match(/2gis\.ru\/([^/]+)\//)?.[1] ?? "moscow";
  const firmId = url.match(/\/firm\/(\d+)/)?.[1] ?? "";
  return `https://2gis.ru/${city}/firm/${firmId}/tab/reviews`;
}

// Закрывает поп-ап про новую сортировку и открывает вкладку «Отзывы».
async function prepare(page: any): Promise<boolean> {
  await clickFirstVisible(page, page.locator('button:has-text("Хорошо")'));
  await sleep(500);
  await clickFirstVisible(page, page.getByText("Отзывы", { exact: true }));
  await sleep(3000);
  await clickFirstVisible(page, page.locator('button:has-text("Хорошо")'));
  return false; // сортировку по новизне не трогаем — собираем полным проходом
}

// Читает карточки отзывов из DOM. Классы у 2ГИС обфусцированы — взяты со страницы.
async function extractReviews(page: any): Promise<ParsedReviews> {
  const data = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("._1rowqpjv"));
    const reviews = cards.map((card) => ({
      author: card.querySelector("._19h0cqe")?.textContent?.trim() ?? null,
      date: card.querySelector("._10c0hgu")?.textContent?.trim() ?? null,
      text: card.querySelector("._83kmcy")?.textContent?.trim() ?? "",
      // закрашенные звёзды — это svg с золотым цветом
      rating: card.querySelectorAll('svg[color="#ffb81c"]').length || null,
    }));
    const totalText = document.querySelector("._1y88ofn")?.textContent ?? "";
    return { reviews, total: Number(totalText.replace(/\D/g, "")) || 0 };
  });

  const reviews: Review[] = data.reviews
    .filter((r: any) => r.text)
    .map((r: any) => ({
      id: makeId(r.author, r.text),
      authorName: r.author,
      rating: r.rating,
      date: r.date,
      text: clean(r.text),
      businessReply: null,
    }));

  return { reviews, total: data.total };
}

run({
  source: "2gis",
  urlField: "2gis",
  reviewsUrl,
  prepare,
  mode: "dom",
  extractReviews,
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
