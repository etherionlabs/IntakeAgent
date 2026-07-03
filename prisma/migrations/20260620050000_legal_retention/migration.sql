-- Fase 6: retención de mensajes por tenant + rastro de aceptación legal.
ALTER TABLE "TenantSettings" ADD COLUMN "messageRetentionMonths" INTEGER NOT NULL DEFAULT 12;

CREATE TABLE "LegalAcceptance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "document" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LegalAcceptance_tenantId_idx" ON "LegalAcceptance"("tenantId");
