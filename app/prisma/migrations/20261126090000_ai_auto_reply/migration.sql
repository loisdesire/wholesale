-- Per-organization switch for automatic AI replies (default on, matching existing Telegram behaviour).
ALTER TABLE "Organization" ADD COLUMN "aiAutoReply" BOOLEAN NOT NULL DEFAULT true;
