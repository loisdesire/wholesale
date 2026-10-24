-- WhatsApp delivery-status tracking for outbound messages (sent/delivered/read/failed),
-- previously received by the webhook and silently ignored. Message is a child table
-- (protected via its parent Conversation's RLS policy already) — no RLS change needed.
CREATE TYPE "MessageDeliveryStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');

ALTER TABLE "Message" ADD COLUMN "deliveryStatus" "MessageDeliveryStatus",
ADD COLUMN "deliveryStatusAt" TIMESTAMP(3),
ADD COLUMN "deliveryError" TEXT;
