-- Soft delete: columna archivedAt (nullable) en Contact y Job
ALTER TABLE "Contact" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Job" ADD COLUMN "archivedAt" TIMESTAMP(3);
