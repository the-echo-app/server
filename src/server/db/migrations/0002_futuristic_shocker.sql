CREATE TYPE "public"."post_status" AS ENUM('AWAITING_PROCESSING', 'PROCESSED', 'DELETED');--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "status" "post_status" DEFAULT 'AWAITING_PROCESSING' NOT NULL;--> statement-breakpoint
CREATE INDEX "posts_status_idx" ON "posts" USING btree ("status");