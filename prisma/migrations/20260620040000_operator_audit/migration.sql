-- Fase 5: auditoría de acciones del operador de plataforma.
CREATE TABLE "OperatorAuditLog" (
    "id" TEXT NOT NULL,
    "operatorUserId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperatorAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OperatorAuditLog_tenantId_idx" ON "OperatorAuditLog"("tenantId");
