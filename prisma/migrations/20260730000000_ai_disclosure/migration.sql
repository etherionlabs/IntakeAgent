-- Divulgación de IA. Por defecto ACTIVA: el AI Act (art. 50, aplicable el 2026-08-02)
-- exige informar a la persona cuando interactúa con un sistema de IA, y la FTC ha
-- actuado contra la suplantación. El default compliant es el correcto: no informar
-- es un riesgo legal, informar solo cuesta una línea en el saludo.
ALTER TABLE "TenantSettings" ADD COLUMN "aiDisclosure" BOOLEAN NOT NULL DEFAULT true;
