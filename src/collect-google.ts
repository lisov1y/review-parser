// Сбор отзывов из Google Карт по всем точкам из points.json.
// Запуск: npm run google
//
// Google не отдаёт отзывы удобным JSON-API, поэтому читаем их из вёрстки.

import {
  run,
  sleep,
  clean,
  clickFirstVisible,
  type Review,
  type ParsedReviews,
} from "./lib.js";

// Закрывает страницу согласия Google и включает сортировку «Сначала новые».
async function prepare(page: any): Promise<boolean> {
  // Иногда появляется страница «Прежде чем перейти к Google». Кнопка
  // «Отклонить все» внизу страницы — сначала прокручиваем её в самый низ.
  await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
  await sleep(500);
  if (
    await clickFirstVisible(page, page.locator('button:has-text("Отклонить все")'))
  ) {
    await sleep(6000); // дождаться возврата на карту
  }

  // Переключаем сортировку отзывов на «Сначала новые» через выпадающее меню.
  const sortButton = page
    .locator('button[aria-haspopup="true"]')
    .filter({ hasText: /Самые релевантные|Сначала новые/ });
  if (!(await clickFirstVisible(page, sortButton))) return false;
  await sleep(1000);

  const newest = page.getByText("Сначала новые", { exact: true });
  if (!(await clickFirstVisible(page, newest))) return false;
  await sleep(2500);
  return true;
}

// Читает карточки отзывов из DOM. Классы Google обфусцированы — взяты со страницы.
async function extractReviews(page: any): Promise<ParsedReviews> {
  // Раскрываем сокращённые отзывы кнопками «Ещё», чтобы получить полный текст.
  await page.evaluate(
    `document.querySelectorAll('button[aria-label="Ещё"][aria-expanded="false"]').forEach(b => b.click())`
  );
  await sleep(800);

  const data = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("div.jftiEf"));
    const reviews = cards.map((card) => {
      const ratingLabel =
        card
          .querySelector('[role="img"][aria-label*="звезд"]')
          ?.getAttribute("aria-label") ?? "";
      return {
        id: card.getAttribute("data-review-id") ?? "",
        author:
          card.querySelector(".d4r55")?.textContent?.trim() ??
          card.getAttribute("aria-label") ??
          null,
        rating: Number(ratingLabel.replace(/\D/g, "")) || null,
        date: card.querySelector(".rsqaWe")?.textContent?.trim() ?? null,
        text: card.querySelector(".wiI7pd")?.textContent?.trim() ?? "",
      };
    });

    // Общее число отзывов — в блоке вида «Отзывов: 1 748».
    let total = 0;
    const counters = Array.from(document.querySelectorAll("div.fontBodySmall"));
    for (const el of counters) {
      const t = el.textContent ?? "";
      if (t.includes("Отзывов")) {
        total = Number(t.replace(/\D/g, "")) || 0;
        break;
      }
    }
    return { reviews, total };
  });

  const reviews: Review[] = data.reviews
    .filter((r: any) => r.id)
    .map((r: any) => ({
      id: r.id,
      authorName: r.author,
      rating: r.rating,
      date: r.date,
      text: clean(r.text),
      businessReply: null,
    }));

  return { reviews, total: Number(data.total) || 0 };
}

run({
  source: "google",
  urlField: "google",
  reviewsUrl: (url) => url, // ссылки уже открывают вкладку с отзывами
  prepare,
  mode: "dom",
  extractReviews,
}).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
