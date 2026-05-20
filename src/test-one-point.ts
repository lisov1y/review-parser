import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { launch } from "cloakbrowser";

type Point = {
  id: string;
  name: string;
  url: string;
};

type Review = {
  authorName: string | null;
  rating: string | null;
  date: string | null;
  text: string | null;
};

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  await mkdir("data/output", { recursive: true });
  await mkdir("screenshots", { recursive: true });

  const pointRaw = await readFile("data/input/one-point.json", "utf-8");
  const point = JSON.parse(pointRaw) as Point;

  const browser = await launch({
    headless: process.env.HEADLESS === "true",
  });

  const context = await browser.newContext({
    locale: "ru-RU",
    timezoneId: "Europe/Moscow",
    viewport: {
      width: 1366,
      height: 768,
    },
  });

  const page = await context.newPage();

  console.log(`Открываю: ${point.name}`);
  await page.goto(point.url, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  await sleep(5000);

  console.log("Ищу кнопку отзывов...");

  const reviewsTriggers = [
    "text=Отзывы",
    'button:has-text("Отзывы")',
    '[role="tab"]:has-text("Отзывы")',
    'a:has-text("Отзывы")',
  ];

  let openedReviews = false;

  for (const selector of reviewsTriggers) {
    const element = page.locator(selector).first();

    if (await element.count()) {
      try {
        await element.click({ timeout: 5000 });
        openedReviews = true;
        console.log(`Нажал на кнопку по селектору: ${selector}`);
        break;
      } catch {
        console.log(`Нашёл, но не смог нажать: ${selector}`);
      }
    }
  }

  if (!openedReviews) {
    console.log(
      "Не смог открыть вкладку отзывов, но всё равно попробую искать отзывы на видимой странице."
    );
  }

  await sleep(5000);

  console.log("Пробую отсортировать отзывы по новизне...");

  const sortButton = page
    .locator('.rating-ranking-view[role="button"][aria-haspopup="true"]')
    .first();

  if ((await sortButton.getAttribute("aria-expanded")) !== "true") {
    await sortButton.click();
  }

  const newestOption = page
    .locator(
      '.rating-ranking-view__popup-line[role="button"][aria-label="По новизне"]'
    )
    .first();

  await newestOption.click();

  console.log("Получилось отсортировать по новизне!");

  await sleep(3000);

  for (let i = 0; i < 5; i += 1) {
    await page.mouse.wheel(0, 1000);
    await sleep(1500);
  }

  console.log("Собираю отзывы...");

  const reviews = (await page.evaluate(() => {
    const textOf = (element: Element | null) =>
      element?.textContent?.replace(/\s+/g, " ").trim() || null;

    const candidates = Array.from(
      document.querySelectorAll(
        [
          '[class*="review"]',
          '[class*="Reviews"]',
          '[class*="business-review"]',
          '[class*="card"]',
        ].join(",")
      )
    );

    const items = candidates
      .map((element) => {
        const text = textOf(element);

        if (!text) {
          return null;
        }

        const looksLikeReview =
          text.includes("звезд") ||
          text.includes("Знаток") ||
          text.includes("Отзыв") ||
          text.length > 80;

        if (!looksLikeReview) {
          return null;
        }

        return {
          authorName: null,
          rating: null,
          date: null,
          text,
        };
      })
      .filter(Boolean)
      .slice(0, 10);

    return items;
  })) as Review[];

  const result = {
    point,
    collectedAt: new Date().toISOString(),
    reviewsCount: reviews.length,
    reviews,
  };

  await writeFile(
    `data/output/${point.id}-reviews.json`,
    JSON.stringify(result, null, 2),
    "utf-8"
  );

  console.log(`Saved ${reviews.length} review candidates`);
  console.log(`Output: data/output/${point.id}-reviews.json`);

  await context.close();
  await browser.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
