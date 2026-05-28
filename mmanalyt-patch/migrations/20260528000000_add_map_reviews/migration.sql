-- CreateTable
CREATE TABLE "map_reviews" (
    "id" SERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "restaurant_id" TEXT NOT NULL,
    "author_name" TEXT,
    "rating" INTEGER,
    "text" TEXT NOT NULL DEFAULT '',
    "review_date" TEXT,
    "business_reply" TEXT,
    "collected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "map_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "map_reviews_source_external_id_key" ON "map_reviews"("source", "external_id");

-- CreateIndex
CREATE INDEX "map_reviews_restaurant_id_idx" ON "map_reviews"("restaurant_id");

-- CreateIndex
CREATE INDEX "map_reviews_source_idx" ON "map_reviews"("source");

-- CreateIndex
CREATE INDEX "map_reviews_restaurant_id_source_idx" ON "map_reviews"("restaurant_id", "source");
