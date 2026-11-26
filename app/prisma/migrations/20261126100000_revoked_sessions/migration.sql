-- Server-side record of ended sign-ins, so signing out really ends the session.
CREATE TABLE "RevokedSession" (
    "sid" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RevokedSession_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX "RevokedSession_expiresAt_idx" ON "RevokedSession"("expiresAt");
