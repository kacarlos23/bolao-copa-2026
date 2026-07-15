-- Authentication metadata is additive and deliberately excluded from Copa business hashes.
ALTER TABLE "User"
ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1;
