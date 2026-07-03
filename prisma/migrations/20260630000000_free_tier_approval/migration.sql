-- v1 free: aprobación manual de cuentas + límite mensual del plan gratuito.
-- Aditiva salvo el backfill: los tenants EXISTENTES quedan 'approved' (el piloto
-- y cualquier cuenta previa no deben re-aprobarse); los nuevos nacen 'pending'.

ALTER TABLE "Tenant" ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "Tenant" ADD COLUMN "approvedAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN "monthlyRunLimit" INTEGER;

-- Backfill: todo tenant creado antes de esta migración queda aprobado.
UPDATE "Tenant" SET "approvalStatus" = 'approved', "approvedAt" = NOW();

-- Conteo del uso mensual (respuestas del bot por tenant/mes).
CREATE INDEX "AgentRun_tenantId_createdAt_idx" ON "AgentRun"("tenantId", "createdAt");
