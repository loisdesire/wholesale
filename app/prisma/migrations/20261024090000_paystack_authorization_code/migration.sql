-- Stores a reusable card authorization captured from a verified Paystack webhook, the raw
-- material a tokenized recurring subscription needs (src/lib/subscriptions.ts). Organization is
-- identity data (see docs/ISOLATION.md), not tenant data — no RLS policy needed here.
ALTER TABLE "Organization" ADD COLUMN "paystackAuthorizationCode" TEXT;
