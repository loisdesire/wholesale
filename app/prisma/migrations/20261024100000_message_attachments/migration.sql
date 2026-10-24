-- Inbound WhatsApp images (customer photos, payment screenshots, …), downloaded from Meta's
-- Media API at ingestion time since the media URLs Meta returns are short-lived. A child of
-- Message the same way Message is a child of Conversation — no organizationId of its own.
CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");

ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Same child-table RLS pattern as Message itself (see docs/ISOLATION.md "Adding a table"):
-- visible only if the parent Message is, whose own policy in turn depends on its Conversation.
ALTER TABLE "MessageAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageAttachment" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MessageAttachment"
  USING (EXISTS (SELECT 1 FROM "Message" p WHERE p."id" = "MessageAttachment"."messageId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Message" p WHERE p."id" = "MessageAttachment"."messageId"));
