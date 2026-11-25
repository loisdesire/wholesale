-- Customer-facing order status page token + per-organization "message customer on ship" switch.
ALTER TABLE "Order" ADD COLUMN "publicToken" TEXT;
CREATE UNIQUE INDEX "Order_publicToken_key" ON "Order"("publicToken");
ALTER TABLE "Organization" ADD COLUMN "notifyCustomerOnShip" BOOLEAN NOT NULL DEFAULT true;
