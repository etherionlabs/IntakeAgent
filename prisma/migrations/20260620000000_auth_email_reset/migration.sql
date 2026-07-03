-- PanelUser: email único global (nullable; Postgres permite múltiples NULL) +
-- passwordChangedAt para invalidación de sesiones tras cambio de contraseña.
ALTER TABLE "PanelUser" ADD COLUMN "email" TEXT;
ALTER TABLE "PanelUser" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "PanelUser_email_key" ON "PanelUser"("email");

-- Tokens de recuperación de contraseña: se guarda el HASH del token (un solo uso).
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "PanelUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
