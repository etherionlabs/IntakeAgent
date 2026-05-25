# Plan 1 — Fundación (Intake recepcionista)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la fundación del proyecto Intake: proyecto Node+TS configurado, base de datos vía Prisma, loaders de configuración y perfil de negocio, validador Zod de schemas, y servicios core (intake/job/contact) — todo unit-testeable sin red, sin LLM, sin WhatsApp.

**Architecture:** Monolito modular. Esta fundación expone interfaces (`intakeService`, `jobService`, `contactService`) que los planes posteriores (agent-core, pipeline, adapter, panel) consumen. Storage vía Prisma (SQLite en local, Postgres en VPS — mismo schema). Configuración multi-negocio vía archivos declarativos por perfil.

**Tech Stack:** Node.js 20+, TypeScript ESM, Prisma 5, Zod 3, Vitest 1, pino 9. Sin red ni LLM en este plan.

**Spec de referencia:** [`docs/superpowers/specs/2026-05-25-intake-recepcionista-design.md`](../specs/2026-05-25-intake-recepcionista-design.md)

---

## Estructura final tras este plan

```
intake/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
├── .env.example
├── prisma/
│   └── schema.prisma
├── profiles/
│   └── tapiceria/
│       ├── intake-schema.json
│       ├── prompt-vars.json
│       ├── business-facts.json
│       └── welcome.txt
├── config.json
├── src/
│   ├── config/
│   │   ├── schema.ts          # Zod types de config + profile
│   │   ├── loader.ts          # readConfig, readProfile (con hot-reload)
│   │   └── intake-schema.ts   # Zod meta-schema + validator
│   ├── storage/
│   │   └── client.ts          # PrismaClient singleton
│   ├── services/
│   │   ├── intake.ts          # createEmptyFromSchema, getField, bulkUpdate, addFreeNote, isComplete, renderForModel
│   │   ├── job.ts             # open, markReady, markInProgress, close, reopen, findOpenForContact, selectOrOpen
│   │   ├── contact.ts         # upsertByPhone, toggleBot, flagNonIntake
│   │   └── errors.ts          # ServiceError tipos
│   ├── lib/
│   │   ├── path.ts            # getByPath, setByPath (notación punto)
│   │   └── logger.ts          # pino instance
│   └── cli/
│       └── show-intake.ts     # CLI: cargar perfil y mostrar estado del intake
└── tests/
    ├── config.test.ts
    ├── intake-schema.test.ts
    ├── services/intake.test.ts
    ├── services/job.test.ts
    ├── services/contact.test.ts
    └── lib/path.test.ts
```

---

## Task 1: Inicialización del proyecto

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Inicializar git y npm**

Run en `C:\Users\yasse\Intake`:

```bash
git init
npm init -y
npm pkg set type="module"
npm pkg set engines.node=">=20.0.0"
```

- [ ] **Step 2: Instalar dependencias runtime**

```bash
npm install zod pino @prisma/client
```

- [ ] **Step 3: Instalar dependencias dev**

```bash
npm install -D typescript tsx vitest @types/node prisma
```

- [ ] **Step 4: Crear `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": false,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 5: Crear `.gitignore`**

```
node_modules
dist
data/
media/
.env
.env.local
*.log
.DS_Store
```

- [ ] **Step 6: Crear `.env.example`**

```
# OpenRouter (se usa en Plan 2 — definido aquí para que el repo lo documente)
OPENROUTER_API_KEY=sk-or-...

# Panel auth (se usa en Plan 5)
PANEL_PASSWORD_HASH=

# Database
DATABASE_URL="file:./data/intake.db"
```

- [ ] **Step 7: Añadir scripts al `package.json`**

Edita `package.json` para que `scripts` quede así:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "typecheck": "tsc --noEmit",
  "prisma:generate": "prisma generate",
  "prisma:migrate": "prisma migrate dev",
  "cli:show-intake": "tsx src/cli/show-intake.ts"
}
```

- [ ] **Step 8: Commit inicial**

```bash
git add .
git commit -m "chore: inicializa proyecto Node+TS con dependencias base"
```

---

## Task 2: Setup de Vitest

**Files:**
- Create: `vitest.config.ts`
- Create: `tests/sanity.test.ts`

- [ ] **Step 1: Crear `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
```

- [ ] **Step 2: Crear test sanity**

`tests/sanity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('sanity', () => {
  it('runs vitest', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Correr y verificar**

```bash
npm test
```

Expected: 1 passed.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts tests/sanity.test.ts
git commit -m "chore: configura vitest"
```

---

## Task 3: Prisma schema y migración inicial

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/storage/client.ts`

- [ ] **Step 1: Crear `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Contact {
  id                String   @id @default(uuid())
  phoneE164         String   @unique
  displayName       String?
  botActive         Boolean  @default(true)
  flaggedNonIntake  Boolean  @default(false)
  flaggedReason     String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  jobs              Job[]
  messages          Message[]
}

model Job {
  id              String    @id @default(uuid())
  contactId       String
  status          String    // 'OPEN_INTAKE' | 'READY_FOR_REVIEW' | 'IN_PROGRESS' | 'CLOSED'
  intake          String    // JSON serializado
  intakeComplete  Boolean   @default(false)
  summary         String?
  openedAt        DateTime  @default(now())
  readyAt         DateTime?
  closedAt        DateTime?

  contact         Contact   @relation(fields: [contactId], references: [id])
  messages        Message[]
  agentRuns       AgentRun[]
  notifications   Notification[]

  @@index([contactId, status])
}

model Message {
  id              String   @id @default(uuid())
  jobId           String?
  contactId       String
  direction       String   // 'inbound' | 'outbound'
  kind            String   // 'text' | 'image' | 'audio' | 'sticker' | 'location' | 'other'
  body            String?
  mediaPath       String?
  whatsappMsgId   String?  @unique
  raw             String?  // JSON serializado
  createdAt       DateTime @default(now())

  job             Job?     @relation(fields: [jobId], references: [id])
  contact         Contact  @relation(fields: [contactId], references: [id])

  @@index([contactId, createdAt])
}

model AgentRun {
  id                  String   @id @default(uuid())
  jobId               String
  triggerMessageIds   String   // JSON array de IDs
  model               String
  inputTokens         Int      @default(0)
  outputTokens        Int      @default(0)
  costUsd             Float?
  toolCalls           String   // JSON
  responseText        String?
  configHash          String?
  error               String?
  createdAt           DateTime @default(now())

  job                 Job      @relation(fields: [jobId], references: [id])
}

model Notification {
  id          String   @id @default(uuid())
  jobId       String
  kind        String   // 'owner_ready' | 'disconnect_alert' | 'cost_alert'
  sentVia     String   // 'whatsapp' | 'panel_only'
  sentAt      DateTime @default(now())

  job         Job      @relation(fields: [jobId], references: [id])
}

model Setting {
  key   String  @id
  value String  // JSON serializado
}
```

- [ ] **Step 2: Crear `.env` local (no commit)**

```bash
cp .env.example .env
```

Edita `.env` para tener:

```
DATABASE_URL="file:./data/intake.db"
```

- [ ] **Step 3: Crear directorio de datos y correr migración inicial**

```bash
mkdir -p data
npx prisma migrate dev --name init
```

Expected: crea `data/intake.db`, genera el cliente, crea `prisma/migrations/.../migration.sql`.

- [ ] **Step 4: Crear `src/storage/client.ts`**

```ts
import { PrismaClient } from '@prisma/client';

let _client: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!_client) {
    _client = new PrismaClient();
  }
  return _client;
}

export async function disconnectPrisma(): Promise<void> {
  if (_client) {
    await _client.$disconnect();
    _client = null;
  }
}
```

- [ ] **Step 5: Verificar que typecheck pasa**

```bash
npm run typecheck
```

Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add prisma/ src/storage/ .env.example
git commit -m "feat: Prisma schema y cliente con todas las tablas del MVP"
```

---

## Task 4: Helper `path.ts` para notación punto

**Files:**
- Create: `src/lib/path.ts`
- Test: `tests/lib/path.test.ts`

- [ ] **Step 1: Escribir tests fallando**

`tests/lib/path.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getByPath, setByPath, hasPath } from '../../src/lib/path';

describe('getByPath', () => {
  it('devuelve valor en path simple', () => {
    expect(getByPath({ a: 1 }, 'a')).toBe(1);
  });
  it('devuelve valor en path anidado', () => {
    expect(getByPath({ a: { b: { c: 2 } } }, 'a.b.c')).toBe(2);
  });
  it('devuelve undefined si el path no existe', () => {
    expect(getByPath({ a: 1 }, 'b.c')).toBeUndefined();
  });
  it('no falla con objetos vacíos', () => {
    expect(getByPath({}, 'a.b')).toBeUndefined();
  });
});

describe('setByPath', () => {
  it('escribe valor en path simple sin mutar el original', () => {
    const obj = { a: 1 };
    const out = setByPath(obj, 'b', 2);
    expect(out).toEqual({ a: 1, b: 2 });
    expect(obj).toEqual({ a: 1 });
  });
  it('escribe en path anidado creando objetos intermedios', () => {
    const out = setByPath({}, 'a.b.c', 5);
    expect(out).toEqual({ a: { b: { c: 5 } } });
  });
  it('sobreescribe valor existente', () => {
    const out = setByPath({ a: { b: 1 } }, 'a.b', 2);
    expect(out).toEqual({ a: { b: 2 } });
  });
});

describe('hasPath', () => {
  it('detecta path existente con valor null', () => {
    expect(hasPath({ a: { b: null } }, 'a.b')).toBe(true);
  });
  it('detecta path inexistente', () => {
    expect(hasPath({ a: 1 }, 'a.b')).toBe(false);
  });
});
```

- [ ] **Step 2: Correr para verificar fallan**

```bash
npm test -- tests/lib/path.test.ts
```

Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar `src/lib/path.ts`**

```ts
export function getByPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function setByPath<T extends Record<string, unknown>>(
  obj: T,
  path: string,
  value: unknown,
): T {
  const parts = path.split('.');
  const clone = structuredClone(obj);
  let cur: Record<string, unknown> = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (
      cur[key] == null ||
      typeof cur[key] !== 'object' ||
      Array.isArray(cur[key])
    ) {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  return clone;
}

export function hasPath(obj: unknown, path: string): boolean {
  if (obj == null) return false;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return false;
    if (!(part in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return true;
}
```

- [ ] **Step 4: Correr tests y verificar pasan**

```bash
npm test -- tests/lib/path.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/path.ts tests/lib/path.test.ts
git commit -m "feat(lib): helpers de notación punto para paths anidados"
```

---

## Task 5: Meta-schema Zod para `intake-schema.json`

**Files:**
- Create: `src/config/intake-schema.ts`
- Test: `tests/intake-schema.test.ts`

- [ ] **Step 1: Escribir tests fallando**

`tests/intake-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { IntakeSchemaZ, validateIntakeSchema } from '../src/config/intake-schema';

const valid = {
  $businessName: 'Tapicería Acme',
  $businessDomain: 'tapicería',
  $language: 'es-MX',
  sections: [
    {
      key: 'client',
      label: 'Cliente',
      fields: [
        { key: 'name', label: 'Nombre', type: 'string', required: true },
        {
          key: 'service_type',
          label: 'Servicio',
          type: 'enum',
          required: true,
          options: ['retapizar', 'reparar'],
        },
        { key: 'qty', label: 'Cantidad', type: 'integer', required: true, min: 1 },
      ],
    },
  ],
};

describe('IntakeSchemaZ', () => {
  it('acepta schema válido', () => {
    expect(() => IntakeSchemaZ.parse(valid)).not.toThrow();
  });

  it('rechaza schema sin $businessName', () => {
    const bad = { ...valid, $businessName: undefined };
    expect(() => IntakeSchemaZ.parse(bad)).toThrow();
  });

  it('rechaza type enum sin options', () => {
    const bad = structuredClone(valid);
    bad.sections[0].fields[1] = {
      key: 'service_type',
      label: 'Servicio',
      type: 'enum',
      required: true,
    } as any;
    expect(() => IntakeSchemaZ.parse(bad)).toThrow();
  });

  it('rechaza type enum con options vacío', () => {
    const bad = structuredClone(valid);
    (bad.sections[0].fields[1] as any).options = [];
    expect(() => IntakeSchemaZ.parse(bad)).toThrow();
  });
});

describe('validateIntakeSchema', () => {
  it('detecta keys duplicadas dentro de una sección', () => {
    const bad = structuredClone(valid);
    bad.sections[0].fields.push({
      key: 'name',
      label: 'Otro nombre',
      type: 'string',
      required: false,
    });
    const result = validateIntakeSchema(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/duplicad/i);
  });

  it('valida correctamente un schema bien formado', () => {
    const result = validateIntakeSchema(valid);
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Correr para ver que fallan**

```bash
npm test -- tests/intake-schema.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/config/intake-schema.ts`**

```ts
import { z } from 'zod';

const FieldTypeZ = z.enum([
  'string',
  'text',
  'integer',
  'number',
  'boolean',
  'enum',
  'multi_enum',
  'phone',
  'date',
  'currency',
]);

const FieldZ = z
  .object({
    key: z.string().regex(/^[a-z_][a-z0-9_]*$/i, 'key debe ser un identificador'),
    label: z.string().min(1),
    type: FieldTypeZ,
    required: z.boolean().default(false),
    hint: z.string().optional(),
    options: z.array(z.string().min(1)).min(1).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .refine(
    (f) =>
      (f.type !== 'enum' && f.type !== 'multi_enum') ||
      (Array.isArray(f.options) && f.options.length > 0),
    { message: 'type enum/multi_enum requiere options no vacío' },
  );

const SectionZ = z.object({
  key: z.string().regex(/^[a-z_][a-z0-9_]*$/i),
  label: z.string().min(1),
  fields: z.array(FieldZ).min(1),
});

export const IntakeSchemaZ = z.object({
  $businessName: z.string().min(1),
  $businessDomain: z.string().min(1),
  $language: z.string().min(2).default('es-MX'),
  sections: z.array(SectionZ).min(1),
});

export type IntakeSchema = z.infer<typeof IntakeSchemaZ>;
export type IntakeSection = z.infer<typeof SectionZ>;
export type IntakeField = z.infer<typeof FieldZ>;

export type ValidationResult =
  | { ok: true; schema: IntakeSchema }
  | { ok: false; error: string };

export function validateIntakeSchema(input: unknown): ValidationResult {
  const parsed = IntakeSchemaZ.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }
  // Validación adicional: no duplicates dentro de sección
  const schema = parsed.data;
  for (const section of schema.sections) {
    const keys = section.fields.map((f) => f.key);
    const seen = new Set<string>();
    for (const k of keys) {
      if (seen.has(k)) {
        return {
          ok: false,
          error: `key duplicada en sección "${section.key}": ${k}`,
        };
      }
      seen.add(k);
    }
  }
  return { ok: true, schema };
}

export function getFieldByPath(
  schema: IntakeSchema,
  path: string,
): IntakeField | null {
  const [sectionKey, fieldKey] = path.split('.');
  const section = schema.sections.find((s) => s.key === sectionKey);
  if (!section) return null;
  return section.fields.find((f) => f.key === fieldKey) ?? null;
}

export function listRequiredPaths(schema: IntakeSchema): string[] {
  const out: string[] = [];
  for (const s of schema.sections) {
    for (const f of s.fields) {
      if (f.required) out.push(`${s.key}.${f.key}`);
    }
  }
  return out;
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/intake-schema.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/config/intake-schema.ts tests/intake-schema.test.ts
git commit -m "feat(config): meta-schema Zod para intake schemas con validación extendida"
```

---

## Task 6: Profile loader

**Files:**
- Create: `src/config/schema.ts`
- Create: `src/config/loader.ts`
- Create: `profiles/tapiceria/intake-schema.json`
- Create: `profiles/tapiceria/prompt-vars.json`
- Create: `profiles/tapiceria/business-facts.json`
- Create: `profiles/tapiceria/welcome.txt`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Crear perfil de tapicería de ejemplo**

`profiles/tapiceria/intake-schema.json`:

```json
{
  "$businessName": "Tapicería Demo",
  "$businessDomain": "tapicería de muebles",
  "$language": "es-MX",
  "sections": [
    {
      "key": "client",
      "label": "Cliente",
      "fields": [
        { "key": "name", "label": "Nombre", "type": "string", "required": true },
        { "key": "city_or_zone", "label": "Ciudad / Zona", "type": "string", "required": true },
        { "key": "phone_alt", "label": "Teléfono alterno", "type": "phone", "required": false }
      ]
    },
    {
      "key": "work",
      "label": "Trabajo",
      "fields": [
        { "key": "item_type", "label": "Mueble", "type": "string", "required": true, "hint": "sillón 3 plazas, silla de comedor, cabecera, etc." },
        { "key": "service_type", "label": "Tipo de trabajo", "type": "enum", "required": true, "options": ["retapizar", "reparar", "fabricar", "otro"] },
        { "key": "quantity", "label": "Cantidad", "type": "integer", "required": true, "min": 1 },
        { "key": "current_state", "label": "Estado actual", "type": "text", "required": false }
      ]
    },
    {
      "key": "specs",
      "label": "Especificaciones",
      "fields": [
        { "key": "fabric_preference", "label": "Tela preferida", "type": "string", "required": false },
        { "key": "color_preference", "label": "Color preferido", "type": "string", "required": false },
        { "key": "extra_requirements", "label": "Requerimientos extra", "type": "text", "required": false }
      ]
    },
    {
      "key": "logistics",
      "label": "Logística",
      "fields": [
        { "key": "pickup_needed", "label": "¿Recolección a domicilio?", "type": "boolean", "required": false },
        { "key": "address", "label": "Dirección", "type": "text", "required": false },
        { "key": "desired_deadline", "label": "Fecha deseada", "type": "date", "required": false }
      ]
    }
  ]
}
```

`profiles/tapiceria/prompt-vars.json`:

```json
{
  "promptTemplate": "Eres el asistente virtual de **{{businessName}}**, un negocio de {{businessDomain}}. Tu trabajo es atender por WhatsApp a clientes y recopilar la información necesaria para que el dueño les dé seguimiento.\n\n## Tono\n{{tone}}\n\n## Cómo trabajas\n{{coreInstructions}}\n\n## Reglas duras\n{{hardRules}}",
  "vars": {
    "tone": "Español neutro, cercano y profesional. Usa 'tú'. Mensajes cortos (1-3 frases por respuesta).",
    "coreInstructions": "- En cada turno recibes el ESTADO DEL INTAKE inyectado abajo. NO preguntes campos que ya están llenos. NO repitas preguntas marcadas como ya preguntadas salvo que el cliente parezca haberlas olvidado.\n- Cuando el cliente te dé información, llama a update_intake con TODOS los campos en una sola llamada.\n- Si el cliente menciona algo relevante que no encaja en un campo, agrégalo en notes_to_add.\n- Si el cliente explícitamente dice que no tiene, no sabe o no aplica un dato, llama a update_intake con declined=true y declined_reason.\n- Pide fotos cuando ayuden. Usa request_photo y díselo en tu respuesta.\n- Cuando los campos requeridos estén satisfechos, presenta un resumen al cliente y pídele confirmación. Si confirma, llama a mark_ready_for_review con un resumen 2-3 frases para el dueño.\n- Después de marcar como listo, sigue respondiendo si el cliente agrega algo. Solo cierra con close_job cuando el cliente diga explícitamente que ya terminó.",
    "hardRules": "- NUNCA inventes precios ni tiempos de entrega.\n- NUNCA prometas servicios que no sabes si ofrecemos.\n- Si no entiendes algo, pregunta.\n- Si el cliente se desvía a temas no relacionados, reconduce 1-2 veces. Si insiste, llama a flag_non_intake."
  }
}
```

`profiles/tapiceria/business-facts.json`:

```json
{
  "facts": [
    { "topic": "ubicación", "aliases": ["dirección", "donde están", "donde queda"], "answer": "Estamos en Av. Reforma 123, colonia Centro." },
    { "topic": "horarios", "aliases": ["a qué hora", "cuando abren"], "answer": "Lunes a viernes de 9:00 a 19:00, sábados de 10:00 a 14:00." },
    { "topic": "métodos de pago", "aliases": ["pago", "tarjeta", "transferencia"], "answer": "Aceptamos efectivo, transferencia y tarjeta. El anticipo es del 50%." }
  ],
  "freeContext": "Trabajamos sobre todo con muebles de sala y comedor. No hacemos colchones ni tapicería automotriz."
}
```

`profiles/tapiceria/welcome.txt`:

```
¡Hola! Soy el asistente de {{businessName}}. Voy a tomarte unos datos para que mi jefe pueda atenderte lo mejor posible. ¿Me dices tu nombre y qué mueble quieres atender?
```

- [ ] **Step 2: Crear `src/config/schema.ts`**

```ts
import { z } from 'zod';

export const PromptVarsZ = z.object({
  promptTemplate: z.string().min(20),
  vars: z.record(z.string()),
});
export type PromptVars = z.infer<typeof PromptVarsZ>;

export const BusinessFactsZ = z.object({
  facts: z
    .array(
      z.object({
        topic: z.string().min(1),
        aliases: z.array(z.string()).default([]),
        answer: z.string().min(1),
      }),
    )
    .default([]),
  freeContext: z.string().default(''),
});
export type BusinessFacts = z.infer<typeof BusinessFactsZ>;

export const ConfigZ = z.object({
  profile: z.string().min(1),
  model: z.string().min(1).default('openrouter/auto'),
  maxSteps: z.number().int().positive().default(6),
  temperature: z.number().min(0).max(2).default(0.4),
  debounceMs: z.number().int().positive().default(5000),
  fallbackOnError: z
    .string()
    .default('Disculpa, tuve un problema. ¿Me lo repites?'),
  outOfScopeNudge: z
    .string()
    .default('Esto es solo para temas de {{businessDomain}}. ¿Cómo puedo ayudarte?'),
  hours: z
    .object({
      enabled: z.boolean().default(false),
      timezone: z.string().default('America/Mexico_City'),
      schedule: z.record(z.union([z.tuple([z.string(), z.string()]), z.null()])).default({}),
      outOfHoursNotice: z.string().default(''),
    })
    .default({ enabled: false, timezone: 'America/Mexico_City', schedule: {}, outOfHoursNotice: '' }),
  owner: z.object({
    phoneE164: z.string().min(5),
    notifyOnReady: z.boolean().default(true),
    notifyOnDisconnect: z.boolean().default(true),
    panelUrl: z.string().url().default('http://localhost:3000'),
  }),
  panel: z
    .object({
      users: z
        .array(
          z.object({
            username: z.string().min(1),
            passwordHashEnv: z.string().min(1),
          }),
        )
        .default([]),
    })
    .default({ users: [] }),
  media: z
    .object({
      storeDir: z.string().default('./media'),
      transcribeAudio: z.boolean().default(true),
      whisperModel: z.string().default('openai/whisper-1'),
    })
    .default({ storeDir: './media', transcribeAudio: true, whisperModel: 'openai/whisper-1' }),
  limits: z
    .object({
      monthlyCostUsd: z.number().positive().default(50),
      alertOnCostUsd: z.number().positive().default(40),
      maxConsecutiveErrors: z.number().int().positive().default(3),
    })
    .default({ monthlyCostUsd: 50, alertOnCostUsd: 40, maxConsecutiveErrors: 3 }),
});
export type Config = z.infer<typeof ConfigZ>;

export interface Profile {
  intakeSchema: import('./intake-schema').IntakeSchema;
  promptVars: PromptVars;
  businessFacts: BusinessFacts;
  welcome: string;
  hash: string;
}
```

- [ ] **Step 3: Crear `src/config/loader.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  ConfigZ,
  PromptVarsZ,
  BusinessFactsZ,
  type Config,
  type Profile,
} from './schema';
import { validateIntakeSchema } from './intake-schema';

export class ConfigLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigLoadError';
  }
}

export async function loadConfig(path: string): Promise<Config> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (e) {
    throw new ConfigLoadError(`No se pudo leer config en ${path}: ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new ConfigLoadError(`JSON inválido en ${path}: ${(e as Error).message}`);
  }
  const result = ConfigZ.safeParse(parsed);
  if (!result.success) {
    throw new ConfigLoadError(`Config inválida: ${result.error.message}`);
  }
  return result.data;
}

export async function loadProfile(profileDir: string): Promise<Profile> {
  const dir = resolve(profileDir);
  const [schemaRaw, promptRaw, factsRaw, welcomeRaw] = await Promise.all([
    readFile(join(dir, 'intake-schema.json'), 'utf-8'),
    readFile(join(dir, 'prompt-vars.json'), 'utf-8'),
    readFile(join(dir, 'business-facts.json'), 'utf-8'),
    readFile(join(dir, 'welcome.txt'), 'utf-8'),
  ]);

  const schemaJson = JSON.parse(schemaRaw);
  const schemaResult = validateIntakeSchema(schemaJson);
  if (!schemaResult.ok) {
    throw new ConfigLoadError(`intake-schema.json inválido: ${schemaResult.error}`);
  }

  const promptVars = PromptVarsZ.safeParse(JSON.parse(promptRaw));
  if (!promptVars.success) {
    throw new ConfigLoadError(`prompt-vars.json inválido: ${promptVars.error.message}`);
  }

  const businessFacts = BusinessFactsZ.safeParse(JSON.parse(factsRaw));
  if (!businessFacts.success) {
    throw new ConfigLoadError(`business-facts.json inválido: ${businessFacts.error.message}`);
  }

  const combined = `${schemaRaw}\n${promptRaw}\n${factsRaw}\n${welcomeRaw}`;
  const hash = createHash('sha256').update(combined).digest('hex').slice(0, 12);

  return {
    intakeSchema: schemaResult.schema,
    promptVars: promptVars.data,
    businessFacts: businessFacts.data,
    welcome: welcomeRaw,
    hash,
  };
}

/** Carga config + profile manteniendo última versión válida en cache. */
export class ConfigCache {
  private lastValid: { config: Config; profile: Profile } | null = null;

  constructor(
    private readonly configPath: string,
    private readonly logger?: { warn: (msg: string) => void },
  ) {}

  async refresh(): Promise<{ config: Config; profile: Profile }> {
    try {
      const config = await loadConfig(this.configPath);
      const profile = await loadProfile(config.profile);
      this.lastValid = { config, profile };
      return this.lastValid;
    } catch (e) {
      if (this.lastValid) {
        this.logger?.warn?.(
          `Config/profile inválido, usando última versión válida: ${(e as Error).message}`,
        );
        return this.lastValid;
      }
      throw e;
    }
  }
}
```

- [ ] **Step 4: Crear `config.json`**

```json
{
  "profile": "./profiles/tapiceria",
  "model": "anthropic/claude-sonnet-4-6",
  "maxSteps": 6,
  "temperature": 0.4,
  "debounceMs": 5000,
  "fallbackOnError": "Disculpa, tuve un problema. ¿Me lo repites?",
  "outOfScopeNudge": "Esto es solo para temas de {{businessDomain}}. ¿Cómo puedo ayudarte?",
  "hours": {
    "enabled": false,
    "timezone": "America/Mexico_City",
    "schedule": {},
    "outOfHoursNotice": ""
  },
  "owner": {
    "phoneE164": "+521234567890",
    "notifyOnReady": true,
    "notifyOnDisconnect": true,
    "panelUrl": "http://localhost:3000"
  },
  "panel": {
    "users": [
      { "username": "duenio", "passwordHashEnv": "PANEL_PASSWORD_HASH" }
    ]
  },
  "media": {
    "storeDir": "./media",
    "transcribeAudio": true,
    "whisperModel": "openai/whisper-1"
  },
  "limits": {
    "monthlyCostUsd": 50,
    "alertOnCostUsd": 40,
    "maxConsecutiveErrors": 3
  }
}
```

- [ ] **Step 5: Escribir tests**

`tests/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig, loadProfile, ConfigCache, ConfigLoadError } from '../src/config/loader';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const validConfig = {
  profile: './profiles/tapiceria',
  owner: { phoneE164: '+5215555555555' },
};

async function makeTmpDir(): Promise<string> {
  const dir = join(tmpdir(), `intake-test-${Date.now()}-${Math.random()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('loadConfig', () => {
  it('carga y aplica defaults', async () => {
    const dir = await makeTmpDir();
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify(validConfig));
    const cfg = await loadConfig(path);
    expect(cfg.maxSteps).toBe(6);
    expect(cfg.debounceMs).toBe(5000);
    await rm(dir, { recursive: true });
  });

  it('falla con JSON inválido', async () => {
    const dir = await makeTmpDir();
    const path = join(dir, 'config.json');
    await writeFile(path, '{ not json');
    await expect(loadConfig(path)).rejects.toThrow(ConfigLoadError);
    await rm(dir, { recursive: true });
  });

  it('falla si falta owner', async () => {
    const dir = await makeTmpDir();
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ profile: './x' }));
    await expect(loadConfig(path)).rejects.toThrow(ConfigLoadError);
    await rm(dir, { recursive: true });
  });
});

describe('loadProfile', () => {
  it('carga el perfil tapiceria del repo', async () => {
    const profile = await loadProfile('./profiles/tapiceria');
    expect(profile.intakeSchema.$businessName).toBe('Tapicería Demo');
    expect(profile.welcome).toMatch(/asistente/i);
    expect(profile.hash).toHaveLength(12);
  });
});

describe('ConfigCache', () => {
  it('mantiene última versión válida cuando hay error posterior', async () => {
    const dir = await makeTmpDir();
    const path = join(dir, 'config.json');
    await writeFile(path, JSON.stringify({ ...validConfig, profile: './profiles/tapiceria' }));
    const warnings: string[] = [];
    const cache = new ConfigCache(path, { warn: (m) => warnings.push(m) });
    const first = await cache.refresh();
    expect(first.config.model).toBeDefined();
    await writeFile(path, '{ broken json');
    const second = await cache.refresh();
    expect(second.config.model).toBe(first.config.model);
    expect(warnings.length).toBe(1);
    await rm(dir, { recursive: true });
  });
});
```

- [ ] **Step 6: Correr tests**

```bash
npm test -- tests/config.test.ts
```

Expected: 5 passed.

- [ ] **Step 7: Commit**

```bash
git add src/config/ tests/config.test.ts profiles/ config.json
git commit -m "feat(config): loader de config y perfil con hot-reload y fallback a última versión válida"
```

---

## Task 7: Servicio de intake — crear estado vacío desde schema

**Files:**
- Create: `src/services/intake.ts`
- Create: `src/services/errors.ts`
- Test: `tests/services/intake.test.ts`

- [ ] **Step 1: Crear `src/services/errors.ts`**

```ts
export class ServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}
```

- [ ] **Step 2: Escribir tests fallando para `createEmptyIntakeFromSchema`**

`tests/services/intake.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createEmptyIntakeFromSchema } from '../../src/services/intake';
import type { IntakeSchema } from '../../src/config/intake-schema';

const schema: IntakeSchema = {
  $businessName: 'X',
  $businessDomain: 'y',
  $language: 'es-MX',
  sections: [
    {
      key: 'client',
      label: 'Cliente',
      fields: [
        { key: 'name', label: 'Nombre', type: 'string', required: true },
        { key: 'phone', label: 'Teléfono', type: 'phone', required: false },
      ],
    },
    {
      key: 'work',
      label: 'Trabajo',
      fields: [
        { key: 'qty', label: 'Cant', type: 'integer', required: true, min: 1 },
      ],
    },
  ],
};

describe('createEmptyIntakeFromSchema', () => {
  it('genera estado con todos los campos vacíos no preguntados', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    expect(intake.client.name).toEqual({ value: null, asked: false });
    expect(intake.client.phone).toEqual({ value: null, asked: false });
    expect(intake.work.qty).toEqual({ value: null, asked: false });
  });

  it('incluye contador de media y free_notes vacíos', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    expect(intake.media).toEqual({ photo_count: 0, audio_count: 0 });
    expect(intake.free_notes).toEqual([]);
  });
});
```

- [ ] **Step 3: Implementar `src/services/intake.ts` (inicio)**

```ts
import type { IntakeSchema } from '../config/intake-schema';

export interface FieldState {
  value: string | number | boolean | null;
  asked: boolean;
  declined?: boolean;
  declined_reason?: string;
  updated_at?: string;
  source_message_id?: string;
}

export interface FreeNote {
  text: string;
  added_at: string;
  source_message_id: string | null;
}

export interface IntakeState {
  [section: string]: Record<string, FieldState> | { photo_count: number; audio_count: number } | FreeNote[];
  media: { photo_count: number; audio_count: number };
  free_notes: FreeNote[];
}

export function createEmptyIntakeFromSchema(schema: IntakeSchema): IntakeState {
  const intake: IntakeState = {
    media: { photo_count: 0, audio_count: 0 },
    free_notes: [],
  };
  for (const section of schema.sections) {
    const sec: Record<string, FieldState> = {};
    for (const field of section.fields) {
      sec[field.key] = { value: null, asked: false };
    }
    intake[section.key] = sec;
  }
  return intake;
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/services/intake.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/services/errors.ts src/services/intake.ts tests/services/intake.test.ts
git commit -m "feat(intake): createEmptyIntakeFromSchema"
```

---

## Task 8: Intake service — `bulkUpdate` con validación contra schema

**Files:**
- Modify: `src/services/intake.ts`
- Modify: `tests/services/intake.test.ts`

- [ ] **Step 1: Extender el schema de tests con un campo enum**

Primero reescribe el bloque `const schema` al inicio de `tests/services/intake.test.ts` para que ya incluya un campo `enum` desde el principio (evita mutación):

```ts
const schema: IntakeSchema = {
  $businessName: 'X',
  $businessDomain: 'y',
  $language: 'es-MX',
  sections: [
    {
      key: 'client',
      label: 'Cliente',
      fields: [
        { key: 'name', label: 'Nombre', type: 'string', required: true },
        { key: 'phone', label: 'Teléfono', type: 'phone', required: false },
      ],
    },
    {
      key: 'work',
      label: 'Trabajo',
      fields: [
        { key: 'qty', label: 'Cant', type: 'integer', required: true, min: 1 },
        {
          key: 'service',
          label: 'Servicio',
          type: 'enum',
          required: false,
          options: ['retapizar', 'reparar'],
        },
      ],
    },
  ],
};
```

Luego append los nuevos tests:

```ts
import { bulkUpdate } from '../../src/services/intake';

describe('bulkUpdate', () => {
  const meta = {
    now: '2026-05-25T10:00:00Z',
    source_message_id: 'msg_1',
  };

  it('actualiza un campo string válido', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(schema, intake, [{ path: 'client.name', value: 'María' }], meta);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.intake.client as any).name.value).toBe('María');
    expect((result.intake.client as any).name.asked).toBe(true);
    expect((result.intake.client as any).name.updated_at).toBe(meta.now);
    expect((result.intake.client as any).name.source_message_id).toBe('msg_1');
  });

  it('rechaza path inexistente', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(schema, intake, [{ path: 'nope.x', value: 'y' }], meta);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no existe/i);
  });

  it('rechaza valor con tipo incorrecto (integer recibe string)', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(schema, intake, [{ path: 'work.qty', value: 'cinco' }], meta);
    expect(result.ok).toBe(false);
  });

  it('acepta integer dentro de min', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(schema, intake, [{ path: 'work.qty', value: 3 }], meta);
    expect(result.ok).toBe(true);
  });

  it('rechaza integer por debajo de min', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(schema, intake, [{ path: 'work.qty', value: 0 }], meta);
    expect(result.ok).toBe(false);
  });

  it('acepta declined con motivo', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(
      schema,
      intake,
      [{ path: 'client.phone', declined: true, declined_reason: 'no tiene' }],
      meta,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.intake.client as any).phone.declined).toBe(true);
    expect((result.intake.client as any).phone.declined_reason).toBe('no tiene');
    expect((result.intake.client as any).phone.value).toBeNull();
  });

  it('rechaza declined sin motivo', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(
      schema,
      intake,
      [{ path: 'client.phone', declined: true }],
      meta,
    );
    expect(result.ok).toBe(false);
  });

  it('rechaza value y declined simultáneos', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(
      schema,
      intake,
      [{ path: 'client.phone', value: 'x', declined: true, declined_reason: 'r' }],
      meta,
    );
    expect(result.ok).toBe(false);
  });
});
```

Y los tests específicos de enum:

```ts
describe('bulkUpdate enum', () => {
  it('acepta valor en options', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(schema, intake, [{ path: 'work.service', value: 'reparar' }], meta);
    expect(result.ok).toBe(true);
  });
  it('rechaza valor fuera de options', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const result = bulkUpdate(schema, intake, [{ path: 'work.service', value: 'pintar' }], meta);
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/services/intake.test.ts
```

Expected: bulkUpdate-related tests fail.

- [ ] **Step 3: Extender `src/services/intake.ts`**

Append:

```ts
import { getFieldByPath } from '../config/intake-schema';

export interface IntakeUpdate {
  path: string;
  value?: string | number | boolean;
  declined?: boolean;
  declined_reason?: string;
}

export interface UpdateMeta {
  now: string;
  source_message_id: string | null;
}

export type BulkUpdateResult =
  | { ok: true; intake: IntakeState }
  | { ok: false; error: string };

export function bulkUpdate(
  schema: IntakeSchema,
  intake: IntakeState,
  updates: IntakeUpdate[],
  meta: UpdateMeta,
): BulkUpdateResult {
  if (updates.length === 0) {
    return { ok: false, error: 'updates vacío' };
  }
  const next = structuredClone(intake);

  for (const u of updates) {
    const field = getFieldByPath(schema, u.path);
    if (!field) return { ok: false, error: `path no existe en schema: ${u.path}` };

    const hasValue = u.value !== undefined;
    const isDeclined = u.declined === true;

    if (hasValue && isDeclined) {
      return { ok: false, error: `${u.path}: no se permite value y declined a la vez` };
    }
    if (!hasValue && !isDeclined) {
      return { ok: false, error: `${u.path}: requiere value o declined=true` };
    }
    if (isDeclined && (!u.declined_reason || u.declined_reason.length < 2)) {
      return { ok: false, error: `${u.path}: declined requiere declined_reason` };
    }

    const [sectionKey, fieldKey] = u.path.split('.');
    const section = next[sectionKey] as Record<string, FieldState>;

    if (hasValue) {
      const validationError = validateValueAgainstField(field, u.value!);
      if (validationError) {
        return { ok: false, error: `${u.path}: ${validationError}` };
      }
      section[fieldKey] = {
        value: u.value!,
        asked: true,
        updated_at: meta.now,
        source_message_id: meta.source_message_id ?? undefined,
      };
    } else {
      section[fieldKey] = {
        value: null,
        asked: true,
        declined: true,
        declined_reason: u.declined_reason,
        updated_at: meta.now,
        source_message_id: meta.source_message_id ?? undefined,
      };
    }
  }
  return { ok: true, intake: next };
}

function validateValueAgainstField(
  field: import('../config/intake-schema').IntakeField,
  value: unknown,
): string | null {
  switch (field.type) {
    case 'string':
    case 'text':
    case 'phone':
    case 'date':
      if (typeof value !== 'string' || value.length === 0)
        return `tipo ${field.type} requiere string no vacío`;
      return null;
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value))
        return 'tipo integer requiere número entero';
      if (field.min !== undefined && value < field.min)
        return `valor menor que min=${field.min}`;
      if (field.max !== undefined && value > field.max)
        return `valor mayor que max=${field.max}`;
      return null;
    case 'number':
    case 'currency':
      if (typeof value !== 'number')
        return `tipo ${field.type} requiere número`;
      if (field.min !== undefined && value < field.min)
        return `valor menor que min=${field.min}`;
      if (field.max !== undefined && value > field.max)
        return `valor mayor que max=${field.max}`;
      return null;
    case 'boolean':
      if (typeof value !== 'boolean')
        return 'tipo boolean requiere true/false';
      return null;
    case 'enum':
      if (typeof value !== 'string' || !field.options!.includes(value))
        return `valor no está en options (${field.options!.join(', ')})`;
      return null;
    case 'multi_enum':
      return 'multi_enum no soportado en update directo, usa array fuera del MVP';
    default:
      return `tipo desconocido: ${field.type}`;
  }
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/services/intake.test.ts
```

Expected: 12 passed (los 2 anteriores + 10 nuevos).

- [ ] **Step 5: Commit**

```bash
git add src/services/intake.ts tests/services/intake.test.ts
git commit -m "feat(intake): bulkUpdate con validación contra schema y manejo de declined"
```

---

## Task 9: Intake service — `addFreeNote` e `isComplete`

**Files:**
- Modify: `src/services/intake.ts`
- Modify: `tests/services/intake.test.ts`

- [ ] **Step 1: Agregar tests fallando**

```ts
import { addFreeNote, isIntakeComplete } from '../../src/services/intake';

describe('addFreeNote', () => {
  it('agrega una nota al array', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const next = addFreeNote(intake, 'cliente alérgico al cuero', '2026-05-25T10:00:00Z', 'msg_3');
    expect(next.free_notes).toHaveLength(1);
    expect(next.free_notes[0].text).toBe('cliente alérgico al cuero');
    expect(next.free_notes[0].source_message_id).toBe('msg_3');
  });
});

describe('isIntakeComplete', () => {
  it('false cuando falta un required', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    expect(isIntakeComplete(schema, intake)).toBe(false);
  });

  it('true cuando todos los required tienen valor', () => {
    let intake = createEmptyIntakeFromSchema(schema);
    const r1 = bulkUpdate(schema, intake, [{ path: 'client.name', value: 'María' }], { now: 't', source_message_id: null });
    if (!r1.ok) throw new Error('fail');
    intake = r1.intake;
    const r2 = bulkUpdate(schema, intake, [{ path: 'work.qty', value: 2 }], { now: 't', source_message_id: null });
    if (!r2.ok) throw new Error('fail');
    expect(isIntakeComplete(schema, r2.intake)).toBe(true);
  });

  it('true cuando un required está declined', () => {
    let intake = createEmptyIntakeFromSchema(schema);
    const r1 = bulkUpdate(schema, intake, [{ path: 'client.name', value: 'M' }], { now: 't', source_message_id: null });
    if (!r1.ok) throw new Error('fail');
    const r2 = bulkUpdate(schema, r1.intake, [{ path: 'work.qty', declined: true, declined_reason: 'no sabe' }], { now: 't', source_message_id: null });
    if (!r2.ok) throw new Error('fail');
    expect(isIntakeComplete(schema, r2.intake)).toBe(true);
  });
});
```

- [ ] **Step 2: Implementar en `src/services/intake.ts`**

Append:

```ts
import { listRequiredPaths } from '../config/intake-schema';
import { getByPath } from '../lib/path';

export function addFreeNote(
  intake: IntakeState,
  text: string,
  now: string,
  source_message_id: string | null,
): IntakeState {
  const next = structuredClone(intake);
  next.free_notes = [
    ...next.free_notes,
    { text, added_at: now, source_message_id },
  ];
  return next;
}

export function isIntakeComplete(schema: IntakeSchema, intake: IntakeState): boolean {
  for (const path of listRequiredPaths(schema)) {
    const field = getByPath(intake, path) as FieldState | undefined;
    if (!field) return false;
    const satisfied = field.value !== null || field.declined === true;
    if (!satisfied) return false;
  }
  return true;
}
```

- [ ] **Step 3: Correr tests**

```bash
npm test -- tests/services/intake.test.ts
```

Expected: 16 passed.

- [ ] **Step 4: Commit**

```bash
git add src/services/intake.ts tests/services/intake.test.ts
git commit -m "feat(intake): addFreeNote e isIntakeComplete (acepta declined como satisfecho)"
```

---

## Task 10: Intake service — `renderForModel`

**Files:**
- Modify: `src/services/intake.ts`
- Modify: `tests/services/intake.test.ts`

- [ ] **Step 1: Agregar tests fallando**

```ts
import { renderIntakeForModel } from '../../src/services/intake';

describe('renderIntakeForModel', () => {
  it('renderiza estado vacío con iconos correctos', () => {
    const intake = createEmptyIntakeFromSchema(schema);
    const out = renderIntakeForModel(schema, intake, { jobId: 'j1', status: 'OPEN_INTAKE' });
    expect(out).toContain('job #j1');
    expect(out).toContain('status=OPEN_INTAKE');
    expect(out).toMatch(/✗\s+Nombre/);
    expect(out).toMatch(/○\s+Teléfono/); // opcional
    expect(out).toContain('Pendientes mínimos');
  });

  it('marca campos llenos con ✓', () => {
    let intake = createEmptyIntakeFromSchema(schema);
    const r = bulkUpdate(schema, intake, [{ path: 'client.name', value: 'María' }], {
      now: 't',
      source_message_id: null,
    });
    if (!r.ok) throw new Error('fail');
    const out = renderIntakeForModel(schema, r.intake, { jobId: 'j1', status: 'OPEN_INTAKE' });
    expect(out).toMatch(/✓\s+Nombre: "María"/);
  });

  it('marca campos declinados con ⊘ y razón', () => {
    let intake = createEmptyIntakeFromSchema(schema);
    const r = bulkUpdate(
      schema,
      intake,
      [{ path: 'client.phone', declined: true, declined_reason: 'no tiene' }],
      { now: 't', source_message_id: null },
    );
    if (!r.ok) throw new Error('fail');
    const out = renderIntakeForModel(schema, r.intake, { jobId: 'j1', status: 'OPEN_INTAKE' });
    expect(out).toMatch(/⊘\s+Teléfono.*no tiene/);
  });

  it('incluye contadores de media y free_notes', () => {
    let intake = createEmptyIntakeFromSchema(schema);
    intake.media = { photo_count: 2, audio_count: 1 };
    intake = addFreeNote(intake, 'evento el 15', 't', 'msg');
    const out = renderIntakeForModel(schema, intake, { jobId: 'j1', status: 'OPEN_INTAKE' });
    expect(out).toContain('fotos recibidas: 2');
    expect(out).toContain('audios recibidos: 1');
    expect(out).toContain('evento el 15');
  });
});
```

- [ ] **Step 2: Implementar `renderIntakeForModel`**

Append a `src/services/intake.ts`:

```ts
export interface RenderCtx {
  jobId: string;
  status: string;
}

export function renderIntakeForModel(
  schema: IntakeSchema,
  intake: IntakeState,
  ctx: RenderCtx,
): string {
  const lines: string[] = [];
  lines.push(`=== ESTADO DEL INTAKE (job #${ctx.jobId}, status=${ctx.status}) ===`);

  for (const section of schema.sections) {
    lines.push(`${section.label}:`);
    const sec = intake[section.key] as Record<string, FieldState>;
    for (const field of section.fields) {
      const f = sec?.[field.key];
      const reqMark = field.required ? ' (REQUERIDO)' : '';
      if (!f || (f.value === null && !f.declined)) {
        const icon = field.required ? '✗' : '○';
        const askedNote = f?.asked ? ' [ya preguntado]' : '';
        lines.push(`  ${icon} ${field.label}${reqMark}${askedNote}`);
      } else if (f.declined) {
        lines.push(
          `  ⊘ ${field.label}${reqMark} — declinado: "${f.declined_reason ?? ''}"`,
        );
      } else {
        const v = typeof f.value === 'string' ? `"${f.value}"` : String(f.value);
        lines.push(`  ✓ ${field.label}: ${v}`);
      }
    }
  }

  lines.push(`Media:`);
  lines.push(`  📷 fotos recibidas: ${intake.media.photo_count}`);
  lines.push(`  🎤 audios recibidos: ${intake.media.audio_count}`);

  if (intake.free_notes.length > 0) {
    lines.push(`Notas libres:`);
    for (const n of intake.free_notes) {
      lines.push(`  - ${n.text}`);
    }
  }

  const missing: string[] = [];
  for (const section of schema.sections) {
    const sec = intake[section.key] as Record<string, FieldState>;
    for (const field of section.fields) {
      if (!field.required) continue;
      const f = sec?.[field.key];
      const satisfied = f && (f.value !== null || f.declined === true);
      if (!satisfied) missing.push(`${section.key}.${field.key}`);
    }
  }

  lines.push(
    missing.length === 0
      ? 'Pendientes mínimos para cerrar intake: ninguno (puedes presentar resumen)'
      : `Pendientes mínimos para cerrar intake: ${missing.join(', ')}`,
  );

  return lines.join('\n');
}
```

- [ ] **Step 3: Correr tests**

```bash
npm test -- tests/services/intake.test.ts
```

Expected: 20 passed.

- [ ] **Step 4: Commit**

```bash
git add src/services/intake.ts tests/services/intake.test.ts
git commit -m "feat(intake): renderIntakeForModel con iconografía y pendientes"
```

---

## Task 11: Servicio de contactos

**Files:**
- Create: `src/services/contact.ts`
- Test: `tests/services/contact.test.ts`

- [ ] **Step 1: Escribir tests fallando**

`tests/services/contact.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  upsertContactByPhone,
  setBotActive,
  flagNonIntake,
} from '../../src/services/contact';

const prisma = new PrismaClient();

async function cleanup() {
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
}

describe('contact service', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('upsertContactByPhone crea contacto nuevo con defaults', async () => {
    const c = await upsertContactByPhone(prisma, '+5215555555555');
    expect(c.phoneE164).toBe('+5215555555555');
    expect(c.botActive).toBe(true);
    expect(c.flaggedNonIntake).toBe(false);
  });

  it('upsertContactByPhone es idempotente', async () => {
    const a = await upsertContactByPhone(prisma, '+5215555555555');
    const b = await upsertContactByPhone(prisma, '+5215555555555');
    expect(a.id).toBe(b.id);
  });

  it('setBotActive cambia el flag', async () => {
    const c = await upsertContactByPhone(prisma, '+5215555555555');
    const updated = await setBotActive(prisma, c.id, false);
    expect(updated.botActive).toBe(false);
  });

  it('flagNonIntake marca con razón', async () => {
    const c = await upsertContactByPhone(prisma, '+5215555555555');
    const updated = await flagNonIntake(prisma, c.id, 'spam recurrente');
    expect(updated.flaggedNonIntake).toBe(true);
    expect(updated.flaggedReason).toBe('spam recurrente');
  });
});
```

- [ ] **Step 2: Implementar `src/services/contact.ts`**

```ts
import type { PrismaClient, Contact } from '@prisma/client';

export async function upsertContactByPhone(
  prisma: PrismaClient,
  phoneE164: string,
): Promise<Contact> {
  return prisma.contact.upsert({
    where: { phoneE164 },
    update: {},
    create: { phoneE164 },
  });
}

export async function setBotActive(
  prisma: PrismaClient,
  contactId: string,
  active: boolean,
): Promise<Contact> {
  return prisma.contact.update({
    where: { id: contactId },
    data: { botActive: active },
  });
}

export async function flagNonIntake(
  prisma: PrismaClient,
  contactId: string,
  reason: string,
): Promise<Contact> {
  return prisma.contact.update({
    where: { id: contactId },
    data: { flaggedNonIntake: true, flaggedReason: reason },
  });
}

export async function setDisplayName(
  prisma: PrismaClient,
  contactId: string,
  name: string,
): Promise<Contact> {
  return prisma.contact.update({
    where: { id: contactId },
    data: { displayName: name },
  });
}
```

- [ ] **Step 3: Correr tests**

```bash
npm test -- tests/services/contact.test.ts
```

Expected: 4 passed.

- [ ] **Step 4: Commit**

```bash
git add src/services/contact.ts tests/services/contact.test.ts
git commit -m "feat(contact): upsert, toggle bot, flag non-intake"
```

---

## Task 12: Servicio de jobs — open + transiciones de estado

**Files:**
- Create: `src/services/job.ts`
- Test: `tests/services/job.test.ts`

- [ ] **Step 1: Escribir tests fallando**

`tests/services/job.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { upsertContactByPhone } from '../../src/services/contact';
import {
  openJob,
  markReadyForReview,
  markInProgress,
  closeJob,
  reopenJob,
  findOpenJobsForContact,
} from '../../src/services/job';
import { createEmptyIntakeFromSchema } from '../../src/services/intake';
import type { IntakeSchema } from '../../src/config/intake-schema';

const prisma = new PrismaClient();

const schema: IntakeSchema = {
  $businessName: 'X',
  $businessDomain: 'y',
  $language: 'es-MX',
  sections: [
    {
      key: 'client',
      label: 'C',
      fields: [{ key: 'name', label: 'N', type: 'string', required: true }],
    },
  ],
};

async function cleanup() {
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
}

describe('job service', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('openJob crea job en OPEN_INTAKE con intake vacío', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const job = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    expect(job.status).toBe('OPEN_INTAKE');
    expect(JSON.parse(job.intake).client.name.value).toBeNull();
  });

  it('markReadyForReview transiciona OPEN_INTAKE → READY_FOR_REVIEW', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const job = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    const ready = await markReadyForReview(prisma, job.id, 'Resumen del trabajo');
    expect(ready.status).toBe('READY_FOR_REVIEW');
    expect(ready.summary).toBe('Resumen del trabajo');
    expect(ready.readyAt).not.toBeNull();
  });

  it('markReadyForReview rechaza desde estado no permitido', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const job = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, job.id, 'R');
    await expect(markReadyForReview(prisma, job.id, 'R')).rejects.toThrow();
  });

  it('markInProgress transiciona READY → IN_PROGRESS', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const job = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, job.id, 'R');
    const inProg = await markInProgress(prisma, job.id);
    expect(inProg.status).toBe('IN_PROGRESS');
  });

  it('closeJob cierra desde OPEN_INTAKE o READY pero no IN_PROGRESS', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const job = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    const closed = await closeJob(prisma, job.id);
    expect(closed.status).toBe('CLOSED');
    expect(closed.closedAt).not.toBeNull();
    await expect(closeJob(prisma, job.id)).rejects.toThrow();
  });

  it('closeJob desde IN_PROGRESS falla', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const job = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, job.id, 'R');
    await markInProgress(prisma, job.id);
    await expect(closeJob(prisma, job.id)).rejects.toThrow();
  });

  it('reopenJob lleva un cerrado de vuelta a OPEN_INTAKE', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const job = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await closeJob(prisma, job.id);
    const reopened = await reopenJob(prisma, job.id);
    expect(reopened.status).toBe('OPEN_INTAKE');
  });

  it('findOpenJobsForContact devuelve OPEN_INTAKE + READY_FOR_REVIEW, ignora IN_PROGRESS y CLOSED', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const j1 = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    const j2 = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, j2.id, 'R');
    const j3 = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, j3.id, 'R');
    await markInProgress(prisma, j3.id);
    const j4 = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await closeJob(prisma, j4.id);
    const open = await findOpenJobsForContact(prisma, c.id);
    expect(open.map((j) => j.id).sort()).toEqual([j1.id, j2.id].sort());
  });
});
```

- [ ] **Step 2: Implementar `src/services/job.ts`**

```ts
import type { PrismaClient, Job } from '@prisma/client';
import { ServiceError } from './errors';
import type { IntakeState } from './intake';

export const JOB_STATUS = {
  OPEN: 'OPEN_INTAKE',
  READY: 'READY_FOR_REVIEW',
  IN_PROGRESS: 'IN_PROGRESS',
  CLOSED: 'CLOSED',
} as const;

export async function openJob(
  prisma: PrismaClient,
  contactId: string,
  initialIntake: IntakeState,
): Promise<Job> {
  return prisma.job.create({
    data: {
      contactId,
      status: JOB_STATUS.OPEN,
      intake: JSON.stringify(initialIntake),
    },
  });
}

export async function markReadyForReview(
  prisma: PrismaClient,
  jobId: string,
  summary: string,
): Promise<Job> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new ServiceError(`job ${jobId} no existe`, 'JOB_NOT_FOUND');
  if (job.status !== JOB_STATUS.OPEN) {
    throw new ServiceError(
      `markReadyForReview requiere status=${JOB_STATUS.OPEN}, actual=${job.status}`,
      'INVALID_TRANSITION',
    );
  }
  return prisma.job.update({
    where: { id: jobId },
    data: {
      status: JOB_STATUS.READY,
      summary,
      readyAt: new Date(),
      intakeComplete: true,
    },
  });
}

export async function markInProgress(prisma: PrismaClient, jobId: string): Promise<Job> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new ServiceError(`job ${jobId} no existe`, 'JOB_NOT_FOUND');
  if (job.status !== JOB_STATUS.READY) {
    throw new ServiceError(
      `markInProgress requiere status=${JOB_STATUS.READY}, actual=${job.status}`,
      'INVALID_TRANSITION',
    );
  }
  return prisma.job.update({
    where: { id: jobId },
    data: { status: JOB_STATUS.IN_PROGRESS },
  });
}

export async function closeJob(prisma: PrismaClient, jobId: string): Promise<Job> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new ServiceError(`job ${jobId} no existe`, 'JOB_NOT_FOUND');
  if (job.status !== JOB_STATUS.OPEN && job.status !== JOB_STATUS.READY) {
    throw new ServiceError(
      `closeJob requiere status OPEN_INTAKE o READY_FOR_REVIEW, actual=${job.status}`,
      'INVALID_TRANSITION',
    );
  }
  return prisma.job.update({
    where: { id: jobId },
    data: { status: JOB_STATUS.CLOSED, closedAt: new Date() },
  });
}

export async function reopenJob(prisma: PrismaClient, jobId: string): Promise<Job> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) throw new ServiceError(`job ${jobId} no existe`, 'JOB_NOT_FOUND');
  if (job.status !== JOB_STATUS.CLOSED && job.status !== JOB_STATUS.IN_PROGRESS) {
    throw new ServiceError(
      `reopenJob requiere status CLOSED o IN_PROGRESS, actual=${job.status}`,
      'INVALID_TRANSITION',
    );
  }
  return prisma.job.update({
    where: { id: jobId },
    data: { status: JOB_STATUS.OPEN, closedAt: null, readyAt: null },
  });
}

export async function findOpenJobsForContact(
  prisma: PrismaClient,
  contactId: string,
): Promise<Job[]> {
  return prisma.job.findMany({
    where: {
      contactId,
      status: { in: [JOB_STATUS.OPEN, JOB_STATUS.READY] },
    },
    orderBy: { openedAt: 'asc' },
  });
}

export async function updateJobIntake(
  prisma: PrismaClient,
  jobId: string,
  intake: IntakeState,
): Promise<Job> {
  return prisma.job.update({
    where: { id: jobId },
    data: { intake: JSON.stringify(intake) },
  });
}

export function parseJobIntake(job: Job): IntakeState {
  return JSON.parse(job.intake) as IntakeState;
}
```

- [ ] **Step 3: Correr tests**

```bash
npm test -- tests/services/job.test.ts
```

Expected: 8 passed.

- [ ] **Step 4: Commit**

```bash
git add src/services/job.ts tests/services/job.test.ts
git commit -m "feat(job): máquina de estados, find open, update intake"
```

---

## Task 13: Logger pino y CLI `show-intake`

**Files:**
- Create: `src/lib/logger.ts`
- Create: `src/cli/show-intake.ts`

- [ ] **Step 1: Crear `src/lib/logger.ts`**

```ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
});
```

- [ ] **Step 2: Crear `src/cli/show-intake.ts`**

```ts
#!/usr/bin/env tsx
import { loadConfig, loadProfile } from '../config/loader';
import { getPrisma, disconnectPrisma } from '../storage/client';
import { parseJobIntake } from '../services/job';
import {
  createEmptyIntakeFromSchema,
  renderIntakeForModel,
} from '../services/intake';
import { upsertContactByPhone } from '../services/contact';
import { openJob } from '../services/job';

async function main() {
  const arg = process.argv[2];
  const config = await loadConfig('./config.json');
  const profile = await loadProfile(config.profile);
  const prisma = getPrisma();

  let jobId: string;
  let status: string;

  if (arg === 'demo') {
    // Crea un contacto y un job de demo
    const contact = await upsertContactByPhone(prisma, '+521000000000');
    const job = await openJob(
      prisma,
      contact.id,
      createEmptyIntakeFromSchema(profile.intakeSchema),
    );
    jobId = job.id;
    status = job.status;
    console.log(`Job de demo creado: ${jobId}`);
  } else if (arg) {
    jobId = arg;
    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      console.error(`No existe job ${jobId}`);
      process.exit(1);
    }
    status = job.status;
  } else {
    console.error('Uso: npm run cli:show-intake -- <job_id|demo>');
    process.exit(1);
  }

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  const intake = job ? parseJobIntake(job) : createEmptyIntakeFromSchema(profile.intakeSchema);
  const rendered = renderIntakeForModel(profile.intakeSchema, intake, { jobId, status });
  console.log('\n' + rendered + '\n');
  await disconnectPrisma();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Probar el CLI**

```bash
npm run cli:show-intake -- demo
```

Expected output (algo similar):

```
Job de demo creado: <uuid>

=== ESTADO DEL INTAKE (job #<uuid>, status=OPEN_INTAKE) ===
Cliente:
  ✗ Nombre (REQUERIDO)
  ✗ Ciudad / Zona (REQUERIDO)
  ○ Teléfono alterno
Trabajo:
  ✗ Mueble (REQUERIDO)
  ✗ Tipo de trabajo (REQUERIDO)
  ✗ Cantidad (REQUERIDO)
  ○ Estado actual
...
Media:
  📷 fotos recibidas: 0
  🎤 audios recibidos: 0
Pendientes mínimos para cerrar intake: client.name, client.city_or_zone, work.item_type, work.service_type, work.quantity
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/logger.ts src/cli/show-intake.ts
git commit -m "feat(cli): show-intake para verificar carga de perfil y render de estado"
```

---

## Task 14: Verificación final del Plan 1

- [ ] **Step 1: Correr toda la batería de tests**

```bash
npm test
```

Expected: todos los tests pasan (sanity, path, intake-schema, config, services/intake, services/contact, services/job).

- [ ] **Step 2: Correr typecheck**

```bash
npm run typecheck
```

Expected: sin errores.

- [ ] **Step 3: Correr CLI sobre el job demo y validar manualmente**

```bash
npm run cli:show-intake -- demo
```

Expected: renderiza intake vacío con iconos ✗/○.

- [ ] **Step 4: Borrar archivos de demo de la DB (opcional)**

```bash
npx prisma migrate reset --force
```

- [ ] **Step 5: Commit del estado final si quedó algo**

```bash
git status
# si hay cambios pendientes:
git add -A && git commit -m "chore: fin de Plan 1 - fundación lista"
```

---

## Cobertura del spec en este plan

| Sección del spec | Cubierto por | Estado |
|------------------|--------------|--------|
| §2 Arquitectura — storage, config | Tareas 3, 6 | ✓ MVP base |
| §3 Modelo de datos — todas las tablas | Tarea 3 | ✓ |
| §4 Intake — schema declarativo, runtime con declined/asked/updated_at | Tareas 5, 7, 8, 9, 10 | ✓ |
| §6 Validación runtime de tools (parte intake) | Tarea 8 (`bulkUpdate` rechaza paths/tipos/enums inválidos) | ✓ parcial — el resto en Plan 2 |
| §7 Multi-negocio — perfiles, hot-reload | Tarea 6 (`ConfigCache`) | ✓ |
| Máquina de estados de jobs | Tarea 12 | ✓ |

Lo que **no** está en este plan (queda para planes siguientes):
- Tools del agente y llamadas a OpenRouter (Plan 2).
- Inbound pipeline, debouncer, normalize, Whisper (Plan 3).
- Baileys adapter, outbound, notificaciones al dueño (Plan 4).
- Panel web (Plan 5).
