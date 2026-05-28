// Запись отзывов в Postgres MMANALYT в таблицу map_reviews.
// Если DATABASE_URL не задан — модуль молча отключается (локальный режим).

import { Pool } from "pg";
import type { Point, Review } from "./lib.js";

const url = process.env.DATABASE_URL;
const pool = url ? new Pool({ connectionString: url }) : null;

export function isDbEnabled(): boolean {
  return pool !== null;
}

// Заливает порцию отзывов с upsert: если такой (source, external_id) уже есть —
// обновляются текст/оценка/ответ заведения, дата первого сбора сохраняется.
export async function upsertReviews(
  source: string,
  point: Point,
  reviews: Review[]
): Promise<void> {
  if (!pool || reviews.length === 0) return;

  const BATCH = 500;
  const client = await pool.connect();
  try {
    for (let i = 0; i < reviews.length; i += BATCH) {
      const slice = reviews.slice(i, i + BATCH);
      const placeholders: string[] = [];
      const values: unknown[] = [];

      slice.forEach((r, idx) => {
        const base = idx * 8;
        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`
        );
        values.push(
          source,
          r.id,
          String(point.restaurantId),
          r.authorName,
          r.rating,
          r.text,
          r.date,
          r.businessReply
        );
      });

      await client.query(
        `INSERT INTO map_reviews
          (source, external_id, restaurant_id, author_name, rating, text, review_date, business_reply)
        VALUES ${placeholders.join(", ")}
        ON CONFLICT (source, external_id) DO UPDATE SET
          author_name = EXCLUDED.author_name,
          rating = EXCLUDED.rating,
          text = EXCLUDED.text,
          review_date = EXCLUDED.review_date,
          business_reply = EXCLUDED.business_reply`,
        values
      );
    }
  } finally {
    client.release();
  }
}

export async function closeDb(): Promise<void> {
  if (pool) await pool.end();
}
