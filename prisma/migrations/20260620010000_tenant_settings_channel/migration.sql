-- A1: TenantSettings (config del bot por tenant) + Tenant.active
ALTER TABLE "Tenant" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "TenantSettings" (
    "tenantId" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "businessDomain" TEXT NOT NULL,
    "ownerPhoneE164" TEXT NOT NULL,
    "welcomeTemplate" TEXT NOT NULL,
    "intakeSchema" JSONB NOT NULL,
    "debounceMs" INTEGER NOT NULL DEFAULT 8000,
    "transcribeAudio" BOOLEAN NOT NULL DEFAULT false,
    "describeImages" BOOLEAN NOT NULL DEFAULT false,
    "whisperModel" TEXT,
    "visionModel" TEXT,
    "panelUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TenantSettings_pkey" PRIMARY KEY ("tenantId")
);
ALTER TABLE "TenantSettings" ADD CONSTRAINT "TenantSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A2: columna channel en Contact y Message (default clasifica filas existentes)
ALTER TABLE "Contact" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'whatsapp';
ALTER TABLE "Message" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'whatsapp';

-- A3: RENAME (no drop+add) para preservar los IDs y la idempotencia.
ALTER TABLE "Message" RENAME COLUMN "whatsappMsgId" TO "externalMsgId";
ALTER INDEX "Message_tenantId_whatsappMsgId_key" RENAME TO "Message_tenantId_externalMsgId_key";
