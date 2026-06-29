-- Fase 4: onboarding self-service (aditivo). status/onboarding en Tenant +
-- EmailVerification. Compatible con datos existentes.
ALTER TABLE "Tenant" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending_verification';
ALTER TABLE "Tenant" ADD COLUMN "onboarding" JSONB;

CREATE TABLE "EmailVerification" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailVerification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmailVerification_token_key" ON "EmailVerification"("token");
CREATE INDEX "EmailVerification_tenantId_idx" ON "EmailVerification"("tenantId");
ALTER TABLE "EmailVerification" ADD CONSTRAINT "EmailVerification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Los tenants existentes (piloto) ya operan: marcarlos 'active' para no bloquearlos.
UPDATE "Tenant" SET "status" = 'active';
