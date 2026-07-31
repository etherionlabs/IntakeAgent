-- Seguimiento proactivo: el bot reabre la conversación cuando el cliente se calla.
-- Opt-in por tenant (son mensajes no solicitados) y con tope por job.
ALTER TABLE "TenantSettings" ADD COLUMN "followUpEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Job" ADD COLUMN "followUpCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Job" ADD COLUMN "lastFollowUpAt" TIMESTAMP(3);

-- Resultado comercial ('WON' | 'LOST'), lo marca el dueño al cerrar. null = sin registrar.
ALTER TABLE "Job" ADD COLUMN "outcome" TEXT;

-- El barrido de seguimiento filtra por estado + archivado dentro de un tenant.
CREATE INDEX "Job_tenantId_status_archivedAt_idx" ON "Job"("tenantId", "status", "archivedAt");
