# Plan 3 — Inbound pipeline + debouncer + transcripción Whisper

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el pipeline que recibe mensajes "crudos" de un adapter (en Plan 4 será Baileys), los normaliza (texto/imagen/audio con Whisper), los persiste con idempotencia, identifica al contacto y al job, los acumula en un debouncer y eventualmente dispara `runAgentTurn` con el batch. La respuesta del agente se entrega vía una interfaz `OutboundSender` (stub en este plan, Baileys en Plan 4).

**Architecture:** El `InboundCoordinator` es el único punto de entrada. Acepta `RawInboundMessage` y orquesta: pre-filter → idempotency → normalize → persistir media → resolver contacto → resolver job → debouncer. Cuando el debouncer dispara, lee el job actualizado, arma el `TurnContext` y llama a `runAgentTurn` (Plan 2). La respuesta se envía vía `OutboundSender` (inyectable). Toda dependencia externa (transcriber, sender, agent factory) es inyectable para tests.

**Tech Stack:** Node + TypeScript. Filesystem para media (`./media/<contactId>/<jobId>/...`). OpenRouter para Whisper (modelo configurable via `config.media.whisperModel`). Sin red real en tests — todo stubbed.

**Spec de referencia:** [`docs/superpowers/specs/2026-05-25-intake-recepcionista-design.md`](../specs/2026-05-25-intake-recepcionista-design.md) §3 y §5.

**Planes anteriores:** [Plan 1](2026-05-25-plan-1-fundacion.md), [Plan 2](2026-05-25-plan-2-agent-core.md).

---

## Estructura de archivos al finalizar este plan

```
src/
├── pipeline/
│   ├── types.ts            # RawInboundMessage, PipelineDeps, etc.
│   ├── normalize.ts        # normalizeAndPersistMessage()
│   ├── idempotency.ts      # alreadySeen()
│   ├── resolveContact.ts   # resolveContact() (ignora grupos, check bot_active)
│   ├── resolveJob.ts       # resolveJobForMessage()
│   ├── debouncer.ts        # InboundDebouncer (Map por contact, timer 5s)
│   └── coordinator.ts      # InboundCoordinator.handleInbound()
├── media/
│   ├── store.ts            # MediaStore (filesystem)
│   └── transcriber.ts      # Transcriber, NoopTranscriber, WhisperTranscriber
├── services/
│   └── outbound.ts         # OutboundSender + MemorySender
└── cli/
    └── inbound-demo.ts     # Smoke: inyecta mensajes simulados al coordinator

tests/
├── pipeline/
│   ├── normalize.test.ts
│   ├── idempotency.test.ts
│   ├── resolveContact.test.ts
│   ├── resolveJob.test.ts
│   ├── debouncer.test.ts
│   └── coordinator.test.ts
├── media/
│   ├── store.test.ts
│   └── transcriber.test.ts
└── services/
    └── outbound.test.ts
```

---

## Task 1: Tipos del pipeline + OutboundSender stub

**Files:**
- Create: `src/pipeline/types.ts`
- Create: `src/services/outbound.ts`
- Create: `tests/services/outbound.test.ts`

- [ ] **Step 1: Crear `src/pipeline/types.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import type { Config, Profile } from '../config/schema';
import type { Notifier } from '../services/notification';
import type { OutboundSender } from '../services/outbound';
import type { Transcriber } from '../media/transcriber';
import type { MediaStore } from '../media/store';
import type { AgentFactory } from '../agent/types';

/** Mensaje crudo que entrega el adapter (Baileys en Plan 4). */
export interface RawInboundMessage {
  /** ID único del mensaje en el sistema fuente. Usado para idempotencia. */
  whatsappMsgId: string;
  /** Número del remitente en formato E.164 (ej. "+5215555..."). */
  fromPhoneE164: string;
  /** "individual" para chats 1-a-1; "group" para grupos (ignorados). */
  chatKind: 'individual' | 'group' | 'status' | 'other';
  /** Marca si lo envió el propio número del bot (ignorar). */
  fromMe: boolean;
  /** Tipo de contenido. */
  kind: 'text' | 'image' | 'audio' | 'sticker' | 'location' | 'other';
  /** Texto plano si aplica (o caption de imagen). */
  text: string | null;
  /** Buffer del media si aplica. Lo persistimos al filesystem. */
  media: { buffer: Buffer; mimetype: string } | null;
  /** Payload original sin procesar (debug/auditoría). */
  raw: unknown;
  /** Cuándo lo recibió el adapter, ISO 8601. */
  receivedAt: string;
}

/** Dependencias del coordinador. Todas inyectables. */
export interface PipelineDeps {
  prisma: PrismaClient;
  config: Config;
  profile: Profile;
  notifier: Notifier;
  sender: OutboundSender;
  transcriber: Transcriber;
  mediaStore: MediaStore;
  agentFactory: AgentFactory;
  /** Hora actual; inyectable para tests determinísticos. */
  now: () => Date;
}

/** Resultado de la fase de pre-filter. Si rejected=true, el coordinador descarta. */
export type PrefilterResult =
  | { rejected: false }
  | { rejected: true; reason: 'group' | 'from_me' | 'status' | 'other_kind' };
```

- [ ] **Step 2: Escribir tests del OutboundSender**

`tests/services/outbound.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MemorySender } from '../../src/services/outbound';

describe('MemorySender', () => {
  it('sendText guarda el mensaje en sent[]', async () => {
    const s = new MemorySender();
    await s.sendText('+5215555', 'hola María');
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toEqual({ to: '+5215555', text: 'hola María' });
  });

  it('múltiples envíos preservan el orden', async () => {
    const s = new MemorySender();
    await s.sendText('+521', 'uno');
    await s.sendText('+521', 'dos');
    expect(s.sent.map((m) => m.text)).toEqual(['uno', 'dos']);
  });

  it('clear() vacía el historial', async () => {
    const s = new MemorySender();
    await s.sendText('+1', 'x');
    s.clear();
    expect(s.sent).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Verificar fallan**

```bash
npm test -- tests/services/outbound.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Crear `src/services/outbound.ts`**

```ts
export interface SentMessage {
  to: string;
  text: string;
}

export interface OutboundSender {
  /** Envía texto al número del contacto. Devuelve cuando se confirmó el envío. */
  sendText(toPhoneE164: string, text: string): Promise<void>;
}

/** Sender en memoria — para tests y este plan. Plan 4 trae `WhatsappSender` real. */
export class MemorySender implements OutboundSender {
  readonly sent: SentMessage[] = [];

  async sendText(to: string, text: string): Promise<void> {
    this.sent.push({ to, text });
  }

  clear(): void {
    this.sent.length = 0;
  }
}
```

- [ ] **Step 5: Verificar pasan + typecheck**

```bash
npm test -- tests/services/outbound.test.ts
npm run typecheck
```

`typecheck` puede quejarse de imports rotos en `src/pipeline/types.ts` (porque `MediaStore`/`Transcriber` aún no existen). Comenta esos imports temporalmente:

```ts
// import type { Transcriber } from '../media/transcriber';
// import type { MediaStore } from '../media/store';
```

Y en `PipelineDeps`:

```ts
  // transcriber: Transcriber;
  // mediaStore: MediaStore;
```

Restaurar en T2 y T3.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/types.ts src/services/outbound.ts tests/services/outbound.test.ts
git commit -m "feat(pipeline): tipos compartidos y OutboundSender con MemorySender"
```

---

## Task 2: MediaStore (filesystem)

**Files:**
- Create: `src/media/store.ts`
- Create: `tests/media/store.test.ts`

- [ ] **Step 1: Escribir tests**

`tests/media/store.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemMediaStore } from '../../src/media/store';

let tmpRoot: string;

async function makeStore(): Promise<{ store: FilesystemMediaStore; root: string }> {
  const root = await mkdtemp(join(tmpdir(), 'intake-media-'));
  tmpRoot = root;
  return { store: new FilesystemMediaStore(root), root };
}

afterAll(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe('FilesystemMediaStore', () => {
  it('save guarda el buffer y devuelve un path relativo determinístico', async () => {
    const { store, root } = await makeStore();
    const buffer = Buffer.from('hola foto', 'utf-8');
    const path = await store.save({
      buffer,
      mimetype: 'image/jpeg',
      contactId: 'c1',
      jobId: 'j1',
      messageId: 'm1',
    });
    expect(path).toMatch(/^c1\/j1\/m1\.jpe?g$/);
    const onDisk = await readFile(join(root, path));
    expect(onDisk.toString('utf-8')).toBe('hola foto');
  });

  it('soporta audios .ogg y .opus', async () => {
    const { store } = await makeStore();
    const path = await store.save({
      buffer: Buffer.from('audio'),
      mimetype: 'audio/ogg',
      contactId: 'c1',
      jobId: 'j1',
      messageId: 'a1',
    });
    expect(path).toMatch(/\.ogg$/);
  });

  it('mimetypes desconocidos caen en .bin', async () => {
    const { store } = await makeStore();
    const path = await store.save({
      buffer: Buffer.from('x'),
      mimetype: 'application/x-weird',
      contactId: 'c',
      jobId: 'j',
      messageId: 'm',
    });
    expect(path).toMatch(/\.bin$/);
  });

  it('absolutePathFor devuelve la ruta absoluta correcta', async () => {
    const { store, root } = await makeStore();
    const rel = 'c1/j1/m1.jpg';
    const abs = store.absolutePathFor(rel);
    expect(abs).toBe(join(root, rel));
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/media/store.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/media/store.ts`**

```ts
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';

export interface SaveMediaInput {
  buffer: Buffer;
  mimetype: string;
  contactId: string;
  jobId: string;
  /** ID único del mensaje (usado como nombre de archivo). */
  messageId: string;
}

export interface MediaStore {
  /** Persiste el buffer y devuelve el path relativo a la raíz del store. */
  save(input: SaveMediaInput): Promise<string>;
  /** Devuelve el path absoluto de un path relativo previamente devuelto por save(). */
  absolutePathFor(relativePath: string): string;
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'audio/ogg': 'ogg',
  'audio/ogg; codecs=opus': 'ogg',
  'audio/opus': 'opus',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'video/mp4': 'mp4',
};

function extFromMime(mimetype: string): string {
  const direct = MIME_TO_EXT[mimetype.toLowerCase()];
  if (direct) return direct;
  const base = mimetype.split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[base] ?? 'bin';
}

export class FilesystemMediaStore implements MediaStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async save(input: SaveMediaInput): Promise<string> {
    const ext = extFromMime(input.mimetype);
    const relPath = `${input.contactId}/${input.jobId}/${input.messageId}.${ext}`;
    const abs = join(this.root, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, input.buffer);
    return relPath;
  }

  absolutePathFor(relativePath: string): string {
    return join(this.root, relativePath);
  }
}
```

- [ ] **Step 4: Restaurar import en `src/pipeline/types.ts`**

Si en T1 comentaste la línea de `MediaStore`, descoméntala ahora.

- [ ] **Step 5: Correr tests + typecheck**

```bash
npm test -- tests/media/store.test.ts
npm run typecheck
```

Expected: 4 passed, typecheck limpio (excepto si `Transcriber` también está pendiente).

- [ ] **Step 6: Commit**

```bash
git add src/media/store.ts tests/media/store.test.ts src/pipeline/types.ts
git commit -m "feat(media): FilesystemMediaStore con mapeo de mimetypes"
```

---

## Task 3: Transcriber (interfaz + Noop + Whisper via OpenRouter)

**Files:**
- Create: `src/media/transcriber.ts`
- Create: `tests/media/transcriber.test.ts`

- [ ] **Step 1: Escribir tests**

`tests/media/transcriber.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  NoopTranscriber,
  ScriptedTranscriber,
} from '../../src/media/transcriber';

describe('NoopTranscriber', () => {
  it('devuelve null siempre', async () => {
    const t = new NoopTranscriber();
    const out = await t.transcribe(Buffer.from('x'), 'audio/ogg');
    expect(out).toBeNull();
  });
});

describe('ScriptedTranscriber', () => {
  it('devuelve la siguiente cadena del script', async () => {
    const t = new ScriptedTranscriber(['hola', 'qué tal']);
    expect(await t.transcribe(Buffer.from(''), 'audio/ogg')).toBe('hola');
    expect(await t.transcribe(Buffer.from(''), 'audio/ogg')).toBe('qué tal');
  });

  it('devuelve null cuando se acaba el script', async () => {
    const t = new ScriptedTranscriber(['hola']);
    await t.transcribe(Buffer.from(''), 'audio/ogg');
    expect(await t.transcribe(Buffer.from(''), 'audio/ogg')).toBeNull();
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/media/transcriber.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/media/transcriber.ts`**

```ts
export interface Transcriber {
  /** Transcribe audio. Devuelve null si la transcripción está deshabilitada o falló. */
  transcribe(buffer: Buffer, mimetype: string): Promise<string | null>;
}

/** No transcribe — devuelve null. Útil cuando `config.media.transcribeAudio=false`. */
export class NoopTranscriber implements Transcriber {
  async transcribe(): Promise<string | null> {
    return null;
  }
}

/** Transcriber programable para tests: devuelve cada cadena del array en orden. */
export class ScriptedTranscriber implements Transcriber {
  private idx = 0;
  constructor(private readonly script: ReadonlyArray<string | null>) {}

  async transcribe(): Promise<string | null> {
    if (this.idx >= this.script.length) return null;
    return this.script[this.idx++] ?? null;
  }
}

/**
 * Transcriber real que llama a OpenRouter usando Whisper.
 *
 * NOTA: OpenRouter expone modelos compatibles con la API de OpenAI. La librería
 * `@openrouter/sdk` cubre el `callModel` para texto, pero para audio (transcripción)
 * lo más directo es un `fetch` a `/v1/audio/transcriptions` con la API key.
 *
 * Esta implementación usa fetch directo (sin SDK).
 */
export class WhisperTranscriber implements Transcriber {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string = 'https://openrouter.ai/api/v1',
  ) {}

  async transcribe(buffer: Buffer, mimetype: string): Promise<string | null> {
    if (!this.apiKey) return null;
    try {
      const form = new FormData();
      const blob = new Blob([buffer], { type: mimetype });
      form.append('file', blob, `audio.${extFromMime(mimetype)}`);
      form.append('model', this.model);
      form.append('response_format', 'text');

      const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
      });
      if (!res.ok) return null;
      const text = await res.text();
      return text.trim() || null;
    } catch {
      return null;
    }
  }
}

function extFromMime(mimetype: string): string {
  if (mimetype.includes('ogg')) return 'ogg';
  if (mimetype.includes('mpeg') || mimetype.includes('mp3')) return 'mp3';
  if (mimetype.includes('mp4') || mimetype.includes('m4a')) return 'm4a';
  if (mimetype.includes('wav')) return 'wav';
  if (mimetype.includes('opus')) return 'opus';
  return 'bin';
}
```

- [ ] **Step 4: Restaurar import en `src/pipeline/types.ts`**

Descomenta la línea de `Transcriber` si estaba comentada.

- [ ] **Step 5: Correr tests + typecheck**

```bash
npm test -- tests/media/transcriber.test.ts
npm run typecheck
```

Expected: 3 passed, typecheck limpio.

- [ ] **Step 6: Commit**

```bash
git add src/media/transcriber.ts tests/media/transcriber.test.ts src/pipeline/types.ts
git commit -m "feat(media): Transcriber con Noop, Scripted y WhisperTranscriber"
```

---

## Task 4: Pre-filter + idempotencia

**Files:**
- Create: `src/pipeline/idempotency.ts`
- Create: `tests/pipeline/idempotency.test.ts`

- [ ] **Step 1: Escribir tests**

`tests/pipeline/idempotency.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { upsertContactByPhone } from '../../src/services/contact';
import { prefilter, alreadySeen } from '../../src/pipeline/idempotency';
import type { RawInboundMessage } from '../../src/pipeline/types';

const adapter = new PrismaBetterSqlite3({ url: 'file:./data/intake.db' });
const prisma = new PrismaClient({ adapter });

async function cleanup() {
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
}

function rawMsg(overrides: Partial<RawInboundMessage> = {}): RawInboundMessage {
  return {
    whatsappMsgId: 'wa_1',
    fromPhoneE164: '+5215555555555',
    chatKind: 'individual',
    fromMe: false,
    kind: 'text',
    text: 'hola',
    media: null,
    raw: {},
    receivedAt: '2026-05-25T10:00:00Z',
    ...overrides,
  };
}

describe('prefilter', () => {
  it('acepta mensaje individual entrante de texto', () => {
    const r = prefilter(rawMsg());
    expect(r.rejected).toBe(false);
  });

  it('rechaza grupos', () => {
    const r = prefilter(rawMsg({ chatKind: 'group' }));
    expect(r.rejected).toBe(true);
    if (r.rejected) expect(r.reason).toBe('group');
  });

  it('rechaza fromMe=true', () => {
    const r = prefilter(rawMsg({ fromMe: true }));
    expect(r.rejected).toBe(true);
    if (r.rejected) expect(r.reason).toBe('from_me');
  });

  it('rechaza status broadcast', () => {
    const r = prefilter(rawMsg({ chatKind: 'status' }));
    expect(r.rejected).toBe(true);
    if (r.rejected) expect(r.reason).toBe('status');
  });
});

describe('alreadySeen', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('false cuando whatsappMsgId no está en DB', async () => {
    const seen = await alreadySeen(prisma, 'never_seen');
    expect(seen).toBe(false);
  });

  it('true cuando el mensaje ya fue persistido', async () => {
    const c = await upsertContactByPhone(prisma, '+5215555555555');
    await prisma.message.create({
      data: {
        contactId: c.id,
        direction: 'inbound',
        kind: 'text',
        body: 'hola',
        whatsappMsgId: 'wa_existing',
      },
    });
    const seen = await alreadySeen(prisma, 'wa_existing');
    expect(seen).toBe(true);
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/pipeline/idempotency.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/pipeline/idempotency.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import type { RawInboundMessage, PrefilterResult } from './types';

export function prefilter(msg: RawInboundMessage): PrefilterResult {
  if (msg.fromMe) return { rejected: true, reason: 'from_me' };
  if (msg.chatKind === 'group') return { rejected: true, reason: 'group' };
  if (msg.chatKind === 'status') return { rejected: true, reason: 'status' };
  if (msg.chatKind === 'other') return { rejected: true, reason: 'other_kind' };
  return { rejected: false };
}

export async function alreadySeen(
  prisma: PrismaClient,
  whatsappMsgId: string,
): Promise<boolean> {
  const existing = await prisma.message.findUnique({
    where: { whatsappMsgId },
    select: { id: true },
  });
  return existing !== null;
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/pipeline/idempotency.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/idempotency.ts tests/pipeline/idempotency.test.ts
git commit -m "feat(pipeline): prefilter (grupos/from_me/status) + alreadySeen"
```

---

## Task 5: Normalize + persist message (texto/imagen/audio)

**Files:**
- Create: `src/pipeline/normalize.ts`
- Create: `tests/pipeline/normalize.test.ts`

- [ ] **Step 1: Escribir tests**

`tests/pipeline/normalize.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertContactByPhone } from '../../src/services/contact';
import { normalizeAndPersistMessage } from '../../src/pipeline/normalize';
import { FilesystemMediaStore } from '../../src/media/store';
import { NoopTranscriber, ScriptedTranscriber } from '../../src/media/transcriber';
import type { RawInboundMessage } from '../../src/pipeline/types';

const adapter = new PrismaBetterSqlite3({ url: 'file:./data/intake.db' });
const prisma = new PrismaClient({ adapter });

let mediaRoot: string;

async function cleanup() {
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
}

function rawMsg(overrides: Partial<RawInboundMessage> = {}): RawInboundMessage {
  return {
    whatsappMsgId: 'wa_1',
    fromPhoneE164: '+5215555555555',
    chatKind: 'individual',
    fromMe: false,
    kind: 'text',
    text: 'hola',
    media: null,
    raw: {},
    receivedAt: '2026-05-25T10:00:00Z',
    ...overrides,
  };
}

describe('normalizeAndPersistMessage', () => {
  beforeEach(async () => {
    await cleanup();
    mediaRoot = await mkdtemp(join(tmpdir(), 'intake-norm-'));
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  });

  it('persiste texto plano sin tocar filesystem', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const store = new FilesystemMediaStore(mediaRoot);
    const msg = await normalizeAndPersistMessage(
      prisma,
      store,
      new NoopTranscriber(),
      rawMsg({ kind: 'text', text: 'Hola, tengo un sillón' }),
      c.id,
    );
    expect(msg.kind).toBe('text');
    expect(msg.body).toBe('Hola, tengo un sillón');
    expect(msg.mediaPath).toBeNull();
    const reload = await prisma.message.findUnique({ where: { id: msg.id } });
    expect(reload!.body).toBe('Hola, tengo un sillón');
  });

  it('persiste imagen al filesystem y guarda mediaPath', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const store = new FilesystemMediaStore(mediaRoot);
    const msg = await normalizeAndPersistMessage(
      prisma,
      store,
      new NoopTranscriber(),
      rawMsg({
        whatsappMsgId: 'wa_img',
        kind: 'image',
        text: null,
        media: { buffer: Buffer.from('FAKEJPEG'), mimetype: 'image/jpeg' },
      }),
      c.id,
    );
    expect(msg.kind).toBe('image');
    expect(msg.mediaPath).toMatch(/\.jpe?g$/);
    expect(msg.body).toBeNull();
  });

  it('persiste audio + transcribe (transcriber devuelve cadena)', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const store = new FilesystemMediaStore(mediaRoot);
    const transcriber = new ScriptedTranscriber(['me llamo Juan']);
    const msg = await normalizeAndPersistMessage(
      prisma,
      store,
      transcriber,
      rawMsg({
        whatsappMsgId: 'wa_audio',
        kind: 'audio',
        text: null,
        media: { buffer: Buffer.from('OGG'), mimetype: 'audio/ogg' },
      }),
      c.id,
    );
    expect(msg.kind).toBe('audio');
    expect(msg.mediaPath).toMatch(/\.ogg$/);
    expect(msg.body).toBe('me llamo Juan');
  });

  it('audio sin transcripción guarda body=null', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const store = new FilesystemMediaStore(mediaRoot);
    const msg = await normalizeAndPersistMessage(
      prisma,
      store,
      new NoopTranscriber(),
      rawMsg({
        whatsappMsgId: 'wa_audio2',
        kind: 'audio',
        text: null,
        media: { buffer: Buffer.from('OGG'), mimetype: 'audio/ogg' },
      }),
      c.id,
    );
    expect(msg.body).toBeNull();
    expect(msg.mediaPath).toMatch(/\.ogg$/);
  });

  it('sticker/location/other se persisten con kind correspondiente y body null', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const store = new FilesystemMediaStore(mediaRoot);
    const msg = await normalizeAndPersistMessage(
      prisma,
      store,
      new NoopTranscriber(),
      rawMsg({ whatsappMsgId: 'wa_sticker', kind: 'sticker', text: null, media: null }),
      c.id,
    );
    expect(msg.kind).toBe('sticker');
    expect(msg.body).toBeNull();
    expect(msg.mediaPath).toBeNull();
  });

  it('guarda raw payload serializado para auditoría', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const store = new FilesystemMediaStore(mediaRoot);
    const msg = await normalizeAndPersistMessage(
      prisma,
      store,
      new NoopTranscriber(),
      rawMsg({ raw: { weird: 'payload', n: 42 } }),
      c.id,
    );
    const reload = await prisma.message.findUnique({ where: { id: msg.id } });
    expect(reload!.raw).toBeTruthy();
    const parsed = JSON.parse(reload!.raw!);
    expect(parsed.weird).toBe('payload');
    expect(parsed.n).toBe(42);
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/pipeline/normalize.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/pipeline/normalize.ts`**

```ts
import type { PrismaClient, Message } from '@prisma/client';
import type { RawInboundMessage } from './types';
import type { MediaStore } from '../media/store';
import type { Transcriber } from '../media/transcriber';

/**
 * Crea un row `Message` para el mensaje entrante. Si tiene media, lo guarda
 * en el `MediaStore` y, en caso de audio, intenta transcribir con `Transcriber`.
 *
 * El message se persiste con jobId=null (lo asigna `resolveJobForMessage` después).
 */
export async function normalizeAndPersistMessage(
  prisma: PrismaClient,
  mediaStore: MediaStore,
  transcriber: Transcriber,
  raw: RawInboundMessage,
  contactId: string,
): Promise<Message> {
  // Primero creamos el message sin mediaPath (porque saveMedia necesita el id).
  const message = await prisma.message.create({
    data: {
      contactId,
      direction: 'inbound',
      kind: raw.kind,
      body: raw.text,
      whatsappMsgId: raw.whatsappMsgId,
      raw: JSON.stringify(raw.raw ?? {}),
    },
  });

  if (!raw.media) return message;

  // Hay media. Guardarla en el store con un jobId temporal "unassigned".
  // El jobId definitivo lo asigna resolveJobForMessage; el path no necesita reflejarlo
  // porque ya lo guardamos en mediaPath y no se renombra.
  const mediaPath = await mediaStore.save({
    buffer: raw.media.buffer,
    mimetype: raw.media.mimetype,
    contactId,
    jobId: 'unassigned',
    messageId: message.id,
  });

  let body: string | null = raw.text;
  if (raw.kind === 'audio') {
    const transcription = await transcriber.transcribe(raw.media.buffer, raw.media.mimetype);
    if (transcription && transcription.length > 0) {
      body = transcription;
    }
  }

  return prisma.message.update({
    where: { id: message.id },
    data: { mediaPath, body },
  });
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/pipeline/normalize.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/normalize.ts tests/pipeline/normalize.test.ts
git commit -m "feat(pipeline): normalizeAndPersistMessage con media y transcripción"
```

---

## Task 6: Resolver de contacto

**Files:**
- Create: `src/pipeline/resolveContact.ts`
- Create: `tests/pipeline/resolveContact.test.ts`

- [ ] **Step 1: Escribir tests**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { resolveContact } from '../../src/pipeline/resolveContact';
import { setBotActive, flagNonIntake, upsertContactByPhone } from '../../src/services/contact';

const adapter = new PrismaBetterSqlite3({ url: 'file:./data/intake.db' });
const prisma = new PrismaClient({ adapter });

async function cleanup() {
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
}

describe('resolveContact', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('crea contacto si no existe y devuelve shouldRespond=true', async () => {
    const r = await resolveContact(prisma, '+5215555555555');
    expect(r.shouldRespond).toBe(true);
    if (r.shouldRespond) {
      expect(r.contact.phoneE164).toBe('+5215555555555');
      expect(r.contact.botActive).toBe(true);
    }
  });

  it('reusa contacto existente', async () => {
    const c1 = await upsertContactByPhone(prisma, '+521');
    const r = await resolveContact(prisma, '+521');
    expect(r.shouldRespond).toBe(true);
    if (r.shouldRespond) expect(r.contact.id).toBe(c1.id);
  });

  it('shouldRespond=false si bot_active=false', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    await setBotActive(prisma, c.id, false);
    const r = await resolveContact(prisma, '+521');
    expect(r.shouldRespond).toBe(false);
    if (!r.shouldRespond) expect(r.reason).toBe('bot_paused');
  });

  it('shouldRespond=false si flagged_non_intake', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    await flagNonIntake(prisma, c.id, 'spam');
    const r = await resolveContact(prisma, '+521');
    expect(r.shouldRespond).toBe(false);
    if (!r.shouldRespond) expect(r.reason).toBe('flagged_non_intake');
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/pipeline/resolveContact.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/pipeline/resolveContact.ts`**

```ts
import type { PrismaClient, Contact } from '@prisma/client';
import { upsertContactByPhone } from '../services/contact';

export type ContactResolution =
  | { shouldRespond: true; contact: Contact }
  | { shouldRespond: false; contact: Contact; reason: 'bot_paused' | 'flagged_non_intake' };

export async function resolveContact(
  prisma: PrismaClient,
  fromPhoneE164: string,
): Promise<ContactResolution> {
  const contact = await upsertContactByPhone(prisma, fromPhoneE164);
  if (!contact.botActive) {
    return { shouldRespond: false, contact, reason: 'bot_paused' };
  }
  if (contact.flaggedNonIntake) {
    return { shouldRespond: false, contact, reason: 'flagged_non_intake' };
  }
  return { shouldRespond: true, contact };
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/pipeline/resolveContact.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/resolveContact.ts tests/pipeline/resolveContact.test.ts
git commit -m "feat(pipeline): resolveContact con check de bot_active y flagged"
```

---

## Task 7: Resolver de job (incluye primer mensaje y multi-job)

**Files:**
- Create: `src/pipeline/resolveJob.ts`
- Create: `tests/pipeline/resolveJob.test.ts`

- [ ] **Step 1: Escribir tests**

```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import {
  upsertContactByPhone,
} from '../../src/services/contact';
import {
  openJob,
  markReadyForReview,
  markInProgress,
  closeJob,
} from '../../src/services/job';
import { createEmptyIntakeFromSchema } from '../../src/services/intake';
import { resolveJobForMessage } from '../../src/pipeline/resolveJob';
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

describe('resolveJobForMessage', () => {
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('crea un job nuevo cuando el contacto no tiene jobs abiertos (primer mensaje)', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const r = await resolveJobForMessage(prisma, schema, c.id, 'msg_1');
    expect(r.job.status).toBe('OPEN_INTAKE');
    expect(r.isFirstMessage).toBe(true);
    expect(r.otherOpenJobs).toHaveLength(0);
  });

  it('reutiliza el único job abierto (OPEN_INTAKE)', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const existing = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    const r = await resolveJobForMessage(prisma, schema, c.id, 'msg_1');
    expect(r.job.id).toBe(existing.id);
    expect(r.isFirstMessage).toBe(false);
  });

  it('reutiliza el único job READY_FOR_REVIEW', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const j = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, j.id, 'Resumen del trabajo de tapicería');
    const r = await resolveJobForMessage(prisma, schema, c.id, 'msg_1');
    expect(r.job.id).toBe(j.id);
    expect(r.job.status).toBe('READY_FOR_REVIEW');
  });

  it('crea job nuevo cuando todos los previos están IN_PROGRESS o CLOSED', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const j1 = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await markReadyForReview(prisma, j1.id, 'R');
    await markInProgress(prisma, j1.id);
    const j2 = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    await closeJob(prisma, j2.id);

    const r = await resolveJobForMessage(prisma, schema, c.id, 'msg_1');
    expect(r.job.id).not.toBe(j1.id);
    expect(r.job.id).not.toBe(j2.id);
    expect(r.job.status).toBe('OPEN_INTAKE');
    expect(r.isFirstMessage).toBe(false);
  });

  it('cuando hay múltiples abiertos elige el más reciente y reporta los otros', async () => {
    const c = await upsertContactByPhone(prisma, '+521');
    const j1 = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));
    // pequeña pausa para garantizar orden por openedAt
    await new Promise((r) => setTimeout(r, 5));
    const j2 = await openJob(prisma, c.id, createEmptyIntakeFromSchema(schema));

    const r = await resolveJobForMessage(prisma, schema, c.id, 'msg_1');
    expect(r.job.id).toBe(j2.id); // más reciente
    expect(r.otherOpenJobs.map((j) => j.id)).toEqual([j1.id]);
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/pipeline/resolveJob.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/pipeline/resolveJob.ts`**

```ts
import type { PrismaClient, Job } from '@prisma/client';
import type { IntakeSchema } from '../config/intake-schema';
import { findOpenJobsForContact, openJob } from '../services/job';
import { createEmptyIntakeFromSchema } from '../services/intake';
import type { OpenJobSummary } from '../agent/types';

export interface JobResolution {
  job: Job;
  /** True si se creó un job nuevo porque el contacto no tenía ninguno abierto. */
  isFirstMessage: boolean;
  /** Otros jobs abiertos del contacto. Vacío en el caso típico. */
  otherOpenJobs: OpenJobSummary[];
}

/**
 * Estrategia:
 * - 0 jobs abiertos → crear OPEN_INTAKE nuevo, isFirstMessage=true (si nunca tuvo).
 * - 1 job abierto (OPEN_INTAKE o READY_FOR_REVIEW) → usarlo.
 * - 2+ jobs abiertos → usar el más reciente como `job`, el resto en `otherOpenJobs`.
 *   El agente decidirá luego con la tool `select_or_open_job` si el mensaje
 *   pertenece a otro o requiere abrir uno nuevo.
 */
export async function resolveJobForMessage(
  prisma: PrismaClient,
  schema: IntakeSchema,
  contactId: string,
  _messageId: string,
): Promise<JobResolution> {
  const open = await findOpenJobsForContact(prisma, contactId);

  if (open.length === 0) {
    const totalJobs = await prisma.job.count({ where: { contactId } });
    const isFirstMessage = totalJobs === 0;
    const job = await openJob(prisma, contactId, createEmptyIntakeFromSchema(schema));
    return { job, isFirstMessage, otherOpenJobs: [] };
  }

  if (open.length === 1) {
    return { job: open[0], isFirstMessage: false, otherOpenJobs: [] };
  }

  // 2+ jobs — más reciente primero
  const sorted = [...open].sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
  const [primary, ...rest] = sorted;
  return {
    job: primary,
    isFirstMessage: false,
    otherOpenJobs: rest.map((j) => ({
      id: j.id,
      summary: j.summary,
      openedAt: j.openedAt,
    })),
  };
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/pipeline/resolveJob.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/resolveJob.ts tests/pipeline/resolveJob.test.ts
git commit -m "feat(pipeline): resolveJobForMessage con primer mensaje y multi-job"
```

---

## Task 8: Debouncer

**Files:**
- Create: `src/pipeline/debouncer.ts`
- Create: `tests/pipeline/debouncer.test.ts`

- [ ] **Step 1: Escribir tests**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InboundDebouncer } from '../../src/pipeline/debouncer';

describe('InboundDebouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flush dispara una vez después de los ms configurados', async () => {
    const flushed: Array<string[]> = [];
    const deb = new InboundDebouncer({
      debounceMs: 5000,
      onFlush: async (contactId, ids) => {
        flushed.push(ids);
      },
    });
    deb.enqueue('c1', 'm1');
    deb.enqueue('c1', 'm2');
    deb.enqueue('c1', 'm3');
    await vi.advanceTimersByTimeAsync(5001);
    expect(flushed).toEqual([['m1', 'm2', 'm3']]);
  });

  it('cada mensaje nuevo resetea el timer (sólo dispara cuando hay 5s de silencio)', async () => {
    const flushed: Array<string[]> = [];
    const deb = new InboundDebouncer({
      debounceMs: 5000,
      onFlush: async (_c, ids) => {
        flushed.push(ids);
      },
    });
    deb.enqueue('c1', 'm1');
    await vi.advanceTimersByTimeAsync(3000);
    deb.enqueue('c1', 'm2');
    await vi.advanceTimersByTimeAsync(3000);
    expect(flushed).toHaveLength(0); // todavía nada — el timer se reseteó
    await vi.advanceTimersByTimeAsync(2001);
    expect(flushed).toEqual([['m1', 'm2']]);
  });

  it('contactos distintos se procesan en paralelo (cada uno tiene su buffer)', async () => {
    const flushed: Array<{ c: string; ids: string[] }> = [];
    const deb = new InboundDebouncer({
      debounceMs: 5000,
      onFlush: async (c, ids) => {
        flushed.push({ c, ids });
      },
    });
    deb.enqueue('c1', 'a');
    deb.enqueue('c2', 'b');
    await vi.advanceTimersByTimeAsync(5001);
    expect(flushed.sort((x, y) => x.c.localeCompare(y.c))).toEqual([
      { c: 'c1', ids: ['a'] },
      { c: 'c2', ids: ['b'] },
    ]);
  });

  it('mensajes que entran durante processing se procesan en la siguiente vuelta', async () => {
    const calls: Array<string[]> = [];
    let resolveFirst!: () => void;
    const firstFlush = new Promise<void>((r) => (resolveFirst = r));
    const deb = new InboundDebouncer({
      debounceMs: 5000,
      onFlush: async (_c, ids) => {
        calls.push(ids);
        if (calls.length === 1) await firstFlush; // bloquea el primero hasta que liberemos
      },
    });
    deb.enqueue('c1', 'm1');
    await vi.advanceTimersByTimeAsync(5001); // dispara el primer flush, queda bloqueado
    deb.enqueue('c1', 'm2'); // entra mientras processing=true
    deb.enqueue('c1', 'm3');
    // Soltamos el primero
    resolveFirst();
    await vi.runAllTimersAsync();
    expect(calls).toEqual([['m1'], ['m2', 'm3']]);
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/pipeline/debouncer.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/pipeline/debouncer.ts`**

```ts
export interface DebouncerOptions {
  debounceMs: number;
  /** Callback cuando el debouncer dispara para un contacto. */
  onFlush: (contactId: string, messageIds: string[]) => Promise<void>;
}

interface BufferState {
  messages: string[];
  timer: NodeJS.Timeout | null;
  processing: boolean;
}

/**
 * Acumula mensajes por contacto y dispara `onFlush` cuando hay
 * `debounceMs` de silencio para ese contacto.
 *
 * Reglas:
 * - Mensaje nuevo: si no hay buffer, crea uno y arranca timer.
 *   Si hay buffer pero NO está processing, agrega y RESETEA timer.
 *   Si está processing, agrega al buffer (se procesará en la próxima vuelta).
 * - Timer dispara: marca processing=true, llama onFlush con los IDs,
 *   al terminar marca processing=false. Si hay mensajes acumulados
 *   durante el proceso, arranca un nuevo timer.
 */
export class InboundDebouncer {
  private readonly buffers = new Map<string, BufferState>();

  constructor(private readonly opts: DebouncerOptions) {}

  enqueue(contactId: string, messageId: string): void {
    let buf = this.buffers.get(contactId);
    if (!buf) {
      buf = { messages: [], timer: null, processing: false };
      this.buffers.set(contactId, buf);
    }
    buf.messages.push(messageId);
    if (buf.processing) return; // se procesa en la próxima vuelta
    this.resetTimer(contactId, buf);
  }

  private resetTimer(contactId: string, buf: BufferState): void {
    if (buf.timer) clearTimeout(buf.timer);
    buf.timer = setTimeout(() => {
      void this.flush(contactId).catch(() => {
        // El handler de onFlush debería capturar sus propios errores.
      });
    }, this.opts.debounceMs);
  }

  private async flush(contactId: string): Promise<void> {
    const buf = this.buffers.get(contactId);
    if (!buf) return;
    if (buf.messages.length === 0) return;
    buf.processing = true;
    buf.timer = null;
    const ids = buf.messages.splice(0, buf.messages.length);
    try {
      await this.opts.onFlush(contactId, ids);
    } finally {
      buf.processing = false;
      // Si entraron mensajes mientras estábamos procesando, arrancar nueva ventana.
      if (buf.messages.length > 0) {
        this.resetTimer(contactId, buf);
      }
    }
  }

  /** Para testing/cleanup: vacía buffers sin disparar onFlush. */
  reset(): void {
    for (const buf of this.buffers.values()) {
      if (buf.timer) clearTimeout(buf.timer);
    }
    this.buffers.clear();
  }
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/pipeline/debouncer.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/debouncer.ts tests/pipeline/debouncer.test.ts
git commit -m "feat(pipeline): InboundDebouncer con timer reset y serialización por contacto"
```

---

## Task 9: Coordinator — orquestación end-to-end

**Files:**
- Create: `src/pipeline/coordinator.ts`
- Create: `tests/pipeline/coordinator.test.ts`

- [ ] **Step 1: Escribir tests**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemMediaStore } from '../../src/media/store';
import { NoopTranscriber, ScriptedTranscriber } from '../../src/media/transcriber';
import { NoopNotifier } from '../../src/services/notification';
import { MemorySender } from '../../src/services/outbound';
import { InboundCoordinator } from '../../src/pipeline/coordinator';
import type { RawInboundMessage, PipelineDeps } from '../../src/pipeline/types';
import type { AgentFactory, AgentLike } from '../../src/agent/types';
import type { Config, Profile } from '../../src/config/schema';
import type { IntakeSchema } from '../../src/config/intake-schema';
import { parseJobIntake } from '../../src/services/job';

const adapter = new PrismaBetterSqlite3({ url: 'file:./data/intake.db' });
const prisma = new PrismaClient({ adapter });

const schema: IntakeSchema = {
  $businessName: 'Tapicería',
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
  promptVars: { promptTemplate: 'X', vars: {} },
  businessFacts: { facts: [], freeContext: '' },
  welcome: '¡Hola! Soy el asistente.',
  hash: 'h',
};

const config: Config = {
  profile: './profiles/tapiceria',
  model: 'm',
  maxSteps: 6,
  temperature: 0.4,
  debounceMs: 50,
  fallbackOnError: 'oops',
  outOfScopeNudge: '',
  hours: { enabled: false, timezone: 'UTC', schedule: {}, outOfHoursNotice: '' },
  owner: { phoneE164: '+5215', notifyOnReady: true, notifyOnDisconnect: true, panelUrl: 'http://x' },
  panel: { users: [] },
  media: { storeDir: './media', transcribeAudio: true, whisperModel: 'openai/whisper-1' },
  limits: { monthlyCostUsd: 50, alertOnCostUsd: 40, maxConsecutiveErrors: 3 },
} as Config;

let mediaRoot: string;

async function cleanup() {
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.job.deleteMany();
  await prisma.contact.deleteMany();
}

function rawMsg(overrides: Partial<RawInboundMessage> = {}): RawInboundMessage {
  return {
    whatsappMsgId: 'wa_' + Math.random().toString(36).slice(2),
    fromPhoneE164: '+5215555',
    chatKind: 'individual',
    fromMe: false,
    kind: 'text',
    text: 'hola',
    media: null,
    raw: {},
    receivedAt: '2026-05-25T10:00:00Z',
    ...overrides,
  };
}

const stubFactory = (responseText: string): AgentFactory => () => {
  const agent: AgentLike = {
    on: () => {},
    sendSync: async () => ({
      text: responseText,
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.0001 },
    }),
  };
  return agent;
};

async function makeDeps(extra: Partial<PipelineDeps> = {}): Promise<PipelineDeps> {
  mediaRoot = await mkdtemp(join(tmpdir(), 'intake-coord-'));
  return {
    prisma,
    config,
    profile,
    notifier: new NoopNotifier(),
    sender: new MemorySender(),
    transcriber: new NoopTranscriber(),
    mediaStore: new FilesystemMediaStore(mediaRoot),
    agentFactory: stubFactory('Hola, ¿en qué te ayudo?'),
    now: () => new Date('2026-05-25T10:00:00Z'),
    ...extra,
  };
}

describe('InboundCoordinator', () => {
  beforeEach(async () => {
    await cleanup();
    vi.useFakeTimers();
  });
  afterEach(async () => {
    vi.useRealTimers();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  });

  it('procesa un mensaje de texto → debouncer → agent → sender', async () => {
    const deps = await makeDeps();
    const coord = new InboundCoordinator(deps);
    await coord.handleInbound(rawMsg({ text: 'Hola, tengo un sillón' }));
    await vi.advanceTimersByTimeAsync(100);
    const sender = deps.sender as MemorySender;
    // Bienvenida (primer mensaje) + respuesta del agente
    expect(sender.sent.length).toBeGreaterThanOrEqual(2);
    expect(sender.sent[0].text).toContain('Hola');
    expect(sender.sent.at(-1)!.text).toContain('en qué te ayudo');
  });

  it('descarta mensajes de grupo sin tocar nada', async () => {
    const deps = await makeDeps();
    const coord = new InboundCoordinator(deps);
    await coord.handleInbound(rawMsg({ chatKind: 'group' }));
    await vi.advanceTimersByTimeAsync(100);
    const messageCount = await prisma.message.count();
    expect(messageCount).toBe(0);
    expect((deps.sender as MemorySender).sent).toHaveLength(0);
  });

  it('descarta duplicados por whatsappMsgId', async () => {
    const deps = await makeDeps();
    const coord = new InboundCoordinator(deps);
    const msg = rawMsg({ whatsappMsgId: 'wa_dup' });
    await coord.handleInbound(msg);
    await coord.handleInbound(msg);
    await vi.advanceTimersByTimeAsync(100);
    const count = await prisma.message.count();
    expect(count).toBe(1);
  });

  it('cuando bot_active=false guarda el mensaje pero no responde', async () => {
    const deps = await makeDeps();
    const coord = new InboundCoordinator(deps);
    // Primero: un mensaje para crear el contacto
    await coord.handleInbound(rawMsg({ whatsappMsgId: 'wa1', text: 'hola' }));
    await vi.advanceTimersByTimeAsync(100);
    // Pausa el bot
    await prisma.contact.updateMany({ data: { botActive: false } });
    (deps.sender as MemorySender).clear();
    // Llega un nuevo mensaje
    await coord.handleInbound(rawMsg({ whatsappMsgId: 'wa2', text: 'sigues ahí?' }));
    await vi.advanceTimersByTimeAsync(100);
    const sender = deps.sender as MemorySender;
    expect(sender.sent).toHaveLength(0);
    const count = await prisma.message.count({ where: { whatsappMsgId: 'wa2' } });
    expect(count).toBe(1);
  });

  it('actualiza intake.media.audio_count cuando llega un audio transcrito', async () => {
    const deps = await makeDeps({ transcriber: new ScriptedTranscriber(['me llamo Juan']) });
    const coord = new InboundCoordinator(deps);
    await coord.handleInbound(
      rawMsg({
        kind: 'audio',
        text: null,
        media: { buffer: Buffer.from('ogg'), mimetype: 'audio/ogg' },
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    const job = await prisma.job.findFirst();
    const intake = parseJobIntake(job!);
    expect(intake.media.audio_count).toBe(1);
  });

  it('múltiples mensajes consecutivos se agrupan en un solo agent run', async () => {
    let calls = 0;
    const factory: AgentFactory = () => ({
      on: () => {},
      sendSync: async () => {
        calls++;
        return { text: 'ok', usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } };
      },
    });
    const deps = await makeDeps({ agentFactory: factory });
    const coord = new InboundCoordinator(deps);
    await coord.handleInbound(rawMsg({ whatsappMsgId: 'a', text: 'uno' }));
    await coord.handleInbound(rawMsg({ whatsappMsgId: 'b', text: 'dos' }));
    await coord.handleInbound(rawMsg({ whatsappMsgId: 'c', text: 'tres' }));
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/pipeline/coordinator.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/pipeline/coordinator.ts`**

```ts
import type { Message } from '@prisma/client';
import type { PipelineDeps, RawInboundMessage } from './types';
import { prefilter, alreadySeen } from './idempotency';
import { normalizeAndPersistMessage } from './normalize';
import { resolveContact } from './resolveContact';
import { resolveJobForMessage } from './resolveJob';
import { InboundDebouncer } from './debouncer';
import { parseJobIntake } from '../services/job';
import { runAgentTurn } from '../agent/runner';
import { logger } from '../lib/logger';
import type { BatchMessage } from '../agent/types';

export class InboundCoordinator {
  private readonly debouncer: InboundDebouncer;

  constructor(private readonly deps: PipelineDeps) {
    this.debouncer = new InboundDebouncer({
      debounceMs: deps.config.debounceMs,
      onFlush: (contactId, messageIds) => this.flushBatch(contactId, messageIds),
    });
  }

  /** Punto de entrada — recibe un mensaje crudo del adapter. */
  async handleInbound(raw: RawInboundMessage): Promise<void> {
    // 1. Pre-filter (grupos, propios, status).
    const pf = prefilter(raw);
    if (pf.rejected) {
      logger.debug({ reason: pf.reason, whatsappMsgId: raw.whatsappMsgId }, 'inbound.prefiltered');
      return;
    }

    // 2. Idempotencia
    if (await alreadySeen(this.deps.prisma, raw.whatsappMsgId)) {
      logger.debug({ whatsappMsgId: raw.whatsappMsgId }, 'inbound.duplicate');
      return;
    }

    // 3. Resolver contacto
    const contactRes = await resolveContact(this.deps.prisma, raw.fromPhoneE164);

    // 4. Resolver job (siempre persistimos el mensaje, sin importar shouldRespond,
    //    así el panel del dueño verá lo que entró aunque el bot estuviera pausado).
    const jobRes = await resolveJobForMessage(
      this.deps.prisma,
      this.deps.profile.intakeSchema,
      contactRes.contact.id,
      raw.whatsappMsgId,
    );

    // 5. Normalizar y persistir el mensaje (con jobId)
    const messageWithoutJob = await normalizeAndPersistMessage(
      this.deps.prisma,
      this.deps.mediaStore,
      this.deps.transcriber,
      raw,
      contactRes.contact.id,
    );
    const message = await this.deps.prisma.message.update({
      where: { id: messageWithoutJob.id },
      data: { jobId: jobRes.job.id },
    });

    // 6. Incrementar contadores de media en el intake
    if (message.kind === 'image' || message.kind === 'audio') {
      const intake = parseJobIntake(jobRes.job);
      if (message.kind === 'image') intake.media.photo_count += 1;
      else intake.media.audio_count += 1;
      await this.deps.prisma.job.update({
        where: { id: jobRes.job.id },
        data: { intake: JSON.stringify(intake) },
      });
    }

    // 7. Si bot está pausado o contacto flagged, parar aquí.
    if (!contactRes.shouldRespond) {
      logger.info(
        { contactId: contactRes.contact.id, reason: contactRes.reason },
        'inbound.no_response',
      );
      return;
    }

    // 8. Si es primer mensaje, enviar la bienvenida ANTES de procesar.
    if (jobRes.isFirstMessage) {
      const welcome = applyTemplate(this.deps.profile.welcome, {
        businessName: this.deps.profile.intakeSchema.$businessName,
        businessDomain: this.deps.profile.intakeSchema.$businessDomain,
      });
      await this.deps.sender.sendText(contactRes.contact.phoneE164, welcome);
    }

    // 9. Encolar para el debouncer
    this.debouncer.enqueue(contactRes.contact.id, message.id);
  }

  private async flushBatch(contactId: string, messageIds: string[]): Promise<void> {
    logger.debug({ contactId, count: messageIds.length }, 'inbound.flush');
    const contact = await this.deps.prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) return;
    if (!contact.botActive || contact.flaggedNonIntake) return; // por si cambió mientras esperaba

    // Recuperar los mensajes y derivar el job.
    const messages = await this.deps.prisma.message.findMany({
      where: { id: { in: messageIds } },
      orderBy: { createdAt: 'asc' },
    });
    if (messages.length === 0) return;
    const jobId = messages[messages.length - 1].jobId;
    if (!jobId) return;
    const job = await this.deps.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return;

    // Listar OTROS jobs abiertos (excluyendo el actual).
    const allOpen = await this.deps.prisma.job.findMany({
      where: {
        contactId,
        status: { in: ['OPEN_INTAKE', 'READY_FOR_REVIEW'] },
        NOT: { id: jobId },
      },
      orderBy: { openedAt: 'asc' },
    });

    const batchMessages: BatchMessage[] = messages.map((m): BatchMessage => ({
      id: m.id,
      kind: m.kind as BatchMessage['kind'],
      body: m.body,
      mediaPath: m.mediaPath,
    }));

    const intake = parseJobIntake(job);

    const result = await runAgentTurn(
      {
        job,
        contact,
        intake,
        batchMessages,
        otherOpenJobs: allOpen.map((j) => ({
          id: j.id,
          summary: j.summary,
          openedAt: j.openedAt,
        })),
        now: this.deps.now().toISOString(),
      },
      {
        prisma: this.deps.prisma,
        config: this.deps.config,
        profile: this.deps.profile,
        notifier: this.deps.notifier,
        createAgent: this.deps.agentFactory,
      },
    );

    // 10. Enviar la respuesta del agente
    if (result.responseText && result.responseText.trim().length > 0) {
      await this.deps.sender.sendText(contact.phoneE164, result.responseText);
      await this.deps.prisma.message.create({
        data: {
          jobId: job.id,
          contactId: contact.id,
          direction: 'outbound',
          kind: 'text',
          body: result.responseText,
        },
      });
    }
  }
}

function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/pipeline/coordinator.test.ts
```

Expected: 6 passed.

Si algún test falla por temas de fake timers + promesas, prueba reemplazar `vi.advanceTimersByTimeAsync(100)` por `vi.runAllTimersAsync()` y/o agregar pequeños `await` para que las promises resolvan. Reporta cualquier patrón persistente.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/coordinator.ts tests/pipeline/coordinator.test.ts
git commit -m "feat(pipeline): InboundCoordinator orquesta prefilter → normalize → debounce → agent → sender"
```

---

## Task 10: CLI inbound-demo

**Files:**
- Create: `src/cli/inbound-demo.ts`
- Modify: `package.json` (script)

- [ ] **Step 1: Crear `src/cli/inbound-demo.ts`**

```ts
#!/usr/bin/env tsx
/**
 * Smoke test del pipeline end-to-end con un AgentFactory stub y sin red.
 *
 * Simula 3 mensajes consecutivos de un cliente y muestra:
 * - mensajes persistidos
 * - respuestas enviadas (vía MemorySender)
 * - estado final del intake
 *
 * El stub del agent llena el campo client.name en el primer batch.
 */
import { loadConfig, loadProfile } from '../config/loader';
import { getPrisma, disconnectPrisma } from '../storage/client';
import { FilesystemMediaStore } from '../media/store';
import { NoopTranscriber } from '../media/transcriber';
import { NoopNotifier } from '../services/notification';
import { MemorySender } from '../services/outbound';
import { InboundCoordinator } from '../pipeline/coordinator';
import { parseJobIntake } from '../services/job';
import type { AgentFactory, AgentLike } from '../agent/types';
import type { RawInboundMessage } from '../pipeline/types';

const stubFactory: AgentFactory = (cfg) => {
  const tools = cfg.tools as any[];
  const agent: AgentLike = {
    on: () => {},
    sendSync: async () => {
      const updateIntake = tools.find((t) => t.name === 'update_intake');
      if (updateIntake) {
        await updateIntake.execute({
          fields: [{ path: 'client.name', value: 'María González' }],
        });
      }
      return {
        text: 'Genial María, ya anoté tu nombre. ¿Qué mueble quieres atender?',
        usage: { inputTokens: 200, outputTokens: 25, costUsd: 0.0015 },
      };
    },
  };
  return agent;
};

function msg(idx: number, body: string): RawInboundMessage {
  return {
    whatsappMsgId: `demo_msg_${Date.now()}_${idx}`,
    fromPhoneE164: '+5210000000088',
    chatKind: 'individual',
    fromMe: false,
    kind: 'text',
    text: body,
    media: null,
    raw: {},
    receivedAt: new Date().toISOString(),
  };
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const config = await loadConfig('./config.json');
  const profile = await loadProfile(config.profile);
  const prisma = getPrisma();
  const sender = new MemorySender();

  const coord = new InboundCoordinator({
    prisma,
    config,
    profile,
    notifier: new NoopNotifier(),
    sender,
    transcriber: new NoopTranscriber(),
    mediaStore: new FilesystemMediaStore('./media'),
    agentFactory: stubFactory,
    now: () => new Date(),
  });

  console.log('Enviando 3 mensajes consecutivos…');
  await coord.handleInbound(msg(1, 'Hola'));
  await coord.handleInbound(msg(2, 'Soy María González'));
  await coord.handleInbound(msg(3, 'Quiero retapizar un sillón'));

  console.log(`Esperando ${config.debounceMs}ms para que el debouncer dispare…`);
  await sleep(config.debounceMs + 500);

  console.log('\n=== Mensajes enviados por MemorySender ===');
  for (const s of sender.sent) {
    console.log(`→ ${s.to}: ${s.text}`);
  }

  const contact = await prisma.contact.findUnique({ where: { phoneE164: '+5210000000088' } });
  if (contact) {
    const job = await prisma.job.findFirst({ where: { contactId: contact.id } });
    if (job) {
      console.log('\n=== Intake final ===');
      console.log(JSON.stringify(parseJobIntake(job), null, 2).slice(0, 500), '...');
    }
  }

  await disconnectPrisma();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Agregar script al `package.json`**

En la sección `scripts`, agrega:

```json
"cli:inbound-demo": "tsx src/cli/inbound-demo.ts"
```

- [ ] **Step 3: Smoke test manual**

```bash
npm run cli:inbound-demo
```

Expected: imprime que envió 3 mensajes, luego al menos 2 outbound (welcome + respuesta del agente), y el intake final con `client.name.value = "María González"`.

- [ ] **Step 4: Commit**

```bash
git add src/cli/inbound-demo.ts package.json
git commit -m "feat(cli): inbound-demo simula adapter y prueba el pipeline end-to-end"
```

---

## Task 11: Verificación final del Plan 3

- [ ] **Step 1: Correr la batería completa**

```bash
npm test
```

Expected: todos los tests pasan (98 del Plan 1+2 + nuevos del Plan 3, debería ser ~130-135 total).

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: cero errores.

- [ ] **Step 3: CLI smoke**

```bash
npm run cli:inbound-demo
```

Expected: respuesta del agente, intake con client.name lleno.

- [ ] **Step 4: Commit final si quedó algo**

```bash
git status
# si todo limpio, OK. Si hay un ajuste menor:
git add -A && git commit -m "chore: fin de Plan 3 - inbound pipeline listo"
```

---

## Cobertura del spec en este plan

| Sección del spec | Tarea(s) que lo cubren |
|------------------|------------------------|
| §3 Pre-filter (grupos/propios/status) | T4 (`prefilter`) |
| §3 Idempotencia por whatsappMsgId | T4 (`alreadySeen`) + T5 (Message UNIQUE) |
| §3 Normalize texto/imagen/audio + media-store | T5 |
| §3 Whisper transcription | T3 (`WhisperTranscriber`) + T5 integración |
| §3 Resolver contacto, bot_active, flagged | T6 |
| §3 Resolver job: 0/1/2+ abiertos | T7 |
| §3 Debouncer 5s, paralelo entre contactos, lock por contacto | T8 |
| §3 Primer contacto: welcome.txt antes del agente | T9 (`handleInbound`) |
| Outbound stub (Plan 4 lo reemplaza) | T1 (`MemorySender`) |
| Llamada a `runAgentTurn` con BatchMessage[] | T9 |

Lo que NO está en este plan:
- Adapter Baileys real (Plan 4).
- `WhatsappSender` real (Plan 4).
- Panel web (Plan 5).
- Notificación al dueño vía WhatsApp (Plan 4 reemplaza `NoopNotifier`).
- Recuperación de mensajes huérfanos al reconectar (Plan 4).
