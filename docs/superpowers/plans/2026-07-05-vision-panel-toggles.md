# Encender la visión desde el panel — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer los toggles por-tenant `describeImages`/`transcribeAudio` de `TenantSettings` en la API y la SPA, con efecto en caliente en el worker, y tenants nuevos con ambos en `true`.

**Architecture:** Los toggles ya existen en `TenantSettings` y el worker ya los consume — pero solo al construir el runtime. Se mueve el gating al turno (el coordinator ya recarga config por turno vía `reloadConfig`), se añade `GET/PUT` de media a la ruta de settings del panel (escritura directa a `tenantSettings`, patrón de onboarding), y una sección nueva en `Settings.tsx`. `visionModel`/`whisperModel` NO se exponen (quedan `null` → default del operador).

**Tech Stack:** Fastify + Prisma (api/), React + Vitest (spa/), worker Node+TS (src/), vitest raíz+api unificado.

**Spec:** `docs/superpowers/specs/2026-07-05-vision-panel-toggles-design.md`

---

## Setup del entorno (una vez)

Los tests de raíz y api necesitan Postgres:

```bash
docker run -d --name intake-pg -e POSTGRES_DB=intake -e POSTGRES_USER=intake \
  -e POSTGRES_PASSWORD=intake -p 5432:5432 postgres:16
export DATABASE_URL="postgres://intake:intake@localhost:5432/intake"
export NODE_ENV=test JWT_SECRET=test-jwt-secret
npm ci && npx prisma generate && npx prisma migrate deploy
cd spa && npm ci && cd ..
```

`npm test` corre raíz + api en un solo vitest. La SPA se testea con `cd spa && npm test`.

---

### Task 1: Gating por turno del describer en el coordinator

Hoy `runBatch` usa `this.deps.describer` fijo (elegido al arrancar el tenant). El toggle del panel debe surtir efecto en el siguiente turno: gatear con la config recargada.

**Files:**
- Modify: `src/pipeline/coordinator.ts:227`
- Test: `tests/pipeline/coordinator.test.ts`

- [ ] **Step 1: Write the failing test**

En `tests/pipeline/coordinator.test.ts`, junto al test existente de imagen (busca `wa_img`), añadir:

```typescript
it('describeImages=false (recargado por turno) desactiva el describer aunque esté inyectado', async () => {
  const deps = await makeDeps({
    describer: new ScriptedDescriber(['NO debería usarse']),
    reloadConfig: async () => ({
      config: { ...config, media: { ...config.media, describeImages: false } },
      profile,
    }),
  });
  const coord = new InboundCoordinator(deps);
  await coord.handleInbound(
    rawMsg({
      externalMsgId: 'wa_img_off',
      kind: 'image',
      text: 'mi sillón',
      media: { buffer: Buffer.from('fake-jpeg'), mimetype: 'image/jpeg' },
    }),
  );
  await vi.advanceTimersByTimeAsync(100);
  await vi.runAllTimersAsync();
  await flushAsyncIO();

  const msg = await prisma.message.findFirst({ where: { externalMsgId: 'wa_img_off' } });
  expect(msg!.mediaDescription).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline/coordinator.test.ts -t 'describeImages=false'`
Expected: FAIL — `mediaDescription` contiene "NO debería usarse" (el describer inyectado corre igual).

- [ ] **Step 3: Write minimal implementation**

En `src/pipeline/coordinator.ts` línea ~227, reemplazar:

```typescript
    const describer = this.deps.describer ?? new NoopDescriber();
```

por:

```typescript
    // Gating por turno: el toggle del panel (TenantSettings.describeImages) llega
    // vía la config recargada; con el toggle apagado degradamos a Noop aunque el
    // runtime haya inyectado un describer real.
    const describer =
      config.media.describeImages ? (this.deps.describer ?? new NoopDescriber()) : new NoopDescriber();
```

(`config` ya está en scope: `const { config, profile } = await this.current();` al inicio de `runBatch`.)

- [ ] **Step 4: Run tests to verify pass (nuevo + existentes del archivo)**

Run: `npx vitest run tests/pipeline/coordinator.test.ts`
Expected: PASS todos (el test existente de imagen sigue verde porque el `config` base tiene `media.describeImages: true` por default del schema). Si ese test fallara porque el `config` del archivo trae `describeImages: false` explícito, ajustar ese `config` de test a `true` — es el default real del producto.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/coordinator.ts tests/pipeline/coordinator.test.ts
git commit -m "feat(pipeline): el toggle describeImages aplica por turno (hot-reload)"
```

---

### Task 2: Gating por turno del transcriber en handleInbound

Mismo problema con el audio: `normalizeAndPersistMessage` recibe `this.deps.transcriber` fijo.

**Files:**
- Modify: `src/pipeline/coordinator.ts:81,93-100` (función `handleInbound`)
- Test: `tests/pipeline/coordinator.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('transcribeAudio=false (recargado por turno) desactiva la transcripción', async () => {
  const deps = await makeDeps({
    transcriber: new ScriptedTranscriber(['transcripción que NO debería aplicarse']),
    reloadConfig: async () => ({
      config: { ...config, media: { ...config.media, transcribeAudio: false } },
      profile,
    }),
  });
  const coord = new InboundCoordinator(deps);
  await coord.handleInbound(
    rawMsg({
      externalMsgId: 'wa_audio_off',
      kind: 'audio',
      text: null,
      media: { buffer: Buffer.from('fake-ogg'), mimetype: 'audio/ogg' },
    }),
  );
  await vi.advanceTimersByTimeAsync(100);
  await vi.runAllTimersAsync();
  await flushAsyncIO();

  const msg = await prisma.message.findFirst({ where: { externalMsgId: 'wa_audio_off' } });
  expect(msg!.body).toBeNull();
});
```

Nota: `ScriptedTranscriber` ya está importado en el archivo (línea 8).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline/coordinator.test.ts -t 'transcribeAudio=false'`
Expected: FAIL — `body` contiene la transcripción del ScriptedTranscriber.

- [ ] **Step 3: Write minimal implementation**

En `src/pipeline/coordinator.ts`:

1. Añadir el import junto al de `NoopDescriber` (línea ~20):

```typescript
import { NoopTranscriber } from '../media/transcriber';
```

2. En `handleInbound`, línea ~81, cambiar:

```typescript
    const { profile } = await this.current();
```

por:

```typescript
    const { config, profile } = await this.current();
```

3. En la llamada a `normalizeAndPersistMessage` (línea ~93), cambiar el argumento `this.deps.transcriber` por:

```typescript
      config.media.transcribeAudio ? this.deps.transcriber : new NoopTranscriber(),
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run tests/pipeline/coordinator.test.ts`
Expected: PASS todos.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/coordinator.ts tests/pipeline/coordinator.test.ts
git commit -m "feat(pipeline): el toggle transcribeAudio aplica por turno (hot-reload)"
```

---

### Task 3: Runtime — construir describer/transcriber según apiKey, no según toggle

Si el tenant arranca con el toggle apagado, hoy el runtime inyecta `Noop*` para siempre y encenderlo desde el panel no haría nada. Con el gating por turno (Tasks 1-2), el runtime debe inyectar la instancia real siempre que haya API key; el toggle decide por turno.

**Files:**
- Modify: `src/tenant/runtime.ts:163-166`
- Test: existentes (`tests/tenant/runtime.test.ts` no asume toggles en la construcción — verificar que sigue verde)

- [ ] **Step 1: Write implementation**

En `src/tenant/runtime.ts`, reemplazar líneas 163-166:

```typescript
  const transcriber: Transcriber = config.media.transcribeAudio && apiKey
    ? new WhisperTranscriber(apiKey, config.media.whisperModel) : new NoopTranscriber();
  const describer: Describer = config.media.describeImages && apiKey
    ? new VisionDescriber(apiKey, config.media.visionModel) : new NoopDescriber();
```

por:

```typescript
  // Instancias reales siempre que haya API key: los toggles del panel
  // (TenantSettings.describeImages/transcribeAudio) se aplican POR TURNO en el
  // coordinator vía reloadConfig, así encender/apagar no exige reiniciar el tenant.
  const transcriber: Transcriber = apiKey
    ? new WhisperTranscriber(apiKey, config.media.whisperModel) : new NoopTranscriber();
  const describer: Describer = apiKey
    ? new VisionDescriber(apiKey, config.media.visionModel) : new NoopDescriber();
```

- [ ] **Step 2: Run tenant + pipeline tests**

Run: `npx vitest run tests/tenant/ tests/pipeline/`
Expected: PASS todos.

- [ ] **Step 3: Commit**

```bash
git add src/tenant/runtime.ts
git commit -m "feat(tenant): describer/transcriber reales si hay API key; el toggle gatea por turno"
```

---

### Task 4: API — media en GET /settings + PUT /settings/media

**Files:**
- Modify: `api/src/routes/settings.ts`
- Test: `api/tests/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

En `api/tests/settings.test.ts`, añadir al final del `describe('settings', ...)`:

```typescript
  /** Crea la fila TenantSettings del tenant (los tenants provisionados siempre la tienen). */
  async function seedTenantSettings(tenantId: string, over: Partial<{ describeImages: boolean; transcribeAudio: boolean }> = {}) {
    await testPrisma.tenantSettings.create({
      data: {
        tenantId,
        industry: 'tapiceria',
        businessName: 'T',
        businessDomain: 'tapicería de muebles',
        ownerPhoneE164: '',
        welcomeTemplate: 'hola',
        intakeSchema: {},
        describeImages: over.describeImages ?? false,
        transcribeAudio: over.transcribeAudio ?? false,
      },
    });
  }

  it('GET /settings incluye media desde TenantSettings', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    await seedTenantSettings(tenantId, { describeImages: true });
    await useTempConfig();
    const res = await app.inject({ method: 'GET', url: '/settings', headers: admin(tenantId, userId) });
    expect(res.statusCode).toBe(200);
    expect(res.json().media).toEqual({ describeImages: true, transcribeAudio: false });
  });

  it('GET /settings sin fila TenantSettings → media null (tenant legado)', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    await useTempConfig();
    const res = await app.inject({ method: 'GET', url: '/settings', headers: admin(tenantId, userId) });
    expect(res.statusCode).toBe(200);
    expect(res.json().media).toBeNull();
  });

  it('PUT /settings/media persiste los toggles en TenantSettings', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    await seedTenantSettings(tenantId);
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/media',
      headers: admin(tenantId, userId),
      payload: { describeImages: true, transcribeAudio: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().media).toEqual({ describeImages: true, transcribeAudio: true });
    const row = await testPrisma.tenantSettings.findUnique({ where: { tenantId } });
    expect(row!.describeImages).toBe(true);
    expect(row!.transcribeAudio).toBe(true);
  });

  it('PUT /settings/media con payload inválido → 400', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    await seedTenantSettings(tenantId);
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/media',
      headers: admin(tenantId, userId),
      payload: { describeImages: 'sí' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT /settings/media con rol viewer → 403', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    await seedTenantSettings(tenantId);
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/media',
      headers: viewer(tenantId, userId),
      payload: { describeImages: true, transcribeAudio: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('PUT /settings/media sin fila TenantSettings → 404', async () => {
    const { tenantId, userId } = await seedTenantWithTempProfile();
    const res = await app.inject({
      method: 'PUT',
      url: '/settings/media',
      headers: admin(tenantId, userId),
      payload: { describeImages: true, transcribeAudio: true },
    });
    expect(res.statusCode).toBe(404);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run api/tests/settings.test.ts`
Expected: FAIL los 6 nuevos (media undefined / 404 de ruta inexistente); los existentes PASS.

- [ ] **Step 3: Write implementation**

En `api/src/routes/settings.ts`:

1. Añadir import de zod arriba:

```typescript
import { z } from 'zod';
```

2. Añadir el schema junto a los imports:

```typescript
/** Toggles de media por-tenant (TenantSettings). Los modelos NO se exponen:
 *  quedan null → default del operador (config.json). */
const MediaSettingsInputZ = z.object({
  describeImages: z.boolean(),
  transcribeAudio: z.boolean(),
});
```

3. En el handler de `GET /settings`, incluir media (reemplazar el cuerpo):

```typescript
    const prisma = getPrisma();
    const profileDir = await getTenantProfileDir(request.tenantId);
    const [profile, config, ts] = await Promise.all([
      readProfileSettings(prisma, request.tenantId, profileDir),
      readConfigSettings(prisma, configPath()),
      prisma.tenantSettings.findUnique({
        where: { tenantId: request.tenantId },
        select: { describeImages: true, transcribeAudio: true },
      }),
    ]);
    return { profile, config, media: ts ?? null };
```

4. Añadir la ruta nueva al final de `settingsRoutes`:

```typescript
  // Toggles de media por-tenant. Escriben directo a TenantSettings (patrón de
  // onboarding); el worker los recoge en su siguiente turno vía reloadConfig.
  app.put('/settings/media', { preHandler: app.authenticate }, async (request, reply) => {
    if (!requireAdmin(request, reply)) return;
    const parse = MediaSettingsInputZ.safeParse(request.body);
    if (!parse.success) return reply.code(400).send({ error: parse.error.message });
    const prisma = getPrisma();
    const existing = await prisma.tenantSettings.findUnique({ where: { tenantId: request.tenantId } });
    if (!existing) return reply.code(404).send({ error: 'TenantSettings ausente para este tenant' });
    const row = await prisma.tenantSettings.update({
      where: { tenantId: request.tenantId },
      data: parse.data,
      select: { describeImages: true, transcribeAudio: true },
    });
    return { ok: true, media: row };
  });
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run api/tests/settings.test.ts`
Expected: PASS todos (existentes + 6 nuevos).

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/settings.ts api/tests/settings.test.ts
git commit -m "feat(api): exponer toggles de media de TenantSettings en /settings"
```

---

### Task 5: SPA — cliente API + sección "Imágenes y audio" en Settings

**Files:**
- Modify: `spa/src/api/client.ts`
- Modify: `spa/src/pages/Settings.tsx`
- Test: `spa/src/pages/Settings.test.tsx`

- [ ] **Step 1: Write the failing tests**

En `spa/src/pages/Settings.test.tsx`:

1. Al mock de `../api/client` añadir `updateMediaSettings: vi.fn()` dentro de `api`.
2. Después de `const mockUpdateConfig = ...` añadir:

```typescript
const mockUpdateMedia = api.updateMediaSettings as unknown as ReturnType<typeof vi.fn>;
```

3. Junto a `CONFIG` añadir:

```typescript
const MEDIA = { describeImages: false, transcribeAudio: true };
```

4. En `beforeEach`, cambiar los mocks a:

```typescript
  mockUpdateMedia.mockReset();
  mockGet.mockResolvedValue({ profile: structuredClone(PROFILE), config: structuredClone(CONFIG), media: { ...MEDIA } });
  mockUpdateMedia.mockResolvedValue({ ok: true, media: { describeImages: true, transcribeAudio: true } });
```

(las líneas existentes de `mockGet`/`mockUpdateProfile`/`mockUpdateConfig` se conservan; solo se reemplaza el `mockGet.mockResolvedValue` para incluir `media`).

5. Añadir tests al final:

```typescript
test('muestra los toggles de imágenes y audio', async () => {
  renderSettings();
  const img = await screen.findByLabelText(/Describir las fotos del cliente/);
  expect(img).not.toBeChecked();
  expect(screen.getByLabelText(/Transcribir las notas de voz/)).toBeChecked();
});

test('activar visión y guardar llama a updateMediaSettings', async () => {
  renderSettings();
  const img = await screen.findByLabelText(/Describir las fotos del cliente/);
  fireEvent.click(img);
  fireEvent.click(screen.getByRole('button', { name: 'Guardar imágenes y audio' }));
  await waitFor(() => expect(mockUpdateMedia).toHaveBeenCalledTimes(1));
  expect(mockUpdateMedia.mock.calls[0][0]).toEqual({ describeImages: true, transcribeAudio: true });
});

test('sin fila de media (tenant legado) no muestra la sección', async () => {
  mockGet.mockResolvedValue({ profile: structuredClone(PROFILE), config: structuredClone(CONFIG), media: null });
  renderSettings();
  await screen.findByDisplayValue('Tapicería Demo');
  expect(screen.queryByText('Imágenes y audio')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd spa && npx vitest run src/pages/Settings.test.tsx`
Expected: FAIL los 3 nuevos (no existe el checkbox ni el botón); existentes PASS.

- [ ] **Step 3: Write implementation — cliente API**

En `spa/src/api/client.ts`:

1. Añadir la interfaz junto a `ConfigSettings`:

```typescript
export interface MediaSettings {
  describeImages: boolean;
  transcribeAudio: boolean;
}
```

2. Cambiar la firma de `getSettings` y añadir `updateMediaSettings` en `api`:

```typescript
  getSettings: () => request<{ profile: ProfileSettings; config: ConfigSettings; media: MediaSettings | null }>('GET', '/settings'),
  updateMediaSettings: (payload: MediaSettings) =>
    request<{ ok: boolean; media: MediaSettings }>('PUT', '/settings/media', payload),
```

- [ ] **Step 4: Write implementation — Settings.tsx**

En `spa/src/pages/Settings.tsx`:

1. Import: añadir `type MediaSettings` al import de `../api/client`.
2. Estado (junto a los existentes):

```typescript
  const [media, setMedia] = useState<MediaSettings | null>(null);
  const [savingMedia, setSavingMedia] = useState(false);
  const [mediaMsg, setMediaMsg] = useState<string | null>(null);
```

3. En `load()`, tras `setConfig(data.config);` añadir `setMedia(data.media);`.
4. Handler (junto a `saveConfig`):

```typescript
  const saveMedia = useCallback(async () => {
    if (!media) return;
    setSavingMedia(true);
    setMediaMsg(null);
    try {
      const data = await api.updateMediaSettings(media);
      setMedia(data.media);
      setMediaMsg('Guardado. Aplica en la siguiente conversación.');
    } catch (err) {
      setMediaMsg(err instanceof Error ? err.message : 'error al guardar');
    } finally {
      setSavingMedia(false);
    }
  }, [media]);
```

5. Sección nueva ANTES de la sección "Sistema" (después del `</section>` de Negocio):

```tsx
      {/* ---------- Imágenes y audio (por-tenant, TenantSettings) ---------- */}
      {media && (
        <section className="settings-section">
          <h2>Imágenes y audio</h2>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={media.describeImages}
              onChange={(e) => setMedia({ ...media, describeImages: e.target.checked })}
            />
            Describir las fotos del cliente (el asistente razona sobre ellas)
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={media.transcribeAudio}
              onChange={(e) => setMedia({ ...media, transcribeAudio: e.target.checked })}
            />
            Transcribir las notas de voz
          </label>
          <div className="settings-actions">
            <button type="button" onClick={() => void saveMedia()} disabled={savingMedia}>
              {savingMedia ? 'Guardando…' : 'Guardar imágenes y audio'}
            </button>
            {mediaMsg && <span className="settings-msg">{mediaMsg}</span>}
          </div>
        </section>
      )}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `cd spa && npx vitest run src/pages/Settings.test.tsx`
Expected: PASS todos.

- [ ] **Step 6: Commit**

```bash
git add spa/src/api/client.ts spa/src/pages/Settings.tsx spa/src/pages/Settings.test.tsx
git commit -m "feat(spa): sección Imágenes y audio en Configuración"
```

---

### Task 6: Onboarding — tenants nuevos con visión y transcripción activas

**Files:**
- Modify: `api/src/onboarding/templates.ts:43-50`
- Test: `api/tests/templates-media.test.ts` (nuevo)

- [ ] **Step 1: Write the failing test**

Crear `api/tests/templates-media.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { testPrisma, cleanupDb } from './helpers/app';
import { seedTenantSettingsFromTemplate } from '../src/onboarding/templates';

describe('seedTenantSettingsFromTemplate — media defaults', () => {
  beforeEach(async () => {
    await cleanupDb();
  });

  it('los tenants nuevos nacen con describeImages y transcribeAudio en true', async () => {
    const tenant = await testPrisma.tenant.create({
      data: { slug: `s-${Date.now()}`, name: 'T', industry: 'tapiceria', profileDir: './profiles/tapiceria' },
    });
    await seedTenantSettingsFromTemplate(testPrisma, tenant.id, 'tapiceria', { businessName: 'Tapicería X' });
    const row = await testPrisma.tenantSettings.findUnique({ where: { tenantId: tenant.id } });
    expect(row!.describeImages).toBe(true);
    expect(row!.transcribeAudio).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/tests/templates-media.test.ts`
Expected: FAIL — ambos en `false` (default de columna).

- [ ] **Step 3: Write minimal implementation**

En `api/src/onboarding/templates.ts`, en el objeto `data` (línea ~43), añadir dos campos:

```typescript
  const data = {
    industry,
    businessName: vars.businessName,
    businessDomain,
    ownerPhoneE164: '', // se completa al vincular WhatsApp / en el wizard
    welcomeTemplate: welcome,
    intakeSchema: schema,
    // Argumento de venta de la v1: el asistente entiende fotos y notas de voz.
    // El límite mensual del plan gratuito ya acota el costo.
    describeImages: true,
    transcribeAudio: true,
  };
```

- [ ] **Step 4: Run tests to verify pass (incluye onboarding existente)**

Run: `npx vitest run api/tests/templates-media.test.ts api/tests/provision.test.ts api/tests/onboarding-e2e.test.ts`
Expected: PASS todos.

- [ ] **Step 5: Commit**

```bash
git add api/src/onboarding/templates.ts api/tests/templates-media.test.ts
git commit -m "feat(onboarding): tenants nuevos con visión y transcripción activas"
```

---

### Task 7: Runbook — backfill de media para tenants existentes (piloto)

El cutover del piloto está diferido pero pendiente; cuando se ejecute, debe encender los toggles de los tenants existentes.

**Files:**
- Modify: `docs/runbooks/cutover-piloto-fases-1-6.md` (§4, tras el paso 4)

- [ ] **Step 1: Añadir el paso al runbook**

Después del paso `# 4) Backfill de TenantSettings...` insertar:

```markdown
# 4b) Encender visión y transcripción para los tenants existentes (los nuevos ya
#     nacen con true desde el onboarding; el backfill los crea con false):
docker compose run --rm api npx prisma db execute --stdin <<'SQL'
UPDATE "TenantSettings" SET "describeImages" = true, "transcribeAudio" = true;
SQL
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/cutover-piloto-fases-1-6.md
git commit -m "docs(runbook): backfill de toggles de media en el cutover del piloto"
```

---

### Task 8: Verificación completa

- [ ] **Step 1: Suite raíz + api**

Run: `npm test`
Expected: PASS (≈383 tests + los nuevos).

- [ ] **Step 2: Typecheck raíz**

Run: `npm run typecheck`
Expected: sin errores.

- [ ] **Step 3: Suite + typecheck SPA**

Run: `cd spa && npm test && npm run typecheck`
Expected: PASS (≈51 tests + los nuevos), sin errores de tipos.

- [ ] **Step 4: Commit final si hubo ajustes**

```bash
git status   # si hay cambios pendientes de los pasos anteriores, commitearlos
```

---

### Task 9: Limpieza — cerrar la rama de visión superseded

⚠️ Acción sobre el remoto: **confirmar con el usuario antes de ejecutar el push --delete.**

**Files:** ninguno (operación git)

- [ ] **Step 1: Verificar que no queda nada único en la rama**

Run: `git log --oneline origin/master..claude/agent-image-settings-reasoning-yy9zcy`
Expected: solo los 2 commits conocidos (`10fdb36`, `a4a968f`), ya superseded por las Fases 1-6 (ver spec §2).

- [ ] **Step 2: Borrar la rama local y remota**

```bash
git branch -D claude/agent-image-settings-reasoning-yy9zcy
git push origin --delete claude/agent-image-settings-reasoning-yy9zcy
```

- [ ] **Step 3: Anunciar el cierre**

Confirmar al usuario que la rama quedó cerrada y que el registro de por qué vive en
`docs/superpowers/specs/2026-07-05-vision-panel-toggles-design.md` §2.

---

## Notas para el ejecutor

- El worker se entera de los cambios de `TenantSettings` en el siguiente turno vía
  `reloadConfig` (`src/tenant/runtime.ts:176-179`) — Tasks 1-3 son las que hacen
  que el toggle surta efecto sin reiniciar; no hay que tocar el TenantManager.
- `visionModel`/`whisperModel` se quedan `null` por diseño (default del operador).
- Al terminar: usar superpowers:finishing-a-development-branch (PR hacia `master`).
