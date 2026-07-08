# Generalizar Intake a múltiples giros + rename Railway — Diseño

**Fecha:** 2026-07-06
**Estado:** Aprobado para implementación
**Base:** `master` @ 0d849d1.

---

## 1. Objetivo

Dejar de presentar Intake como producto de tapicería y volverlo un SaaS de recepcionista
de WhatsApp para **cualquier negocio de servicios**. Tres frentes:

1. **Plantillas de más giros** (family oficios/reparación) + fuente única de la lista de giros.
2. **Copys** de la SPA/landing sin supuestos de tapicería.
3. **Rename** de los servicios de Railway para que las URLs no digan "tapiceria".

Giros nuevos: **mecánica, cerrajería, plomería, electricista, refrigeración/climas**.

## 2. Fase 1 — Catálogo de giros + plantillas (backend)

### 2.1 Catálogo único (fuente de verdad)
- Nuevo módulo `api/src/onboarding/industries.ts` que exporta un catálogo canónico:
  ```ts
  export interface IndustryDef { value: string; label: string; domain: string; profileDir: string; }
  export const INDUSTRY_CATALOG: IndustryDef[] = [ … ];
  ```
  Una entrada por giro: `generico`, `tapiceria`, `paqueteria`, `mecanica`, `cerrajeria`,
  `plomeria`, `electricista`, `refrigeracion`. `profileDir = ./profiles/<value>`.
- `api/src/onboarding/templates.ts` deriva de este catálogo: `Industry` = union de los
  `value`; `INDUSTRY_DOMAIN` y `INDUSTRIES` se construyen del catálogo (se elimina la
  duplicación literal). `seedTenantSettingsFromTemplate` sigue igual (carga `./profiles/<industry>`).

### 2.2 Endpoint público
- `GET /onboarding/industries` (sin auth) → `{ industries: { value, label }[] }` desde el catálogo.
  Registrado en las rutas de onboarding. Permite que la SPA no hardcodee la lista.

### 2.3 Plantillas nuevas
- Crear `profiles/<giro>/` para los 5 giros nuevos, cada uno con los 4 archivos:
  `intake-schema.json` (sections/fields a la medida del giro), `welcome.txt`,
  `business-facts.json`, `prompt-vars.json` (con `tone`, `coreInstructions`, `hardRules`,
  `imageFocus` propios). Estructura idéntica a `profiles/tapiceria/` (misma forma validada
  por `BusinessFactsZ`, `ConfigZ`, meta-schema del intake).
- Cada `intake-schema` tiene secciones `client` + `work` (+ specs/logistics según el giro),
  con `$businessName`/`$businessDomain`/`$language` acordes.

### 2.4 Default genérico
- `config.json`: `"profile": "./profiles/generico"` (antes tapiceria).
- `spa/src/pages/PlatformDashboard.tsx`: default `profileDir` del form → `./profiles/generico`.
- Signup default industry → `generico` (ver Fase 2).

### 2.5 Testing
- `api/tests/industries.test.ts` (nuevo): el catálogo cubre todos los `profiles/` existentes
  y `GET /onboarding/industries` los devuelve.
- `api/tests/provision.test.ts` / `templates`: provisioning de un giro nuevo (p.ej. `mecanica`)
  siembra `TenantSettings` correctamente (carga `profiles/mecanica`).
- Un test que valida que **cada** `profileDir` del catálogo existe en disco y carga con
  `loadProfile` sin lanzar (garantiza que no falte ningún archivo de plantilla).

## 3. Fase 2 — Copys SPA/landing

- `spa/src/pages/Signup.tsx`: la lista `INDUSTRIES` hardcodeada se reemplaza por fetch a
  `GET /onboarding/industries` (con fallback mínimo si falla). Default seleccionado: `generico`.
  Añadir el método `getIndustries` al cliente (`spa/src/api/client.ts`).
- `spa/src/pages/Landing.tsx` + textos de onboarding: sustituir menciones/ejemplos de
  tapicería por lenguaje genérico ("tu negocio") con ejemplos de varios giros.
- `docs/gtm/landing-copy.md`: alinear la copia con el mensaje general (referencia, no bloquea deploy).
- Los tests SPA que fijan `industry: 'tapiceria'` como default (`Signup.test.tsx`) se
  actualizan al nuevo default `generico` y al dropdown alimentado por API (mock del fetch).

## 4. Fase 3 — Rename de servicios Railway (ops guiado)

Proyecto Railway `intake`/`production`. Renombrar:
- `api-tapiceria` → **`intake-api`**
- `worker-tapiceria` → **`intake-worker`**

**Implicaciones y pasos (con downtime breve):**
1. Rename en el dashboard de Railway (Service → Settings → Name). Railway regenera el
   dominio público del api (`intake-api-production.up.railway.app` u otro).
2. Actualizar **Netlify** `VITE_API_URL` → nueva URL pública del api; redeploy de la SPA.
3. Actualizar en el servicio api las envs que apuntan al worker interno
   (`TENANT_MANAGER_URL` / `WORKER_INTERNAL_URL`) → nueva URL interna
   (`intake-worker.railway.internal:<port>`).
4. `CORS_ORIGIN` del api NO cambia (sigue siendo el dominio Netlify).
5. Smoke: `GET /health` (nueva URL), login superadmin en `/platform/login`, `wa-status` del
   tenant, un WhatsApp de prueba.
6. Rollback: revertir el nombre del servicio y `VITE_API_URL` si el smoke falla.

Se ejecuta al final (tras Fases 1-2 mergeadas y desplegadas), de forma coordinada.

## 5. Fuera de alcance
- Editor de plantillas por UI (los perfiles son archivos del repo; el dueño ajusta lo suyo
  en `TenantSettings` vía panel, como hoy).
- Migrar `Industry` a una tabla de BD (sigue siendo catálogo en código).
- Dominio propio (se evaluó; se optó por rename de servicio).
- Traducciones fuera de es-MX.

## 6. Notas de decisión
- El catálogo en código (no BD) es suficiente: los giros los define el producto, no el tenant.
- El endpoint evita el drift entre la enum del backend y el dropdown del SPA (hoy duplicados).
- El tenant demo "Tapicería Demo" se conserva (sigue usando `profiles/tapiceria`, que no se borra).
