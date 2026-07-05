# Encender la visión desde el panel (v1 vendible) — Diseño

**Fecha:** 2026-07-05
**Estado:** Aprobado para implementación
**Contexto:** PR #8 (Producción v1 — Fases 1-6 + free tier con aprobación manual) ya mergeado en `master`.

---

## 1. Objetivo

Dejar la v1 lista para vender. El grueso ya está en `master` (PR #8): plan
gratuito sin pagos (`ACCESS_MODE=approval`), límite **mensual** de respuestas
(`FREE_MONTHLY_RUN_LIMIT` + override por tenant) y aprobación manual de cuentas
desde `/admin`.

**Decisión tomada (2026-07-05):** el límite se queda **mensual** — se descartó
cambiarlo a semanal; la protección contra abuso es equivalente y ya está
implementada y probada.

Lo que falta y cubre este diseño: **la visión (fotos del cliente) existe en
`master` pero está apagada y sin interruptor**. `TenantSettings.describeImages`
y `transcribeAudio` nacen en `false` y ni la API ni la SPA los exponen; ningún
tenant puede activarlos salvo por SQL.

## 2. Hallazgo: la rama de visión quedó superseded

La rama `claude/agent-image-settings-reasoning-yy9zcy` (2 commits sin mergear)
fue **reimplementada mejorada** dentro de las Fases 1-6:

| Aporte de la rama | Equivalente en `master` (mejor) |
|---|---|
| `OpenRouterImageDescriber` | `VisionDescriber` (`src/media/describer.ts`) vía `@openrouter/sdk` |
| Descripción con contexto de negocio/sesión (`describe-context.ts`) | `DescribeContext` (negocio + conversación + caption + foco del vertical) construido por el coordinator |
| Config en `config.json` (`media.describeImages`, `visionModel`) | Columnas por-tenant en `TenantSettings` + override en `src/tenant/runtime.ts` |
| — (no lo tenía) | Cache en `Message.mediaDescription` y tool `reanalyze_image` del agente |
| Toggles en la SPA (`Settings.tsx`) | **NO existe** — es el hueco que cierra este diseño |

**Decisión:** NO mergear la rama (sería un retroceso; además hoy conflictúa con
`master`). Se cierra como superseded. Este documento queda como registro para
que no vuelva la duda de "¿la mergeé o no?".

## 3. Diseño

### 3.1 API — exponer los campos de media de `TenantSettings`

Extender la ruta de settings del panel (`api/src/routes/settings.ts`) para leer
y escribir `describeImages` y `transcribeAudio` de `TenantSettings` del tenant
autenticado (mismo patrón que ya usa onboarding: `tenantSettings.update`).

- `visionModel` / `whisperModel` **no** se exponen al tenant: quedan `null` →
  el worker usa el default del operador (`config.json`). Un tenant del plan
  gratis no elige el modelo que paga el operador.
- Validación Zod de entrada (booleans), 403/401 según el guard existente.

### 3.2 SPA — sección "Imágenes y audio" en Settings

En `spa/src/pages/Settings.tsx`, dos checkboxes (recuperando la UI que la rama
había diseñado, sin el input de modelo):

- "Describir las fotos del cliente (el asistente razona sobre ellas)"
- "Transcribir las notas de voz"

Guardado con el mismo flujo/botón de la página; `spa/src/api/client.ts` gana
los campos nuevos.

### 3.3 Defaults para vender

- El provisioning de onboarding (`api/src/onboarding/templates.ts`) crea
  tenants nuevos con `describeImages=true` y `transcribeAudio=true`: "el
  asistente entiende tus fotos y notas de voz" es argumento de venta y el
  límite mensual ya acota el costo.
- Backfill del/los tenant(s) existentes (piloto) a `true` — script o migración
  de datos, junto con las demás tareas de deploy.
- El default de columna en Prisma se queda en `false` (sin migración de
  schema); el valor lo decide el provisioning.

### 3.4 Hot-reload

Verificar que el toggle desde el panel surte efecto sin reiniciar el worker
(como los overrides de config del PR #7). Si el runtime del tenant solo lee
`TenantSettings` al arrancar, añadir la recarga que falte (patrón del refresh
interno existente). Si el costo de hacerlo en caliente es alto, como mínimo
documentar que aplica al reciclar el tenant y notificarlo en la UI.

### 3.5 Limpieza

- Cerrar/borrar la rama `claude/agent-image-settings-reasoning-yy9zcy` (local y
  remota) tras mergear este trabajo.

## 4. Fuera de alcance (registrado, no olvidado)

- **Pagos**: Stripe queda dormante (se reactiva con `ACCESS_MODE=subscription`).
- **Cutover del piloto**: el auto-deploy desde `master` corrió SIN el backfill
  del runbook (`docs/runbooks/cutover-piloto-fases-1-6.md`); es probable que el
  bot del piloto esté caído ("TenantSettings ausente"). El dueño decidió
  diferirlo; sigue pendiente como tarea operativa.
- **Seguridad**: el commit local `0c80d0f` (solo en el `master` local, ya no en
  el remoto) contiene una clave SSH privada (`ssh-railway-key`) que llegó a
  estar pusheada → **rotar/revocar esa clave**. Ese commit además trae
  `e2e-scenarios.ts` y cambios de coordinator/intake que quizá valga la pena
  rescatar; decidir aparte.
- **Fase 2 — Experiencia del usuario**: recorrer en local el flujo completo
  (signup → verificación → wizard → aprobación → WhatsApp → conversación con
  fotos) y arreglar fricciones por prioridad. Se diseña al cerrar esta fase.

## 5. Testing

- API: tests de la ruta de settings para los campos nuevos (lectura, escritura,
  validación, aislamiento por tenant).
- SPA: test de `Settings.tsx` con la sección nueva.
- Worker: el override por-tenant ya está cubierto (`tests/tenant/runtime.test.ts`);
  añadir cobertura del hot-reload si se implementa.
- Suite completa verde: raíz + api (383) y SPA (51), `typecheck` en ambos.
