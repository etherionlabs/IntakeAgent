-- Add column to store the vision-model description of image messages.
ALTER TABLE "Message" ADD COLUMN "mediaDescription" TEXT;
