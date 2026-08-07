-- El precio de Intake cambia por mercado (US$99 EE.UU. / US$69 México / US$59
-- Colombia), así que va a haber TRES planes activos a la vez. Hasta ahora el
-- Checkout resolvía "el plan activo" con un findFirst sin orden garantizado: con
-- más de uno, cobraba uno arbitrario — probablemente el precio de otro país.
--
-- Esta migración añade lo que faltaba para elegirlo de forma determinista: el
-- mercado del tenant (a quién se le cobra) y el mercado del plan (qué se cobra).

-- Mercado del negocio. Nullable a propósito: los tenants que ya existen no lo
-- tienen y los internos (Etherion Labs) no se cobran. Sin mercado, el checkout
-- responde 409 en vez de adivinar un precio.
ALTER TABLE "Tenant" ADD COLUMN "market" TEXT;

-- Mercado del plan. NOT NULL: un plan sin mercado es justo la ambigüedad que se
-- está corrigiendo. El DEFAULT temporal existe solo para poder crear la columna
-- sobre filas ya existentes; se retira acto seguido para que toda alta nueva
-- tenga que declararlo.
ALTER TABLE "Plan" ADD COLUMN "market" TEXT NOT NULL DEFAULT 'US';
ALTER TABLE "Plan" ALTER COLUMN "market" DROP DEFAULT;

-- Los días de prueba pasan a valer, por defecto, el plazo que el asistente
-- promete en la venta (14). El default anterior era 0 y el Checkout solo manda
-- `trial_period_days` cuando es > 0: sembrar un plan sin tocar este campo
-- cobraba el día 1 a quien le habíamos prometido dos semanas.
ALTER TABLE "Plan" ALTER COLUMN "trialDays" SET DEFAULT 14;

CREATE INDEX "Plan_market_interval_active_idx" ON "Plan"("market", "interval", "active");

-- La invariante, en la base de datos y no solo en el código: como mucho UN plan
-- activo por mercado e intervalo. Los inactivos (históricos) no estorban.
-- Con esto, dos planes activos del mismo mercado son un error de alta y no un
-- cobro equivocado descubierto por el cliente.
CREATE UNIQUE INDEX "Plan_one_active_per_market_interval"
  ON "Plan"("market", "interval") WHERE "active";
