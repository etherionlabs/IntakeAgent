# Pendientes para vender — lista priorizada + opinión

**Fecha:** 2026-07-12 · **Rama:** `claude/sales-readiness-9gv7eo`
**Propósito:** handoff completo a otro agente/dev. Reúne TODO lo que falta para
pasar de "Fases 1–6 construidas y probadas en sandbox" a "listo para meter
clientes reales", con **mi priorización y el razonamiento detrás de cada
decisión** (tengo el contexto completo del proyecto).

> **Contexto de alcance (v1 de mercado, decisiones #11/#12):** la v1 sale
> **sin pagos** — plan gratuito con límite mensual (`FREE_MONTHLY_RUN_LIMIT`) +
> **aprobación manual** de cuentas (`ACCESS_MODE=approval`). Solo WhatsApp vía
> Baileys. Stripe, API oficial de Meta y SMS/voz quedan diferidos e intactos.
> Esto **cambia la prioridad**: nada de billing bloquea la primera venta.

---

## Lo primero que hay que entender (mi lectura del proyecto)

El **código está esencialmente completo** para la v1. El riesgo NO está en el
código, está en tres cosas que ningún sandbox puede cerrar:

1. **Baileys es el make-or-break.** Es WhatsApp no oficial: sesión con estado,
   riesgo de baneo, un socket por proceso. Nunca corrió con 2 bots reales
   simultáneos. Si esto no aguanta, no hay producto que vender. **Es el riesgo #1.**
2. **Email real no está activado** → el signup real (verificación + recuperación)
   simplemente no funciona hoy. Es un bloqueante *funcional*, no de calidad.
3. **Recolectas WhatsApp de terceros** (los clientes finales del negocio) sin
   política de privacidad válida. Es un riesgo *legal* real, no cosmético.

Todo lo demás es operabilidad y pulido: importa, pero no es lo que te hunde.

---

## Tabla resumen (prioridad)

| # | Pendiente | Tier | Bloquea | Esfuerzo |
|---|-----------|------|---------|----------|
| A1 | Email real (Resend) + dominio SPF/DKIM | 🔴 T0 | 1er cliente | Bajo |
| A2 | Baileys: 2 bots reales, aislados, 24–48h | 🔴 T0 | 1er cliente | Medio |
| A3 | Revisión legal ToS/privacidad + jurisdicción | 🔴 T0 | 1er cliente | Externo |
| A4 | Alertas "bot caído" + uptime monitor `/health` | 🔴 T0 | 1er cliente | Bajo |
| A5 | Backup + restore drill probado 1 vez | 🔴 T0 | 1er cliente | Bajo |
| A6 | Cutover ordenado (no mergear a master sin runbook) | 🔴 T0 | Deploy | Bajo |
| A7 | Definir `FREE_MONTHLY_RUN_LIMIT` + `ACCESS_MODE=approval` en deploy | 🔴 T0 | 1er cliente | Trivial |
| B1 | CI secrets + branch protection + reviewers prod | 🟡 T1 | Escalar | Bajo |
| B2 | Sentry DSN real (api/worker/spa) | 🟡 T1 | Operar | Trivial |
| B3 | Landing desplegada (Netlify) + rutas legales públicas | 🟡 T1 | Vender abierto | Bajo |
| B4 | Validar márgenes OpenRouter por tenant | 🟡 T1 | Cobrar/escalar | Medio |
| B5 | Canal + SLA de soporte definido | 🟡 T1 | Vender | Bajo |
| B6 | Follow-up código: `settings.ts` → `TenantSettings` | 🟡 T1 | Deuda | Medio |
| B7 | Centralización de logs | 🟡 T1 | Operar | Bajo |
| C1 | Stripe real (billing) | 🟢 T2 | 2ª iteración | Medio |
| C2 | Export como ZIP + URL firmada (hoy bundle JSON) | 🟢 T2 | Mejora | Bajo |
| C3 | API oficial WhatsApp (Meta) — evaluación | 🟢 T2 | Escala | Alto |
| D1 | SMS (Fase 8A, Twilio) | ⚪ T3 | v2 | Medio |
| D2 | Voz en vivo (Fase 8B) | ⚪ T3 | v2 | Muy alto |

---

## 🔴 Tier 0 — BLOQUEANTE antes del primer cliente real (beta cerrada)

> Sin esto no metes a nadie, ni siquiera a un beta hand-picked. Son pocos y
> baratos salvo el legal. **Este es el trabajo que de verdad importa ahora.**

### A1 · Email real (Resend) + dominio
- **Qué falta:** `EMAIL_PROVIDER=resend`, `EMAIL_API_KEY`, `EMAIL_FROM`; dominio
  verificado con **SPF/DKIM/DMARC**.
- **Dónde:** `api/src/lib/email.ts` (`ResendEmailSender` ya implementado).
- **Cómo verificar:** signup real → llega correo de verificación → recuperar
  contraseña → llega token. En este entorno la red a `api.resend.com` está
  **bloqueada por el proxy (403)**, así que esto solo se cierra fuera del sandbox.
- **Mi opinión:** 🔴 **El bloqueante más barato y más crítico.** Sin email, el
  flujo self-service se rompe en el paso 2. Es media hora de trabajo con la key
  real. Ponlo primero.

### A2 · Baileys — 2 bots reales simultáneos, aislados
- **Qué falta:** levantar 2 tenants (p. ej. tapicería + otro giro) con **números
  WhatsApp reales**, sesiones aisladas en `./data/baileys-session/<tenantId>`,
  y dejarlos correr 24–48h con mensajes cruzados para ver estabilidad y que no
  se filtren conversaciones entre tenants.
- **Dónde:** `TenantManager` (`src/tenant/`), reconexión con backoff (Fase 1).
- **Cómo verificar:** dos conversaciones reales en paralelo, matar/reconectar un
  socket, confirmar que el otro no se cae y que la reconexión funciona sola.
  Necesita **Docker + números reales** → imposible aquí (sin daemon Docker).
- **Mi opinión:** 🔴 **El riesgo #1 del producto entero.** Todo lo demás asume
  que Baileys aguanta. Si vas a invertir esfuerzo serio en un solo punto antes
  de vender, que sea este. Un baneo de WhatsApp en un cliente real es
  reputacionalmente caro.

### A3 · Legal — jurisdicción + revisión de ToS/privacidad
- **Qué falta:** definir jurisdicción (rellenar placeholders `[Jurisdicción]`),
  ventana de retención (propuesta: 12 meses / 30 días de gracia), y **revisión
  por abogado** de los borradores.
- **Dónde:** `docs/legal/` (ToS, privacidad, DPA, disclaimer WhatsApp/Baileys),
  marcados `[LEGAL-EXT]`. Aceptación ya registrada en signup (`LegalAcceptance`).
- **Mi opinión:** 🔴 No es opcional porque procesas datos de **terceros** (los
  clientes finales del negocio) vía un canal no oficial. El código ya lo soporta;
  falta la decisión de negocio + una revisión legal. Puedo dejar los textos
  listos para el abogado en cuanto me digas el país.

### A4 · Alertas "bot caído" + uptime monitor
- **Qué falta:** cablear el sink de `src/lib/alerts.ts` a un canal real
  (email/Telegram) y un **uptime monitor externo** (UptimeRobot/Better Stack)
  sobre `/health`.
- **Mi opinión:** 🔴 Con un cliente real, si su bot se cae necesitas enterarte
  **tú antes que él**. Es barato y es la diferencia entre "SaaS" y "script con
  suerte". No necesitas Sentry completo todavía (eso es T1), pero sí esta alerta.

### A5 · Backup + restore drill probado
- **Qué falta:** `pg_dump` diario con retención **y ejecutar un restore real una
  vez** en staging (no solo configurarlo).
- **Dónde:** `docs/runbooks/2026-06-18-backup-restore-drill.md`.
- **Mi opinión:** 🔴 "Tengo backups" ≠ "puedo recuperarme". Un restore probado
  una sola vez te salva de perder los datos del primer cliente. Barato.

### A6 · Cutover ordenado (higiene de deploy)
- **Qué falta:** **no mergear a `master`** sin correr el cutover — el deploy no
  corre el backfill de `TenantSettings` y rompería el piloto.
- **Dónde:** `docs/runbooks/cutover-piloto-fases-1-6.md`.
- **Mi opinión:** 🔴 Es una trampa ya documentada. Respétala o rompes producción
  en el primer deploy.

### A7 · Parámetros de acceso v1
- **Qué falta:** setear `ACCESS_MODE=approval` y `FREE_MONTHLY_RUN_LIMIT`
  (propuesta: **300** respuestas/mes) en el `.env` del deploy.
- **Mi opinión:** 🔴 Trivial pero olvidable. Sin `ACCESS_MODE=approval` las
  cuentas operarían sin tu aprobación. El límite acota el costo de abuso.

---

## 🟡 Tier 1 — Antes de vender en serio / justo después de la 1ª venta

> Importa para operar y para abrir el grifo, pero puedes tener 1–3 clientes de
> beta sin esto usando deploy manual y acompañamiento cercano.

- **B1 · CI/CD real:** secretos de GitHub (`GHCR_TOKEN`, `*_SSH_KEY`, hosts,
  `DOMAIN`), branch protection en `master` (`test-root`, `test-spa`,
  `docker-build`) y Environment `production` con reviewers. Workflows ya existen
  en `.github/workflows/`. *Opinión:* al principio puedes deployar a mano; esto
  es para no depender de heroísmo cuando haya >1 cliente.
- **B2 · Sentry DSN real** en api/worker/spa (hoy no-op sin DSN). *Opinión:* muy
  útil pero A4 (alerta de bot caído) es lo crítico; esto es el siguiente escalón.
- **B3 · Landing desplegada** (Netlify, `/landing` + rutas legales públicas;
  `netlify.toml` ya existe). *Opinión:* para **beta cerrada hand-picked no la
  necesitas**; para venta abierta, sí. Por eso es T1, no T0.
- **B4 · Validar márgenes:** costo real de OpenRouter por tenant vs. el plan.
  *Opinión:* en v1 es gratis, así que no bloquea la 1ª venta, **pero necesitas
  saber tu costo unitario antes de escalar o poner precio.** No lo dejes a ciegas.
- **B5 · Soporte:** definir canal (email/WhatsApp) y SLA. *Opinión:* con clientes
  reales, "¿a quién le escribo cuando falla?" es parte del producto.
- **B6 · Follow-up de código `settings.ts` → `TenantSettings`:** hoy la edición
  del panel aún escribe a `config.json`/`profileDir`; migrarla a la tabla
  `TenantSettings` (que el worker ya consume). `business-facts`/`promptVars` aún
  no están modelados ahí. *Opinión:* **única deuda de código real** de las Fases
  1–6. No bloquea vender, pero es la que yo cerraría aquí mismo porque es puro
  código y no necesita infra. (Ver "Qué puedo hacer yo aquí".)
- **B7 · Centralización de logs** (driver Docker → Loki/Better Stack). *Opinión:*
  calidad de vida operativa; puede esperar a tener volumen.

---

## 🟢 Tier 2 — Puede esperar a después de la primera venta

- **C1 · Stripe real (billing):** `Plan/Subscription/StripeEvent`, Checkout,
  Portal, webhooks firmados — **ya construido y probado offline**, dormante.
  Se reactiva con `ACCESS_MODE=subscription`. *Opinión:* la decisión de negocio
  fue explícita: v1 sin pagos. No toques esto hasta validar que el producto
  retiene usuarios gratis. Requiere además precio/moneda/impuestos (decisiones
  #4/#5, diferidas).
- **C2 · Export como ZIP + URL firmada** (hoy es bundle JSON, que ya cumple el
  derecho de acceso/borrado). *Opinión:* mejora, no requisito legal.
- **C3 · Evaluar API oficial de WhatsApp (Meta):** el verdadero desbloqueo para
  escalar sin el riesgo de Baileys. *Opinión:* estratégico, no urgente. Empieza a
  evaluarlo cuando Baileys te empiece a doler (baneos, límite de sockets).

---

## ⚪ Tier 3 — Post-lanzamiento / v2

- **D1 · SMS (Fase 8A, Twilio)** — ~2 semanas; la capa de canal ya está lista
  (`src/channels/`, `channel` en `Message`/`Contact`).
- **D2 · Voz conversacional en vivo (Fase 8B)** — 6–10+ semanas, servicio nuevo
  `voice-gateway`. La pieza más ambiciosa; posible add-on de precio.
- *Opinión:* son líneas de producto nuevas, no requisitos de lanzamiento. La capa
  de canal se dejó lista barato justamente para no rehacer nada cuando llegue.

---

## Mi recomendación de secuencia (si fuera yo)

1. **Cierra el código aquí** (lo único que este sandbox permite): correr la suite
   completa para confirmar el verde tras los commits de giros/SPA, y cerrar **B6**
   (`settings.ts` → `TenantSettings`). Deja un dev-real sin deuda de código.
2. **En una máquina real, en este orden:** A1 (email) → A5 (backup) → A4 (alertas)
   → A2 (2 bots Baileys, el hito de verdad) → A6/A7 (deploy limpio).
3. **En paralelo, decisión de negocio:** A3 (jurisdicción + abogado), B4 (medir
   costo OpenRouter con los datos de la prueba de 2 bots).
4. **Beta cerrada** con 1–2 clientes acompañados (Fase 7). No abras venta pública
   (B3 landing) hasta que Baileys demuestre estabilidad con clientes reales.
5. Solo entonces: T1 restante → venta abierta. T2/T3 después.

**Regla de oro:** no confundas "el código está listo" con "estamos listos para
vender". El código sí; la operación real (Baileys + email + legal + alertas) es
lo que falta, y es exactamente lo que un sandbox no puede validar.

---

## Qué puedo hacer YO en este entorno (para bajarle carga al siguiente agente)

- ✅ **Correr la batería completa** (Postgres desde binarios v16 presentes) +
  typecheck → confirmar que nada se rompió tras los últimos commits.
- ✅ **Cerrar B6** (migración `settings.ts` → `TenantSettings`, modelar
  `business-facts`/`promptVars`): puro código, con tests.
- ✅ **Rellenar placeholders legales** en cuanto haya jurisdicción (deja el texto
  listo para el abogado).
- ✅ **Dejar runbooks turnkey** (prueba de 2 bots, activación de email).
- ❌ **NO puedo aquí:** email real, Stripe, WhatsApp real, Docker stack, restore
  drill real, Sentry/uptime reales → el proxy bloquea OpenRouter/Resend/Stripe y
  no hay daemon de Docker. Eso es trabajo de un entorno con infra y secretos.
