-- DropForeignKey
ALTER TABLE "AgentRun" DROP CONSTRAINT "AgentRun_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Contact" DROP CONSTRAINT "Contact_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_tenantId_fkey";

-- DropIndex
DROP INDEX "Contact_phoneE164_key";

-- DropIndex
DROP INDEX "Message_whatsappMsgId_key";

-- AlterTable
ALTER TABLE "AgentRun" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Contact" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Job" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Message" ALTER COLUMN "tenantId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Notification" ALTER COLUMN "tenantId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Contact_tenantId_phoneE164_key" ON "Contact"("tenantId", "phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "Message_tenantId_whatsappMsgId_key" ON "Message"("tenantId", "whatsappMsgId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
