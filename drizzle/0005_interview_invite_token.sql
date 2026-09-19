ALTER TABLE "interview_needs" ADD COLUMN "public_token" text;--> statement-breakpoint
UPDATE "interview_needs" SET "public_token" = "id" WHERE "public_token" IS NULL;--> statement-breakpoint
ALTER TABLE "interview_needs" ALTER COLUMN "public_token" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_needs" ADD CONSTRAINT "interview_needs_public_token_unique" UNIQUE("public_token");
