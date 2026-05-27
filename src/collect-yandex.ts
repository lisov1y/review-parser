// Сбор отзывов из Яндекс.Карт по всем точкам из points.json.
// Запуск: npm run yandex

import { run, sleep, clean, clickFirstVisible, type Review } from "./lib.js";

// Яндекс отдаёт отзывы запросом fetchReviews — обычный JSON.
function parseResponse(body: string): { reviews: Review[]; total: number } {
  const data = JSON.parse(body)?.data ?? {};
  const list: any[] = Array.isArray(data.reviews) ? data.reviews : [];

  const reviews: Review[] = list.map((r) => ({
    id: String(r.reviewId ?? ""),
    authorName: clean(r.author?.name) || null,
    rating: typeof r.rating === "number" ? r.rating : null,
    date: r.updatedTime ?? null,
    text: clean(r.text),
    businessReply: r.businessComment?.text ? clean(r.businessComment.text) : null,
  }));

  return { reviews, total: Number(data.params?.count ?? 0) };
}

// Включает сортировку «по новизне».
async function sortByNewest(page: any): Promise<boolean> {
  const sortButton = page.locator(
    '.rating-ranking-view[role="button"][aria-haspopup="true"]'
  );
  if (!(await clickFirstVisible(page, sortButton))) return false;
  await sleep(800);

  const newest = page
    .locator('[role="button"]')
    .filter({ hasText: /^По новизне$/ });
  if (!(await clickFirstVisible(page, newest))) return false;
  await sleep(2500);
  return true;
}

run({
  source: "yandex",
  urlField: "yandex",
  reviewsUrl: (url) => url.replace(/\/?$/, "/") + "reviews/",
  prepare: sortByNewest,
  mode: "api",
  isReviewsResponse: (url) => url.includes("fetchReviews"),
  parseResponse,
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
