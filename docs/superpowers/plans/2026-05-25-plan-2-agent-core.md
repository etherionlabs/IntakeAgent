# Plan 2 — Agent-core con OpenRouter SDK

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar el SDK de OpenRouter para correr un turno del agente: construir el system prompt (con plantilla del perfil, business facts, estado del intake inyectado, horarios opcionales), exponer las 6 tools tipadas con Zod y validación runtime, ejecutar el turno con `sendSync()`, persistir la corrida en `agent_runs`.

**Architecture:** Una instancia fresca de `createAgent` por turno. Las tools son closures sobre `TurnContext` (job + contact + servicios). El runner es agnóstico al transporte (no llama a WhatsApp — eso es Plan 3/4); recibe `BatchMessage[]` ya normalizados y devuelve `TurnResult` con texto de respuesta + tool calls auditados + uso/costo. Inyección de dependencias vía factory para testeo sin red.

**Tech Stack:** `@openrouter/sdk`, `zod`, Prisma (tabla `AgentRun`), pino. Sin Baileys, sin Fastify, sin Whisper en este plan.

**Spec de referencia:** [`docs/superpowers/specs/2026-05-25-intake-recepcionista-design.md`](../specs/2026-05-25-intake-recepcionista-design.md) §6.

**Plan anterior:** [`2026-05-25-plan-1-fundacion.md`](2026-05-25-plan-1-fundacion.md). Tipos y servicios del Plan 1 (`IntakeState`, `intakeService.bulkUpdate`, `jobService.markReadyForReview`, etc.) se asumen disponibles.

---

## Estructura de archivos al finalizar este plan

```
src/
├── agent/
│   ├── types.ts                # TurnContext, TurnResult, BatchMessage, AgentDeps, AgentFactory
│   ├── prompt.ts               # buildSystemPrompt, renderUserMessage
│   ├── tools.ts                # buildTools(ctx, deps) — las 6 tools con Zod
│   ├── runner.ts               # runAgentTurn(ctx, deps)
│   └── audit.ts                # recordAgentRun(prisma, run)
├── services/
│   └── notification.ts         # Notifier interface + NoopNotifier
└── cli/
    └── run-turn.ts             # CLI: invoca el runner con SDK stub para inspección manual

tests/
└── agent/
    ├── prompt.test.ts
    ├── tools.test.ts
    ├── runner.test.ts
    └── audit.test.ts
```

---

## Task 1: Instalar SDK + tipos compartidos del agent

**Files:**
- Modify: `package.json` (instala dependencia)
- Create: `src/agent/types.ts`

- [ ] **Step 1: Instalar `@openrouter/sdk`**

```bash
npm install @openrouter/sdk
```

Si la instalación falla, reportar BLOCKED — la skill que cargó el usuario asume que existe el paquete. Si el nombre actual difiere (p. ej. `openrouter-ai/sdk` u otra variante), reportar el nombre real instalado y proceder usando ese.

- [ ] **Step 2: Crear `src/agent/types.ts`**

```ts
import type { PrismaClient, Job, Contact } from '@prisma/client';
import type { Config, Profile } from '../config/schema';
import type { IntakeState } from '../services/intake';

/** Mensaje del cliente ya normalizado por el inbound pipeline (Plan 3). */
export interface BatchMessage {
  id: string;
  kind: 'text' | 'image' | 'audio' | 'sticker' | 'location' | 'other';
  /** Texto del mensaje, transcripción del audio o anotación descriptiva. */
  body: string | null;
  /** Path relativo en media-store si aplica. */
  mediaPath?: string | null;
}

/** Snapshot mínimo de un job abierto para `select_or_open_job`. */
export interface OpenJobSummary {
  id: string;
  summary: string | null;
  openedAt: Date;
}

/** Todo lo que el turno necesita saber sobre el "ahora". */
export interface TurnContext {
  job: Job;
  contact: Contact;
  intake: IntakeState;
  batchMessages: BatchMessage[];
  /** Lista de OTROS jobs abiertos del contacto. Si length>1, `select_or_open_job` se expone. */
  otherOpenJobs: OpenJobSummary[];
  /** Hora actual ISO 8601 (inyectable para tests). */
  now: string;
}

/** Dependencias externas inyectables (DB, notifier, factory del SDK). */
export interface AgentDeps {
  prisma: PrismaClient;
  config: Config;
  profile: Profile;
  notifier: import('../services/notification').Notifier;
  /** Factory del SDK — el runner llama `deps.createAgent({...})`. Permite stub en tests. */
  createAgent: AgentFactory;
}

/** Tipos mínimos del SDK que el runner consume. */
export interface AgentLike {
  on(event: string, handler: (...args: unknown[]) => void): void;
  sendSync(userMessage: string): Promise<AgentResponse>;
}

export interface AgentResponse {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number; costUsd?: number };
}

export interface AgentFactoryConfig {
  apiKey: string;
  model: string;
  instructions: string;
  tools: unknown[];
  maxSteps?: number;
  temperature?: number;
}

export type AgentFactory = (config: AgentFactoryConfig) => AgentLike;

/** Resultado del turno. */
export interface ToolCallRecord {
  name: string;
  args: unknown;
  result: unknown;
  error: string | null;
}

export interface TurnResult {
  responseText: string;
  toolCalls: ToolCallRecord[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  error: string | null;
}
```

- [ ] **Step 3: Verificar typecheck**

```bash
npm run typecheck
```

Si falta `Notifier` (lo creamos en Task 5), TypeScript se quejará. Es esperado — lo arreglaremos al definirlo. Verifica que el único error sea ese; si hay otros, corrige.

Si el único error pendiente es `Notifier`, deja el archivo así por ahora — Task 5 lo resuelve. En su lugar, comenta la línea del notifier provisionalmente:

```ts
  // notifier: import('../services/notification').Notifier;
```

(Y la línea correspondiente en `AgentDeps`.)

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/agent/types.ts
git commit -m "feat(agent): instala @openrouter/sdk y define tipos del agent core"
```

---

## Task 2: Render del user message a partir del batch

**Files:**
- Create: `src/agent/prompt.ts`
- Create: `tests/agent/prompt.test.ts`

- [ ] **Step 1: Escribir tests fallando**

```ts
import { describe, it, expect } from 'vitest';
import { renderUserMessage } from '../../src/agent/prompt';
import type { BatchMessage } from '../../src/agent/types';

describe('renderUserMessage', () => {
  it('renderiza un mensaje de texto simple', () => {
    const batch: BatchMessage[] = [
      { id: 'm1', kind: 'text', body: 'Hola, tengo un sillón' },
    ];
    const out = renderUserMessage(batch);
    expect(out).toContain('[mensaje 1 — texto]');
    expect(out).toContain('Hola, tengo un sillón');
  });

  it('concatena varios mensajes con separación', () => {
    const batch: BatchMessage[] = [
      { id: 'm1', kind: 'text', body: 'Hola' },
      { id: 'm2', kind: 'text', body: 'Tengo un sillón' },
    ];
    const out = renderUserMessage(batch);
    expect(out).toMatch(/\[mensaje 1[^\]]*\][\s\S]*Hola[\s\S]*\[mensaje 2[^\]]*\][\s\S]*Tengo un sillón/);
  });

  it('anota imágenes con su media path', () => {
    const batch: BatchMessage[] = [
      { id: 'm1', kind: 'image', body: null, mediaPath: 'photos/abc.jpg' },
    ];
    const out = renderUserMessage(batch);
    expect(out).toContain('foto recibida');
    expect(out).toContain('photos/abc.jpg');
  });

  it('anota audios transcritos mostrando la transcripción', () => {
    const batch: BatchMessage[] = [
      { id: 'm1', kind: 'audio', body: 'me llamo Juan', mediaPath: 'audio/x.ogg' },
    ];
    const out = renderUserMessage(batch);
    expect(out).toContain('audio transcrito');
    expect(out).toContain('me llamo Juan');
  });

  it('describe tipos no soportados con fallback', () => {
    const batch: BatchMessage[] = [
      { id: 'm1', kind: 'sticker', body: null },
    ];
    const out = renderUserMessage(batch);
    expect(out).toContain('sticker');
    expect(out).toContain('no soportado');
  });

  it('arroja si el batch está vacío', () => {
    expect(() => renderUserMessage([])).toThrow();
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/agent/prompt.test.ts
```

Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar `renderUserMessage` en `src/agent/prompt.ts`**

```ts
import type { BatchMessage } from './types';

export function renderUserMessage(batch: BatchMessage[]): string {
  if (batch.length === 0) {
    throw new Error('renderUserMessage: batch vacío');
  }
  const parts: string[] = [];
  batch.forEach((m, idx) => {
    const n = idx + 1;
    switch (m.kind) {
      case 'text':
        parts.push(`[mensaje ${n} — texto]\n${m.body ?? ''}`);
        break;
      case 'image':
        parts.push(
          `[mensaje ${n} — foto recibida]\n(imagen guardada en ${m.mediaPath ?? 'desconocido'})`,
        );
        break;
      case 'audio':
        parts.push(
          `[mensaje ${n} — audio transcrito]\n${m.body ?? '(sin transcripción)'}\n(archivo: ${m.mediaPath ?? 'desconocido'})`,
        );
        break;
      case 'sticker':
      case 'location':
      case 'other':
      default:
        parts.push(`[mensaje ${n} — ${m.kind} no soportado]\n${m.body ?? ''}`);
        break;
    }
  });
  return parts.join('\n\n');
}
```

- [ ] **Step 4: Verificar pasan**

```bash
npm test -- tests/agent/prompt.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompt.ts tests/agent/prompt.test.ts
git commit -m "feat(agent): renderUserMessage para concatenar el batch del cliente"
```

---

## Task 3: Bloques auxiliares del system prompt (business facts, multi-jobs, horario)

**Files:**
- Modify: `src/agent/prompt.ts`
- Modify: `tests/agent/prompt.test.ts`

- [ ] **Step 1: Agregar tests**

Append a `tests/agent/prompt.test.ts`:

```ts
import {
  buildBusinessFactsBlock,
  buildOpenJobsBlock,
  buildHoursBlock,
} from '../../src/agent/prompt';
import type { BusinessFacts, Config } from '../../src/config/schema';
import type { OpenJobSummary } from '../../src/agent/types';

const sampleFacts: BusinessFacts = {
  facts: [
    { topic: 'ubicación', aliases: ['dirección'], answer: 'Av. Reforma 123' },
    { topic: 'horarios', aliases: [], answer: 'L-V 9-19h' },
  ],
  freeContext: 'No hacemos colchones.',
};

describe('buildBusinessFactsBlock', () => {
  it('renderiza facts y free context', () => {
    const out = buildBusinessFactsBlock(sampleFacts, 'Tapicería Demo');
    expect(out).toContain('=== INFORMACIÓN DEL NEGOCIO ===');
    expect(out).toContain('Tapicería Demo');
    expect(out).toContain('ubicación');
    expect(out).toContain('Av. Reforma 123');
    expect(out).toContain('No hacemos colchones.');
  });

  it('omite la sección de free context si está vacía', () => {
    const out = buildBusinessFactsBlock({ ...sampleFacts, freeContext: '' }, 'X');
    expect(out).not.toContain('Contexto general:');
  });

  it('omite la sección de hechos si no hay ninguno', () => {
    const out = buildBusinessFactsBlock({ facts: [], freeContext: 'Algo' }, 'X');
    expect(out).not.toContain('Hechos clave');
    expect(out).toContain('Algo');
  });
});

describe('buildOpenJobsBlock', () => {
  it('devuelve cadena vacía si hay 0 ó 1 otros jobs', () => {
    expect(buildOpenJobsBlock([])).toBe('');
    expect(
      buildOpenJobsBlock([
        { id: 'a', summary: 's', openedAt: new Date('2026-05-01') },
      ]),
    ).toBe('');
  });

  it('lista los jobs cuando hay 2 o más', () => {
    const out = buildOpenJobsBlock([
      { id: 'a', summary: 'sillón verde', openedAt: new Date('2026-05-01') },
      { id: 'b', summary: 'cabecera', openedAt: new Date('2026-05-10') },
    ]);
    expect(out).toContain('JOBS ABIERTOS MÚLTIPLES');
    expect(out).toContain('a');
    expect(out).toContain('sillón verde');
    expect(out).toContain('cabecera');
  });
});

describe('buildHoursBlock', () => {
  const cfgDisabled: Pick<Config, 'hours'> = {
    hours: { enabled: false, timezone: 'America/Mexico_City', schedule: {}, outOfHoursNotice: '' },
  };
  const cfgEnabled: Pick<Config, 'hours'> = {
    hours: {
      enabled: true,
      timezone: 'America/Mexico_City',
      schedule: {
        mon: ['09:00', '19:00'],
        tue: ['09:00', '19:00'],
        wed: ['09:00', '19:00'],
        thu: ['09:00', '19:00'],
        fri: ['09:00', '19:00'],
        sat: ['10:00', '14:00'],
        sun: null,
      },
      outOfHoursNotice: 'Fuera de horario, te respondo mañana.',
    },
  };

  it('devuelve cadena vacía si hours.enabled=false', () => {
    expect(buildHoursBlock(cfgDisabled as Config, new Date('2026-05-25T20:00:00-06:00'))).toBe('');
  });

  it('reconoce dentro de horario y NO sugiere out-of-hours', () => {
    // Lunes 11:00 hora local CDMX (UTC-6)
    const out = buildHoursBlock(cfgEnabled as Config, new Date('2026-05-25T17:00:00Z'));
    expect(out).toContain('HORARIO ACTUAL');
    expect(out).toContain('dentro de horario');
    expect(out).not.toContain('Fuera de horario');
  });

  it('reconoce fuera de horario y sugiere el aviso', () => {
    // Lunes 22:00 hora local CDMX (UTC-6)
    const out = buildHoursBlock(cfgEnabled as Config, new Date('2026-05-26T04:00:00Z'));
    expect(out).toContain('fuera de horario');
    expect(out).toContain('Fuera de horario, te respondo mañana.');
  });

  it('reconoce día cerrado (schedule = null) como fuera de horario', () => {
    // Domingo 12:00 hora local CDMX
    const out = buildHoursBlock(cfgEnabled as Config, new Date('2026-05-24T18:00:00Z'));
    expect(out).toContain('fuera de horario');
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/agent/prompt.test.ts
```

Expected: 6 anteriores pasan, 10 nuevos fallan.

- [ ] **Step 3: Implementar en `src/agent/prompt.ts`**

Append:

```ts
import type { BusinessFacts, Config } from '../config/schema';
import type { OpenJobSummary } from './types';

export function buildBusinessFactsBlock(facts: BusinessFacts, businessName: string): string {
  const lines: string[] = [];
  lines.push('=== INFORMACIÓN DEL NEGOCIO ===');
  lines.push(`[${businessName}]`);
  if (facts.facts.length > 0) {
    lines.push('');
    lines.push('Hechos clave (úsalos solo si el cliente pregunta sobre ellos):');
    for (const f of facts.facts) {
      lines.push(`- ${f.topic}: ${f.answer}`);
    }
  }
  if (facts.freeContext && facts.freeContext.trim().length > 0) {
    lines.push('');
    lines.push('Contexto general:');
    lines.push(facts.freeContext);
  }
  return lines.join('\n');
}

export function buildOpenJobsBlock(otherOpenJobs: OpenJobSummary[]): string {
  if (otherOpenJobs.length < 2) return '';
  const lines: string[] = [];
  lines.push('=== JOBS ABIERTOS MÚLTIPLES ===');
  lines.push(
    `Hay ${otherOpenJobs.length} jobs abiertos para este contacto. Decide a cuál pertenece el mensaje o abre uno nuevo usando la tool select_or_open_job.`,
  );
  for (const j of otherOpenJobs) {
    const date = j.openedAt.toISOString().slice(0, 10);
    lines.push(`- ${j.id} (abierto ${date}): ${j.summary ?? 'sin resumen aún'}`);
  }
  return lines.join('\n');
}

type DayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
const DAY_KEYS: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function buildHoursBlock(config: Config, now: Date): string {
  const h = config.hours;
  if (!h.enabled) return '';

  // Toma la hora en la zona horaria configurada usando Intl.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: h.timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value.toLowerCase() ?? '';
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  // weekday viene como "mon", "tue"... que ya coincide con nuestras keys.
  const dayKey = weekday as DayKey;
  const range = h.schedule[dayKey];

  const lines: string[] = [];
  lines.push('=== HORARIO ACTUAL ===');
  lines.push(`Día/hora local (${h.timezone}): ${dayKey} ${hour}:${minute}`);

  let withinHours = false;
  if (range && DAY_KEYS.includes(dayKey)) {
    const [start, end] = range;
    const cur = `${hour}:${minute}`;
    withinHours = cur >= start && cur <= end;
  }

  if (withinHours) {
    lines.push('Estás dentro de horario.');
  } else {
    lines.push('Estás fuera de horario.');
    if (h.outOfHoursNotice) {
      lines.push(`Aviso configurado: ${h.outOfHoursNotice}`);
    }
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/agent/prompt.test.ts
```

Expected: 16 passed.

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompt.ts tests/agent/prompt.test.ts
git commit -m "feat(agent): bloques business-facts, multi-jobs y horarios para el system prompt"
```

---

## Task 4: `buildSystemPrompt` — composición completa

**Files:**
- Modify: `src/agent/prompt.ts`
- Modify: `tests/agent/prompt.test.ts`

- [ ] **Step 1: Agregar tests**

Append a `tests/agent/prompt.test.ts`:

```ts
import { buildSystemPrompt } from '../../src/agent/prompt';
import { createEmptyIntakeFromSchema, bulkUpdate } from '../../src/services/intake';
import type { Profile, Config } from '../../src/config/schema';
import type { IntakeSchema } from '../../src/config/intake-schema';

const intakeSchema: IntakeSchema = {
  $businessName: 'Tapicería Demo',
  $businessDomain: 'tapicería',
  $language: 'es-MX',
  sections: [
    {
      key: 'client',
      label: 'Cliente',
      fields: [{ key: 'name', label: 'Nombre', type: 'string', required: true }],
    },
  ],
};

const profile: Profile = {
  intakeSchema,
  promptVars: {
    promptTemplate:
      'Eres asistente de **{{businessName}}**, negocio de {{businessDomain}}.\n## Tono\n{{tone}}\n## Reglas\n{{rules}}',
    vars: { tone: 'Cercano', rules: 'No inventes precios.' },
  },
  businessFacts: sampleFacts,
  welcome: 'hola',
  hash: 'abc',
};

const cfg: Pick<Config, 'hours'> = {
  hours: { enabled: false, timezone: 'America/Mexico_City', schedule: {}, outOfHoursNotice: '' },
};

describe('buildSystemPrompt', () => {
  it('compone plantilla + facts + intake + (sin jobs múltiples) + (sin horario)', () => {
    const intake = createEmptyIntakeFromSchema(intakeSchema);
    const out = buildSystemPrompt({
      profile,
      config: cfg as Config,
      intake,
      jobId: 'j1',
      jobStatus: 'OPEN_INTAKE',
      otherOpenJobs: [],
      now: new Date('2026-05-25T18:00:00Z'),
    });
    // template aplicado
    expect(out).toContain('Tapicería Demo');
    expect(out).toContain('tapicería');
    expect(out).toContain('Cercano');
    expect(out).toContain('No inventes precios.');
    // business facts
    expect(out).toContain('INFORMACIÓN DEL NEGOCIO');
    expect(out).toContain('Av. Reforma 123');
    // intake state
    expect(out).toContain('ESTADO DEL INTAKE');
    expect(out).toContain('job #j1');
    // sin bloques opcionales
    expect(out).not.toContain('JOBS ABIERTOS MÚLTIPLES');
    expect(out).not.toContain('HORARIO ACTUAL');
  });

  it('incluye bloque de jobs múltiples cuando hay 2+', () => {
    const intake = createEmptyIntakeFromSchema(intakeSchema);
    const out = buildSystemPrompt({
      profile,
      config: cfg as Config,
      intake,
      jobId: 'j1',
      jobStatus: 'OPEN_INTAKE',
      otherOpenJobs: [
        { id: 'a', summary: 'sillón', openedAt: new Date('2026-05-01') },
        { id: 'b', summary: 'silla', openedAt: new Date('2026-05-02') },
      ],
      now: new Date('2026-05-25T18:00:00Z'),
    });
    expect(out).toContain('JOBS ABIERTOS MÚLTIPLES');
    expect(out).toContain('sillón');
    expect(out).toContain('silla');
  });

  it('sustituye {{var}} desconocida con cadena vacía', () => {
    const profileWithMissingVar: Profile = {
      ...profile,
      promptVars: {
        promptTemplate: 'Hola {{businessName}} y {{noExiste}}',
        vars: {},
      },
    };
    const intake = createEmptyIntakeFromSchema(intakeSchema);
    const out = buildSystemPrompt({
      profile: profileWithMissingVar,
      config: cfg as Config,
      intake,
      jobId: 'j1',
      jobStatus: 'OPEN_INTAKE',
      otherOpenJobs: [],
      now: new Date('2026-05-25T18:00:00Z'),
    });
    expect(out).toContain('Hola Tapicería Demo y ');
    expect(out).not.toContain('{{noExiste}}');
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/agent/prompt.test.ts
```

Expected: 16 anteriores pasan, 3 nuevos fallan.

- [ ] **Step 3: Implementar `buildSystemPrompt`**

Append a `src/agent/prompt.ts`:

```ts
import type { Profile } from '../config/schema';
import type { IntakeState } from '../services/intake';
import { renderIntakeForModel } from '../services/intake';

export interface BuildSystemPromptArgs {
  profile: Profile;
  config: Config;
  intake: IntakeState;
  jobId: string;
  jobStatus: string;
  otherOpenJobs: OpenJobSummary[];
  now: Date;
}

export function buildSystemPrompt(args: BuildSystemPromptArgs): string {
  const { profile, config, intake, jobId, jobStatus, otherOpenJobs, now } = args;

  // 1. Aplicar plantilla con variables. {{businessName}} y {{businessDomain}} vienen del schema.
  const allVars: Record<string, string> = {
    businessName: profile.intakeSchema.$businessName,
    businessDomain: profile.intakeSchema.$businessDomain,
    ...profile.promptVars.vars,
  };
  const baseTemplate = profile.promptVars.promptTemplate.replace(
    /\{\{(\w+)\}\}/g,
    (_, key) => allVars[key] ?? '',
  );

  // 2. Componer bloques opcionales.
  const facts = buildBusinessFactsBlock(
    profile.businessFacts,
    profile.intakeSchema.$businessName,
  );
  const intakeBlock = renderIntakeForModel(profile.intakeSchema, intake, {
    jobId,
    status: jobStatus,
  });
  const openJobs = buildOpenJobsBlock(otherOpenJobs);
  const hours = buildHoursBlock(config, now);

  // 3. Unir con separadores.
  return [baseTemplate, facts, intakeBlock, openJobs, hours]
    .filter((s) => s.length > 0)
    .join('\n\n');
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/agent/prompt.test.ts
```

Expected: 19 passed.

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompt.ts tests/agent/prompt.test.ts
git commit -m "feat(agent): buildSystemPrompt compone plantilla, facts, intake y bloques opcionales"
```

---

## Task 5: Notifier interface + `NoopNotifier`

**Files:**
- Create: `src/services/notification.ts`
- Create: `tests/services/notification.test.ts`

- [ ] **Step 1: Escribir tests**

```ts
import { describe, it, expect } from 'vitest';
import { NoopNotifier } from '../../src/services/notification';

describe('NoopNotifier', () => {
  it('notifyOwnerReady no arroja y guarda el evento en memoria', async () => {
    const n = new NoopNotifier();
    await n.notifyOwnerReady({
      jobId: 'j1',
      contactDisplayName: 'María',
      contactPhone: '+521',
      summary: 'Sillón a retapizar',
      panelUrl: 'http://localhost:3000',
    });
    expect(n.history).toHaveLength(1);
    expect(n.history[0].kind).toBe('owner_ready');
    expect(n.history[0].payload.jobId).toBe('j1');
  });

  it('notifyDisconnect agrega entrada con kind disconnect_alert', async () => {
    const n = new NoopNotifier();
    await n.notifyDisconnect({ reason: 'session expired' });
    expect(n.history).toHaveLength(1);
    expect(n.history[0].kind).toBe('disconnect_alert');
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/services/notification.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/services/notification.ts`**

```ts
export interface OwnerReadyPayload {
  jobId: string;
  contactDisplayName: string | null;
  contactPhone: string;
  summary: string;
  panelUrl: string;
}

export interface DisconnectPayload {
  reason: string;
}

export interface Notifier {
  notifyOwnerReady(payload: OwnerReadyPayload): Promise<void>;
  notifyDisconnect(payload: DisconnectPayload): Promise<void>;
}

export interface NotificationEvent {
  kind: 'owner_ready' | 'disconnect_alert';
  payload: OwnerReadyPayload | DisconnectPayload;
  at: Date;
}

/** Notifier que no envía nada — sólo registra en memoria. Útil en Plan 2 y en tests. */
export class NoopNotifier implements Notifier {
  readonly history: NotificationEvent[] = [];

  async notifyOwnerReady(payload: OwnerReadyPayload): Promise<void> {
    this.history.push({ kind: 'owner_ready', payload, at: new Date() });
  }

  async notifyDisconnect(payload: DisconnectPayload): Promise<void> {
    this.history.push({ kind: 'disconnect_alert', payload, at: new Date() });
  }
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/services/notification.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Restaurar la línea `notifier` en `src/agent/types.ts` si la dejaste comentada en Task 1**

Asegúrate de que `AgentDeps` incluya:

```ts
  notifier: import('../services/notification').Notifier;
```

Corre `npm run typecheck` y confirma cero errores.

- [ ] **Step 6: Commit**

```bash
git add src/services/notification.ts tests/services/notification.test.ts src/agent/types.ts
git commit -m "feat(notification): Notifier interface y NoopNotifier para tests"
```

---

## Task 6: Persistencia — `recordAgentRun`

**Files:**
- Create: `src/agent/audit.ts`
- Create: `tests/agent/audit.test.ts`

- [ ] **Step 1: Escribir tests**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { upsertContactByPhone } from '../../src/services/contact';
import { openJob } from '../../src/services/job';
import { createEmptyIntakeFromSchema } from '../../src/services/intake';
import { recordAgentRun } from '../../src/agent/audit';
import type { IntakeSchema } from '../../src/config/intake-schema';

const adapter = new PrismaBetterSqlite3({ url: 'file:./data/intake.db' });
const prisma = new PrismaClient({ adapter });

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

describe('recordAgentRun', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('persiste un agent run con tool calls y uso', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const j = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    const run = await recordAgentRun(prisma, {
      jobId: j.id,
      triggerMessageIds: ['m1', 'm2'],
      model: 'anthropic/claude-sonnet-4-6',
      inputTokens: 1234,
      outputTokens: 56,
      costUsd: 0.0042,
      toolCalls: [{ name: 'update_intake', args: { fields: [] }, result: { ok: true }, error: null }],
      responseText: 'Hola, dime tu nombre.',
      configHash: 'abc123',
      error: null,
    });
    expect(run.id).toBeDefined();
    expect(run.inputTokens).toBe(1234);
    const parsed = JSON.parse(run.toolCalls);
    expect(parsed[0].name).toBe('update_intake');
  });

  it('acepta error string y ningún tool call', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const j = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    const run = await recordAgentRun(prisma, {
      jobId: j.id,
      triggerMessageIds: ['m1'],
      model: 'anthropic/claude-sonnet-4-6',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
      toolCalls: [],
      responseText: null,
      configHash: 'abc',
      error: 'rate limit',
    });
    expect(run.error).toBe('rate limit');
    expect(run.responseText).toBeNull();
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/agent/audit.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/agent/audit.ts`**

```ts
import type { PrismaClient, AgentRun } from '@prisma/client';
import type { ToolCallRecord } from './types';

export interface AgentRunInput {
  jobId: string;
  triggerMessageIds: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
  toolCalls: ToolCallRecord[];
  responseText: string | null;
  configHash: string;
  error: string | null;
}

export async function recordAgentRun(
  prisma: PrismaClient,
  input: AgentRunInput,
): Promise<AgentRun> {
  return prisma.agentRun.create({
    data: {
      jobId: input.jobId,
      triggerMessageIds: JSON.stringify(input.triggerMessageIds),
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costUsd: input.costUsd ?? null,
      toolCalls: JSON.stringify(input.toolCalls),
      responseText: input.responseText,
      configHash: input.configHash,
      error: input.error,
    },
  });
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/agent/audit.test.ts
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/agent/audit.ts tests/agent/audit.test.ts
git commit -m "feat(agent): recordAgentRun persiste cada turno con tool calls y uso"
```

---

## Task 7: Tool `update_intake`

**Files:**
- Create: `src/agent/tools.ts`
- Create: `tests/agent/tools.test.ts`

- [ ] **Step 1: Escribir tests**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { upsertContactByPhone } from '../../src/services/contact';
import { openJob } from '../../src/services/job';
import {
  createEmptyIntakeFromSchema,
  type IntakeState,
} from '../../src/services/intake';
import { buildUpdateIntakeTool } from '../../src/agent/tools';
import type { IntakeSchema } from '../../src/config/intake-schema';
import { NoopNotifier } from '../../src/services/notification';

const adapter = new PrismaBetterSqlite3({ url: 'file:./data/intake.db' });
const prisma = new PrismaClient({ adapter });

const schema: IntakeSchema = {
  $businessName: 'X',
  $businessDomain: 'y',
  $language: 'es-MX',
  sections: [
    {
      key: 'client',
      label: 'C',
      fields: [
        { key: 'name', label: 'Nombre', type: 'string', required: true },
        { key: 'phone', label: 'Tel', type: 'phone', required: false },
      ],
    },
  ],
};

async function setupCtx() {
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
  const c = await upsertContactByPhone(prisma, '+521');
  const j = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
  const intake: IntakeState = createEmptyIntakeFromSchema(schema);
  return {
    job: j,
    contact: c,
    intake,
    batchMessages: [{ id: 'm1', kind: 'text' as const, body: 'hola' }],
    otherOpenJobs: [],
    now: '2026-05-25T10:00:00Z',
  };
}

afterAll(async () => {
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.$disconnect();
});

describe('tool update_intake', () => {
  it('actualiza un campo válido y persiste en la DB', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema } as any;
    const tool = buildUpdateIntakeTool(ctx, { prisma, profile, notifier: new NoopNotifier() } as any);
    const out = await tool.execute({ fields: [{ path: 'client.name', value: 'María' }] });
    expect(out.ok).toBe(true);
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    const intake = JSON.parse(reload!.intake);
    expect(intake.client.name.value).toBe('María');
    expect(intake.client.name.source_message_id).toBe('m1');
  });

  it('agrega notas libres', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema } as any;
    const tool = buildUpdateIntakeTool(ctx, { prisma, profile, notifier: new NoopNotifier() } as any);
    const out = await tool.execute({
      fields: [{ path: 'client.name', value: 'X' }],
      notes_to_add: ['cliente vive en zona alta'],
    });
    expect(out.ok).toBe(true);
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    const intake = JSON.parse(reload!.intake);
    expect(intake.free_notes).toHaveLength(1);
    expect(intake.free_notes[0].text).toBe('cliente vive en zona alta');
  });

  it('retorna error sin persistir si el path es inválido', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema } as any;
    const tool = buildUpdateIntakeTool(ctx, { prisma, profile, notifier: new NoopNotifier() } as any);
    const out = await tool.execute({ fields: [{ path: 'nope.x', value: 'y' }] });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/no existe/i);
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    const intake = JSON.parse(reload!.intake);
    expect(intake.client.name.value).toBeNull();
  });

  it('acepta declined con motivo', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema } as any;
    const tool = buildUpdateIntakeTool(ctx, { prisma, profile, notifier: new NoopNotifier() } as any);
    const out = await tool.execute({
      fields: [{ path: 'client.phone', declined: true, declined_reason: 'no tiene fijo' }],
    });
    expect(out.ok).toBe(true);
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    const intake = JSON.parse(reload!.intake);
    expect(intake.client.phone.declined).toBe(true);
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/agent/tools.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/agent/tools.ts` (versión inicial)**

```ts
import { z } from 'zod';
import type { TurnContext, AgentDeps } from './types';
import { bulkUpdate, addFreeNote, type IntakeState } from '../services/intake';
import { updateJobIntake } from '../services/job';

/** Forma común a todas las tools del agent. Compatible con @openrouter/sdk `tool()`. */
export interface AgentTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (args: any) => Promise<{ ok: true; [k: string]: unknown } | { ok: false; error: string }>;
}

const UpdateIntakeArgsZ = z
  .object({
    fields: z
      .array(
        z
          .object({
            path: z.string(),
            value: z.union([z.string(), z.number(), z.boolean()]).optional(),
            declined: z.boolean().optional(),
            declined_reason: z.string().optional(),
          })
          .refine(
            (d) => d.value !== undefined || d.declined === true,
            { message: 'cada campo debe traer value o declined=true' },
          ),
      )
      .min(1),
    notes_to_add: z.array(z.string().min(3).max(500)).optional(),
  });

export type UpdateIntakeArgs = z.infer<typeof UpdateIntakeArgsZ>;

export function buildUpdateIntakeTool(
  ctx: TurnContext,
  deps: Pick<AgentDeps, 'prisma' | 'profile'>,
): AgentTool {
  return {
    name: 'update_intake',
    description:
      'Guarda valores y/o marca campos como declinados por el cliente. Agrupa TODOS los cambios del turno en una sola llamada. Usa notes_to_add para detalles que no caben en campos.',
    inputSchema: UpdateIntakeArgsZ,
    execute: async (rawArgs) => {
      const parse = UpdateIntakeArgsZ.safeParse(rawArgs);
      if (!parse.success) {
        return { ok: false, error: `args inválidos: ${parse.error.message}` };
      }
      const args = parse.data;

      const sourceMessageId = ctx.batchMessages[ctx.batchMessages.length - 1]?.id ?? null;
      const meta = { now: ctx.now, source_message_id: sourceMessageId };

      const result = bulkUpdate(deps.profile.intakeSchema, ctx.intake, args.fields, meta);
      if (!result.ok) return { ok: false, error: result.error };

      let nextIntake: IntakeState = result.intake;
      if (args.notes_to_add) {
        for (const note of args.notes_to_add) {
          nextIntake = addFreeNote(nextIntake, note, ctx.now, sourceMessageId);
        }
      }

      await updateJobIntake(deps.prisma, ctx.job.id, nextIntake);
      ctx.intake = nextIntake;
      return { ok: true, updated_fields: args.fields.length };
    },
  };
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/agent/tools.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools.ts tests/agent/tools.test.ts
git commit -m "feat(agent): tool update_intake con validación contra schema y persistencia"
```

---

## Task 8: Tool `mark_ready_for_review`

**Files:**
- Modify: `src/agent/tools.ts`
- Modify: `tests/agent/tools.test.ts`

- [ ] **Step 1: Agregar tests**

Append a `tests/agent/tools.test.ts`:

```ts
import { buildMarkReadyTool } from '../../src/agent/tools';
import { bulkUpdate } from '../../src/services/intake';

describe('tool mark_ready_for_review', () => {
  it('rechaza si faltan campos requeridos', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema, hash: 'h' } as any;
    const notifier = new NoopNotifier();
    const tool = buildMarkReadyTool(ctx, { prisma, profile, notifier, config: { owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'http://x' } } } as any);
    const out = await tool.execute({ summary: 'Trabajo de retapizado para sillón' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/requerido/i);
  });

  it('cuando los requeridos están satisfechos transiciona el job a READY y dispara notifier', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema, hash: 'h' } as any;
    // Llenar required
    const filled = bulkUpdate(schema, ctx.intake, [{ path: 'client.name', value: 'María' }], {
      now: ctx.now,
      source_message_id: 'm1',
    });
    if (!filled.ok) throw new Error('fail');
    ctx.intake = filled.intake;
    await prisma.job.update({ where: { id: ctx.job.id }, data: { intake: JSON.stringify(filled.intake) } });

    const notifier = new NoopNotifier();
    const tool = buildMarkReadyTool(ctx, {
      prisma,
      profile,
      notifier,
      config: {
        owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'http://x' },
      },
    } as any);

    const out = await tool.execute({ summary: 'Retapizado de sillón 3 plazas para María en Polanco.' });
    expect(out.ok).toBe(true);
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    expect(reload!.status).toBe('READY_FOR_REVIEW');
    expect(reload!.summary).toContain('Retapizado');
    expect(notifier.history).toHaveLength(1);
    expect(notifier.history[0].kind).toBe('owner_ready');
  });

  it('rechaza summary demasiado corto', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema, hash: 'h' } as any;
    const tool = buildMarkReadyTool(ctx, { prisma, profile, notifier: new NoopNotifier(), config: { owner: { phoneE164: '+5215', notifyOnReady: false, notifyOnDisconnect: false, panelUrl: 'x' } } } as any);
    const out = await tool.execute({ summary: 'corto' });
    expect(out.ok).toBe(false);
  });

  it('no notifica si owner.notifyOnReady=false (pero sí transiciona el job)', async () => {
    const ctx = await setupCtx();
    const profile = { intakeSchema: schema, hash: 'h' } as any;
    const filled = bulkUpdate(schema, ctx.intake, [{ path: 'client.name', value: 'X' }], { now: ctx.now, source_message_id: 'm1' });
    if (!filled.ok) throw new Error('fail');
    ctx.intake = filled.intake;
    await prisma.job.update({ where: { id: ctx.job.id }, data: { intake: JSON.stringify(filled.intake) } });

    const notifier = new NoopNotifier();
    const tool = buildMarkReadyTool(ctx, {
      prisma, profile, notifier,
      config: { owner: { phoneE164: '+5215', notifyOnReady: false, notifyOnDisconnect: true, panelUrl: 'x' } },
    } as any);

    const out = await tool.execute({ summary: 'Resumen largo para revisión del dueño.' });
    expect(out.ok).toBe(true);
    expect(notifier.history).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/agent/tools.test.ts
```

Expected: 4 anteriores pasan, 4 nuevos fallan.

- [ ] **Step 3: Implementar `buildMarkReadyTool`**

Append a `src/agent/tools.ts`:

```ts
import { markReadyForReview, JOB_STATUS } from '../services/job';
import { isIntakeComplete } from '../services/intake';
import type { Config, Profile } from '../config/schema';
import type { Notifier } from '../services/notification';

const MarkReadyArgsZ = z.object({
  summary: z.string().min(20, 'summary debe tener al menos 20 caracteres'),
});

export interface MarkReadyDeps {
  prisma: AgentDeps['prisma'];
  profile: Profile;
  notifier: Notifier;
  config: Config;
}

export function buildMarkReadyTool(
  ctx: TurnContext,
  deps: MarkReadyDeps,
): AgentTool {
  return {
    name: 'mark_ready_for_review',
    description:
      'Llama esto SOLO cuando todos los campos REQUERIDOS estén satisfechos (con valor o declined) y el cliente confirme el resumen. Cambia el job a READY_FOR_REVIEW y notifica al dueño.',
    inputSchema: MarkReadyArgsZ,
    execute: async (rawArgs) => {
      const parse = MarkReadyArgsZ.safeParse(rawArgs);
      if (!parse.success) return { ok: false, error: `args inválidos: ${parse.error.message}` };

      // Validación runtime: job debe estar en OPEN_INTAKE
      if (ctx.job.status !== JOB_STATUS.OPEN) {
        return {
          ok: false,
          error: `mark_ready_for_review requiere job en OPEN_INTAKE, actual=${ctx.job.status}`,
        };
      }

      // Validación runtime: campos requeridos satisfechos
      if (!isIntakeComplete(deps.profile.intakeSchema, ctx.intake)) {
        return {
          ok: false,
          error: 'aún hay campos REQUERIDOS sin satisfacer (value o declined). Sigue preguntando.',
        };
      }

      const summary = parse.data.summary;
      const updated = await markReadyForReview(deps.prisma, ctx.job.id, summary);

      if (deps.config.owner.notifyOnReady) {
        await deps.notifier.notifyOwnerReady({
          jobId: updated.id,
          contactDisplayName: ctx.contact.displayName,
          contactPhone: ctx.contact.phoneE164,
          summary,
          panelUrl: deps.config.owner.panelUrl,
        });
      }

      // Reflejar el cambio en el ctx para que el resto del turno lo vea
      ctx.job.status = updated.status;
      ctx.job.summary = updated.summary;

      return { ok: true, status: 'READY_FOR_REVIEW' };
    },
  };
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/agent/tools.test.ts
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools.ts tests/agent/tools.test.ts
git commit -m "feat(agent): tool mark_ready_for_review con validación runtime y notifier"
```

---

## Task 9: Tools `close_job`, `flag_non_intake`, `request_photo`

**Files:**
- Modify: `src/agent/tools.ts`
- Modify: `tests/agent/tools.test.ts`

- [ ] **Step 1: Agregar tests**

Append:

```ts
import { buildCloseJobTool, buildFlagNonIntakeTool, buildRequestPhotoTool } from '../../src/agent/tools';

describe('tool close_job', () => {
  it('cierra desde OPEN_INTAKE', async () => {
    const ctx = await setupCtx();
    const tool = buildCloseJobTool(ctx, { prisma } as any);
    const out = await tool.execute({});
    expect(out.ok).toBe(true);
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    expect(reload!.status).toBe('CLOSED');
  });

  it('rechaza desde IN_PROGRESS', async () => {
    const ctx = await setupCtx();
    await prisma.job.update({ where: { id: ctx.job.id }, data: { status: 'IN_PROGRESS' } });
    ctx.job.status = 'IN_PROGRESS';
    const tool = buildCloseJobTool(ctx, { prisma } as any);
    const out = await tool.execute({});
    expect(out.ok).toBe(false);
  });
});

describe('tool flag_non_intake', () => {
  it('marca el contacto y devuelve ok', async () => {
    const ctx = await setupCtx();
    const tool = buildFlagNonIntakeTool(ctx, { prisma } as any);
    const out = await tool.execute({ reason: 'cliente sólo manda promociones' });
    expect(out.ok).toBe(true);
    const reload = await prisma.contact.findUnique({ where: { id: ctx.contact.id } });
    expect(reload!.flaggedNonIntake).toBe(true);
    expect(reload!.flaggedReason).toBe('cliente sólo manda promociones');
  });

  it('rechaza reason demasiado corto', async () => {
    const ctx = await setupCtx();
    const tool = buildFlagNonIntakeTool(ctx, { prisma } as any);
    const out = await tool.execute({ reason: 'x' });
    expect(out.ok).toBe(false);
  });
});

describe('tool request_photo', () => {
  it('siempre devuelve ok con purpose válido', async () => {
    const ctx = await setupCtx();
    const tool = buildRequestPhotoTool(ctx);
    const out = await tool.execute({ purpose: 'vista frontal del sillón' });
    expect(out.ok).toBe(true);
  });

  it('rechaza purpose vacío', async () => {
    const ctx = await setupCtx();
    const tool = buildRequestPhotoTool(ctx);
    const out = await tool.execute({ purpose: '' });
    expect(out.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/agent/tools.test.ts
```

Expected: 8 anteriores pasan, 6 nuevos fallan.

- [ ] **Step 3: Implementar las tres tools**

Append a `src/agent/tools.ts`:

```ts
import { closeJob } from '../services/job';
import { flagNonIntake } from '../services/contact';

const CloseJobArgsZ = z.object({});

export function buildCloseJobTool(
  ctx: TurnContext,
  deps: Pick<AgentDeps, 'prisma'>,
): AgentTool {
  return {
    name: 'close_job',
    description:
      'Cierra el job. SOLO cuando el cliente diga explícitamente que terminó (ej: "eso es todo", "gracias, espero respuesta"). Requiere status OPEN_INTAKE o READY_FOR_REVIEW.',
    inputSchema: CloseJobArgsZ,
    execute: async () => {
      if (ctx.job.status !== JOB_STATUS.OPEN && ctx.job.status !== JOB_STATUS.READY) {
        return {
          ok: false,
          error: `close_job requiere OPEN_INTAKE o READY_FOR_REVIEW, actual=${ctx.job.status}`,
        };
      }
      const updated = await closeJob(deps.prisma, ctx.job.id);
      ctx.job.status = updated.status;
      return { ok: true, status: 'CLOSED' };
    },
  };
}

const FlagNonIntakeArgsZ = z.object({
  reason: z.string().min(5, 'reason debe describir por qué este contacto no es un intake'),
});

export function buildFlagNonIntakeTool(
  ctx: TurnContext,
  deps: Pick<AgentDeps, 'prisma'>,
): AgentTool {
  return {
    name: 'flag_non_intake',
    description:
      'Marca al contacto como NO intake (spam, conversación irrelevante después de reconducir 1-2 veces). El bot dejará de responder.',
    inputSchema: FlagNonIntakeArgsZ,
    execute: async (rawArgs) => {
      const parse = FlagNonIntakeArgsZ.safeParse(rawArgs);
      if (!parse.success) return { ok: false, error: `args inválidos: ${parse.error.message}` };
      await flagNonIntake(deps.prisma, ctx.contact.id, parse.data.reason);
      ctx.contact.flaggedNonIntake = true;
      ctx.contact.flaggedReason = parse.data.reason;
      return { ok: true };
    },
  };
}

const RequestPhotoArgsZ = z.object({
  purpose: z.string().min(3, 'describe brevemente para qué se piden las fotos'),
});

export function buildRequestPhotoTool(ctx: TurnContext): AgentTool {
  return {
    name: 'request_photo',
    description:
      'Indica que tu respuesta al cliente va a PEDIR fotos específicas. No envía nada por sí solo; tu texto al cliente debe pedirlas. Sirve para registrar la intención.',
    inputSchema: RequestPhotoArgsZ,
    execute: async (rawArgs) => {
      const parse = RequestPhotoArgsZ.safeParse(rawArgs);
      if (!parse.success) return { ok: false, error: `args inválidos: ${parse.error.message}` };
      return { ok: true, purpose: parse.data.purpose };
    },
  };
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/agent/tools.test.ts
```

Expected: 14 passed.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools.ts tests/agent/tools.test.ts
git commit -m "feat(agent): tools close_job, flag_non_intake, request_photo con validación"
```

---

## Task 10: Tool condicional `select_or_open_job`

**Files:**
- Modify: `src/agent/tools.ts`
- Modify: `tests/agent/tools.test.ts`

- [ ] **Step 1: Agregar tests**

Append:

```ts
import { buildSelectOrOpenJobTool } from '../../src/agent/tools';

describe('tool select_or_open_job', () => {
  it('valida use_existing con id de la lista de otherOpenJobs', async () => {
    const ctx = await setupCtx();
    ctx.otherOpenJobs = [
      { id: 'job-a', summary: null, openedAt: new Date() },
      { id: 'job-b', summary: null, openedAt: new Date() },
    ];
    const tool = buildSelectOrOpenJobTool(ctx);
    const out = await tool.execute({ action: 'use_existing', existing_job_id: 'job-a' });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.selected_job_id).toBe('job-a');
  });

  it('rechaza use_existing con id no listado', async () => {
    const ctx = await setupCtx();
    ctx.otherOpenJobs = [{ id: 'job-a', summary: null, openedAt: new Date() }];
    const tool = buildSelectOrOpenJobTool(ctx);
    const out = await tool.execute({ action: 'use_existing', existing_job_id: 'fake' });
    expect(out.ok).toBe(false);
  });

  it('acepta open_new sin id', async () => {
    const ctx = await setupCtx();
    const tool = buildSelectOrOpenJobTool(ctx);
    const out = await tool.execute({ action: 'open_new' });
    expect(out.ok).toBe(true);
  });

  it('rechaza use_existing sin id', async () => {
    const ctx = await setupCtx();
    ctx.otherOpenJobs = [{ id: 'job-a', summary: null, openedAt: new Date() }];
    const tool = buildSelectOrOpenJobTool(ctx);
    const out = await tool.execute({ action: 'use_existing' });
    expect(out.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/agent/tools.test.ts
```

Expected: 14 anteriores pasan, 4 nuevos fallan.

- [ ] **Step 3: Implementar**

Append a `src/agent/tools.ts`:

```ts
const SelectOrOpenJobArgsZ = z
  .object({
    action: z.enum(['use_existing', 'open_new']),
    existing_job_id: z.string().optional(),
  })
  .refine(
    (d) => d.action === 'open_new' || (d.action === 'use_existing' && !!d.existing_job_id),
    { message: 'use_existing requiere existing_job_id' },
  );

export function buildSelectOrOpenJobTool(ctx: TurnContext): AgentTool {
  return {
    name: 'select_or_open_job',
    description:
      'Solo disponible si hay múltiples jobs abiertos. Decide a cuál pertenece el mensaje o abre uno nuevo. La asignación efectiva la hace el pipeline; aquí sólo registras la decisión.',
    inputSchema: SelectOrOpenJobArgsZ,
    execute: async (rawArgs) => {
      const parse = SelectOrOpenJobArgsZ.safeParse(rawArgs);
      if (!parse.success) return { ok: false, error: `args inválidos: ${parse.error.message}` };
      const args = parse.data;
      if (args.action === 'use_existing') {
        const exists = ctx.otherOpenJobs.some((j) => j.id === args.existing_job_id);
        if (!exists) {
          return {
            ok: false,
            error: `existing_job_id ${args.existing_job_id} no está en la lista de jobs abiertos`,
          };
        }
        return { ok: true, selected_job_id: args.existing_job_id };
      }
      return { ok: true, action: 'open_new' };
    },
  };
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/agent/tools.test.ts
```

Expected: 18 passed.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools.ts tests/agent/tools.test.ts
git commit -m "feat(agent): tool select_or_open_job (condicional)"
```

---

## Task 11: Factory `buildTools` que ensambla todas las tools

**Files:**
- Modify: `src/agent/tools.ts`
- Modify: `tests/agent/tools.test.ts`

- [ ] **Step 1: Agregar tests**

Append:

```ts
import { buildTools } from '../../src/agent/tools';

describe('buildTools', () => {
  it('expone 5 tools cuando otherOpenJobs.length < 2', async () => {
    const ctx = await setupCtx();
    const tools = buildTools(ctx, {
      prisma,
      profile: { intakeSchema: schema, hash: 'h' } as any,
      notifier: new NoopNotifier(),
      config: { owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'x' } } as any,
    } as any);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'close_job',
      'flag_non_intake',
      'mark_ready_for_review',
      'request_photo',
      'update_intake',
    ]);
  });

  it('agrega select_or_open_job cuando hay 2+ otherOpenJobs', async () => {
    const ctx = await setupCtx();
    ctx.otherOpenJobs = [
      { id: 'a', summary: null, openedAt: new Date() },
      { id: 'b', summary: null, openedAt: new Date() },
    ];
    const tools = buildTools(ctx, {
      prisma,
      profile: { intakeSchema: schema, hash: 'h' } as any,
      notifier: new NoopNotifier(),
      config: { owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'x' } } as any,
    } as any);
    expect(tools.map((t) => t.name)).toContain('select_or_open_job');
    expect(tools).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/agent/tools.test.ts
```

Expected: 18 anteriores pasan, 2 nuevos fallan.

- [ ] **Step 3: Implementar `buildTools`**

Append a `src/agent/tools.ts`:

```ts
export function buildTools(ctx: TurnContext, deps: AgentDeps): AgentTool[] {
  const tools: AgentTool[] = [
    buildUpdateIntakeTool(ctx, deps),
    buildMarkReadyTool(ctx, deps),
    buildCloseJobTool(ctx, deps),
    buildFlagNonIntakeTool(ctx, deps),
    buildRequestPhotoTool(ctx),
  ];
  if (ctx.otherOpenJobs.length >= 2) {
    tools.push(buildSelectOrOpenJobTool(ctx));
  }
  return tools;
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/agent/tools.test.ts
```

Expected: 20 passed.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools.ts tests/agent/tools.test.ts
git commit -m "feat(agent): buildTools ensambla las 5/6 tools según contexto"
```

---

## Task 12: `runAgentTurn` — runner end-to-end con SDK factory inyectable

**Files:**
- Create: `src/agent/runner.ts`
- Create: `tests/agent/runner.test.ts`

- [ ] **Step 1: Escribir tests**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { runAgentTurn } from '../../src/agent/runner';
import { upsertContactByPhone } from '../../src/services/contact';
import { openJob, parseJobIntake } from '../../src/services/job';
import { createEmptyIntakeFromSchema } from '../../src/services/intake';
import { NoopNotifier } from '../../src/services/notification';
import type { AgentFactory, AgentLike, TurnContext } from '../../src/agent/types';
import type { Profile, Config } from '../../src/config/schema';
import type { IntakeSchema } from '../../src/config/intake-schema';

const adapter = new PrismaBetterSqlite3({ url: 'file:./data/intake.db' });
const prisma = new PrismaClient({ adapter });

const schema: IntakeSchema = {
  $businessName: 'Tapicería Demo',
  $businessDomain: 'tapicería',
  $language: 'es-MX',
  sections: [
    {
      key: 'client',
      label: 'Cliente',
      fields: [{ key: 'name', label: 'Nombre', type: 'string', required: true }],
    },
  ],
};

const profile: Profile = {
  intakeSchema: schema,
  promptVars: {
    promptTemplate: 'Asistente de **{{businessName}}**. {{tone}}',
    vars: { tone: 'Cercano.' },
  },
  businessFacts: { facts: [], freeContext: '' },
  welcome: 'hola',
  hash: 'h1',
};

const config: Config = {
  profile: './profiles/tapiceria',
  model: 'anthropic/claude-sonnet-4-6',
  maxSteps: 6,
  temperature: 0.4,
  debounceMs: 5000,
  fallbackOnError: 'oops',
  outOfScopeNudge: '',
  hours: { enabled: false, timezone: 'America/Mexico_City', schedule: {}, outOfHoursNotice: '' },
  owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'http://x' },
  panel: { users: [] },
  media: { storeDir: './media', transcribeAudio: true, whisperModel: 'openai/whisper-1' },
  limits: { monthlyCostUsd: 50, alertOnCostUsd: 40, maxConsecutiveErrors: 3 },
} as Config;

async function setupCtx(): Promise<TurnContext> {
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
  const c = await upsertContactByPhone(prisma, '+521');
  const j = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
  return {
    job: j,
    contact: c,
    intake: createEmptyIntakeFromSchema(schema),
    batchMessages: [{ id: 'm1', kind: 'text', body: 'Hola, soy María' }],
    otherOpenJobs: [],
    now: '2026-05-25T10:00:00Z',
  };
}

afterAll(async () => {
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.$disconnect();
});

/** Stub del SDK que simula un agente: ejecuta una callback "scripted" sobre los tools. */
function makeStubFactory(script: (tools: any[]) => Promise<{ text: string; usage?: any }>): AgentFactory {
  return (cfg) => {
    const agent: AgentLike = {
      on: () => {},
      sendSync: async () => {
        const result = await script(cfg.tools as any[]);
        return { text: result.text, usage: result.usage };
      },
    };
    return agent;
  };
}

describe('runAgentTurn', () => {
  it('respuesta sin tools devuelve texto y persiste agent_run', async () => {
    const ctx = await setupCtx();
    const factory = makeStubFactory(async () => ({
      text: 'Hola María, ¿qué necesitas?',
      usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.001 },
    }));
    const result = await runAgentTurn(ctx, {
      prisma,
      config,
      profile,
      notifier: new NoopNotifier(),
      createAgent: factory,
    });
    expect(result.responseText).toBe('Hola María, ¿qué necesitas?');
    expect(result.toolCalls).toHaveLength(0);
    expect(result.inputTokens).toBe(100);
    const runs = await prisma.agentRun.findMany({ where: { jobId: ctx.job.id } });
    expect(runs).toHaveLength(1);
    expect(runs[0].responseText).toBe('Hola María, ¿qué necesitas?');
  });

  it('si la script llama una tool, la ejecución persiste el cambio', async () => {
    const ctx = await setupCtx();
    const factory = makeStubFactory(async (tools) => {
      const updateIntake = tools.find((t) => t.name === 'update_intake')!;
      await updateIntake.execute({ fields: [{ path: 'client.name', value: 'María' }] });
      return { text: 'Listo, registré tu nombre.' };
    });
    const result = await runAgentTurn(ctx, {
      prisma,
      config,
      profile,
      notifier: new NoopNotifier(),
      createAgent: factory,
    });
    expect(result.responseText).toBe('Listo, registré tu nombre.');
    const reload = await prisma.job.findUnique({ where: { id: ctx.job.id } });
    const intake = parseJobIntake(reload!);
    expect((intake.client as any).name.value).toBe('María');
  });

  it('errores del SDK se capturan y se devuelve fallback con error guardado', async () => {
    const ctx = await setupCtx();
    const factory: AgentFactory = () => ({
      on: () => {},
      sendSync: async () => {
        throw new Error('network down');
      },
    });
    const result = await runAgentTurn(ctx, {
      prisma,
      config,
      profile,
      notifier: new NoopNotifier(),
      createAgent: factory,
    });
    expect(result.error).toMatch(/network down/);
    expect(result.responseText).toBe(config.fallbackOnError);
    const runs = await prisma.agentRun.findMany({ where: { jobId: ctx.job.id } });
    expect(runs[0].error).toMatch(/network down/);
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/agent/runner.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/agent/runner.ts`**

```ts
import type { TurnContext, TurnResult, AgentDeps, ToolCallRecord } from './types';
import { buildSystemPrompt, renderUserMessage } from './prompt';
import { buildTools } from './tools';
import { recordAgentRun } from './audit';

export async function runAgentTurn(
  ctx: TurnContext,
  deps: AgentDeps,
): Promise<TurnResult> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? '';
  const triggerMessageIds = ctx.batchMessages.map((m) => m.id);
  const toolCalls: ToolCallRecord[] = [];

  // Construimos las tools con un wrapper que registra cada llamada.
  const rawTools = buildTools(ctx, deps);
  const wrappedTools = rawTools.map((tool) => ({
    ...tool,
    execute: async (args: unknown) => {
      let result: unknown;
      let errorMsg: string | null = null;
      try {
        result = await tool.execute(args as never);
        if (typeof result === 'object' && result && 'ok' in result && (result as any).ok === false) {
          errorMsg = String((result as any).error ?? 'tool returned ok=false');
        }
      } catch (err) {
        errorMsg = err instanceof Error ? err.message : String(err);
        result = { ok: false, error: errorMsg };
      }
      toolCalls.push({ name: tool.name, args, result, error: errorMsg });
      return result;
    },
  }));

  const instructions = buildSystemPrompt({
    profile: deps.profile,
    config: deps.config,
    intake: ctx.intake,
    jobId: ctx.job.id,
    jobStatus: ctx.job.status,
    otherOpenJobs: ctx.otherOpenJobs,
    now: new Date(ctx.now),
  });
  const userMessage = renderUserMessage(ctx.batchMessages);

  let responseText = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd: number | null = null;
  let error: string | null = null;

  try {
    const agent = deps.createAgent({
      apiKey,
      model: deps.config.model,
      instructions,
      tools: wrappedTools,
      maxSteps: deps.config.maxSteps,
      temperature: deps.config.temperature,
    });
    const response = await agent.sendSync(userMessage);
    responseText = response.text;
    inputTokens = response.usage?.inputTokens ?? 0;
    outputTokens = response.usage?.outputTokens ?? 0;
    costUsd = response.usage?.costUsd ?? null;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    responseText = deps.config.fallbackOnError;
  }

  await recordAgentRun(deps.prisma, {
    jobId: ctx.job.id,
    triggerMessageIds,
    model: deps.config.model,
    inputTokens,
    outputTokens,
    costUsd,
    toolCalls,
    responseText,
    configHash: deps.profile.hash,
    error,
  });

  return {
    responseText,
    toolCalls,
    inputTokens,
    outputTokens,
    costUsd,
    error,
  };
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/agent/runner.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/agent/runner.ts tests/agent/runner.test.ts
git commit -m "feat(agent): runAgentTurn integra prompt, tools y SDK con factory inyectable"
```

---

## Task 13: Default factory que usa el SDK real

**Files:**
- Modify: `src/agent/runner.ts`
- Create: `src/agent/sdk-factory.ts`

- [ ] **Step 1: Crear el adapter del SDK real**

`src/agent/sdk-factory.ts`:

```ts
import type { AgentFactory, AgentLike } from './types';

/** Factory que envuelve `@openrouter/sdk`. Se importa perezosamente porque las tests no lo necesitan. */
export const defaultAgentFactory: AgentFactory = (cfg) => {
  // Import dinámico para no romper tests donde el SDK no esté disponible/configurado.
  // El módulo se carga la primera vez que se invoca el factory.
  // En runtime real, OPENROUTER_API_KEY debe estar definido.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sdk = require('@openrouter/sdk');
  const agent = sdk.createAgent({
    apiKey: cfg.apiKey,
    model: cfg.model,
    instructions: cfg.instructions,
    // El SDK espera Tools construidas con su helper `tool()`. Nuestras AgentTool son compatibles
    // estructuralmente (name/description/inputSchema/execute). Si el SDK exige una marca de fábrica,
    // mapeamos aquí:
    tools: (cfg.tools as any[]).map((t) =>
      sdk.tool({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        execute: t.execute,
      }),
    ),
    maxSteps: cfg.maxSteps,
    temperature: cfg.temperature,
  });
  const wrapper: AgentLike = {
    on: (event, handler) => agent.on(event, handler as (...args: unknown[]) => void),
    sendSync: async (msg) => {
      const resp = await agent.sendSync(msg);
      return {
        text: typeof resp === 'string' ? resp : (resp.text ?? ''),
        usage: resp.usage,
      };
    },
  };
  return wrapper;
};
```

- [ ] **Step 2: Smoke test del wrapper (sin red — sólo que el módulo cargue sin errores)**

Confirma que `npm run typecheck` pasa.

```bash
npm run typecheck
```

Expected: cero errores. Si TypeScript se queja de `require`, usa import dinámico en su lugar:

```ts
const sdk = await import('@openrouter/sdk');
```

(y haz la función async). Adapta si es necesario.

- [ ] **Step 3: Commit**

```bash
git add src/agent/sdk-factory.ts
git commit -m "feat(agent): defaultAgentFactory envuelve @openrouter/sdk (para runtime real)"
```

---

## Task 14: CLI `run-turn` para smoke test manual con SDK stub

**Files:**
- Create: `src/cli/run-turn.ts`
- Modify: `package.json` (agrega script)

- [ ] **Step 1: Crear `src/cli/run-turn.ts`**

```ts
#!/usr/bin/env tsx
/**
 * CLI smoke-test del agent runner con un SDK stub.
 *
 * Crea un contacto y un job demo, simula que el cliente dice "Hola, soy María González,
 * quiero retapizar un sillón de 3 plazas, son 1 mueble", y corre un turno con un stub
 * del SDK que llama a update_intake y devuelve una respuesta canned.
 *
 * Útil para validar que toda la cadena (prompt + tools + persistencia + audit) funciona
 * sin necesidad de OpenRouter ni Baileys.
 */
import { loadConfig, loadProfile } from '../config/loader';
import { getPrisma, disconnectPrisma } from '../storage/client';
import { upsertContactByPhone } from '../services/contact';
import { openJob, parseJobIntake } from '../services/job';
import { createEmptyIntakeFromSchema } from '../services/intake';
import { NoopNotifier } from '../services/notification';
import { runAgentTurn } from '../agent/runner';
import type { AgentFactory, AgentLike } from '../agent/types';

const stubFactory: AgentFactory = (cfg) => {
  const tools = cfg.tools as any[];
  const agent: AgentLike = {
    on: () => {},
    sendSync: async () => {
      const updateIntake = tools.find((t) => t.name === 'update_intake');
      if (updateIntake) {
        await updateIntake.execute({
          fields: [
            { path: 'client.name', value: 'María González' },
            { path: 'work.item_type', value: 'sillón de 3 plazas' },
            { path: 'work.service_type', value: 'retapizar' },
            { path: 'work.quantity', value: 1 },
          ],
          notes_to_add: ['cliente mencionó que es regalo para su mamá'],
        });
      }
      return {
        text: 'Genial María, ya registré tus datos. ¿En qué ciudad estás?',
        usage: { inputTokens: 250, outputTokens: 30, costUsd: 0.002 },
      };
    },
  };
  return agent;
};

async function main() {
  const config = await loadConfig('./config.json');
  const profile = await loadProfile(config.profile);
  const prisma = getPrisma();

  const contact = await upsertContactByPhone(prisma, '+5210000000099');
  const job = await openJob(prisma, contact.id, createEmptyIntakeFromSchema(profile.intakeSchema));

  console.log(`Job demo creado: ${job.id}`);

  const result = await runAgentTurn(
    {
      job,
      contact,
      intake: parseJobIntake(job),
      batchMessages: [
        {
          id: 'msg_demo',
          kind: 'text',
          body: 'Hola, soy María González y quiero retapizar un sillón de 3 plazas.',
        },
      ],
      otherOpenJobs: [],
      now: new Date().toISOString(),
    },
    {
      prisma,
      config,
      profile,
      notifier: new NoopNotifier(),
      createAgent: stubFactory,
    },
  );

  console.log('\n=== Respuesta del agente (stub) ===');
  console.log(result.responseText);
  console.log('\n=== Tool calls ===');
  for (const tc of result.toolCalls) {
    console.log(`- ${tc.name}: ${tc.error ? `ERROR ${tc.error}` : 'ok'}`);
  }
  console.log(`\nTokens: in=${result.inputTokens} out=${result.outputTokens} cost=${result.costUsd ?? 'n/a'}`);

  const reload = await prisma.job.findUnique({ where: { id: job.id } });
  console.log('\n=== Intake guardado ===');
  console.log(JSON.stringify(parseJobIntake(reload!), null, 2).slice(0, 600), '...');

  await disconnectPrisma();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Agregar script al `package.json`**

Edita la sección `scripts`:

```json
"cli:run-turn": "tsx src/cli/run-turn.ts"
```

- [ ] **Step 3: Probar manualmente**

```bash
npm run cli:run-turn
```

Expected: imprime job ID, respuesta del stub, tool calls (update_intake: ok), tokens, e intake serializado con `client.name.value = "María González"`, `work.item_type.value = "sillón de 3 plazas"`, etc.

- [ ] **Step 4: Commit**

```bash
git add src/cli/run-turn.ts package.json
git commit -m "feat(cli): run-turn ejecuta un turno completo con SDK stub para smoke test"
```

---

## Task 15: Verificación final del Plan 2

- [ ] **Step 1: Correr la batería completa**

```bash
npm test
```

Expected: todos los tests pasan (los 53 del Plan 1 + los nuevos del Plan 2 — debería ser ~95-100 total).

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: cero errores.

- [ ] **Step 3: Smoke test con CLI**

```bash
npm run cli:run-turn
```

Expected: salida con tools invocadas y intake guardado.

- [ ] **Step 4: Verificar que `data/intake.db` no se subió al git**

```bash
git status
```

`data/` debería estar gitignored. Si aparecen cambios al `.db`, ignora (son del smoke test).

- [ ] **Step 5: Commit final si algo quedó pendiente**

```bash
git status
# si hay nada que commitear, perfecto. Si hay algún ajuste menor:
git add -A && git commit -m "chore: fin de Plan 2 - agent core listo"
```

---

## Cobertura del spec en este plan

| Sección del spec | Tarea(s) que lo cubren |
|------------------|------------------------|
| §6 createAgent + sendSync | T12 (runner), T13 (factory real) |
| §6 6 tools con Zod | T7-T11 |
| §6 Validación runtime (paths/types, mark_ready required, close_job state) | T7, T8, T9, T10 |
| §6 select_or_open_job condicional | T10, T11 |
| §6 audit en agent_runs | T6 |
| §6 manejo de errores con fallback | T12 |
| §7 prompt template con `{{var}}` y bloques | T2, T3, T4 |
| Business facts + free context inyectados | T3, T4 |
| Notificación al dueño al pasar a READY | T5, T8 |

Lo que NO está en este plan:
- WhatsApp (Plan 4).
- Inbound pipeline / debouncer / Whisper (Plan 3).
- Panel web (Plan 5).
- Hooks de eventos del SDK (`on('tool:call')` para observabilidad) — el runner registra tool calls envolviendo `execute`, no por eventos. Suficiente para el MVP.
- Multi-step real (la prueba con stub sólo simula un sendSync con una iteración). El SDK real maneja `maxSteps` internamente. Cuando llegue Plan 4 con tráfico real, podremos refinar.
