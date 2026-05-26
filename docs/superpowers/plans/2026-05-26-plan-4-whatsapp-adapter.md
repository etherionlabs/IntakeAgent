# Plan 4 — WhatsApp adapter (Baileys) + outbound + notificación real

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar al sistema con WhatsApp Web a través de Baileys: emparejamiento con QR persistido en disco, escucha de mensajes entrantes que se traducen a `RawInboundMessage` y se pasan a `InboundCoordinator`, envío de respuestas vía `WhatsAppSender` (reemplaza `MemorySender`), notificación al dueño en eventos clave vía `WhatsAppNotifier` (reemplaza `NoopNotifier`). Reconexión automática y aviso de desconexión.

**Architecture:** Una capa de adapter pura (`BaileysAdapter`) maneja socket, sesión persistente (multi-file auth), eventos y reconexión. La función pura `mapWAMessageToRaw` traduce el payload de Baileys a nuestro `RawInboundMessage` (testeable sin red). `WhatsAppSender` y `WhatsAppNotifier` reciben un `Socket` mínimo por inyección. El bootstrap (`src/index.ts`) une todo: carga config, inicia adapter, instancia `InboundCoordinator`, conecta handlers.

**Tech Stack:** `baileys@^6.17.16` (versión estable, paquete sin scope), `qrcode-terminal` para imprimir QR. Sesión persistida en `./data/baileys-session/` (gitignored).

**Spec de referencia:** [`docs/superpowers/specs/2026-05-25-intake-recepcionista-design.md`](../specs/2026-05-25-intake-recepcionista-design.md) §2 (whatsapp-adapter) + §6 (notificación al dueño).

**Planes anteriores:** [Plan 1](2026-05-25-plan-1-fundacion.md), [Plan 2](2026-05-25-plan-2-agent-core.md), [Plan 3](2026-05-26-plan-3-inbound-pipeline.md).

---

## Estructura de archivos al finalizar este plan

```
src/
├── adapters/whatsapp/
│   ├── types.ts            # Socket (interfaz mínima), AdapterEvents
│   ├── mapMessage.ts       # mapWAMessageToRaw (pura, testeable)
│   ├── sender.ts           # WhatsAppSender implementa OutboundSender
│   ├── notifier.ts         # WhatsAppNotifier implementa Notifier
│   ├── connection.ts       # BaileysConnection (gestiona socket + reconnect)
│   └── adapter.ts          # BaileysAdapter (orquesta connection + handlers)
└── index.ts                # Bootstrap del proceso
```

Tests:

```
tests/
└── adapters/whatsapp/
    ├── mapMessage.test.ts
    ├── sender.test.ts
    └── notifier.test.ts
```

(El `BaileysConnection` y `BaileysAdapter` no tienen tests automatizados — su correctitud se verifica con el smoke manual final.)

---

## Task 1: Instalar Baileys + tipos mínimos del socket

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `.gitignore` (agregar sesión)
- Create: `src/adapters/whatsapp/types.ts`

- [ ] **Step 1: Instalar dependencias**

```bash
npm install baileys@6.17.16 qrcode-terminal
npm install -D @types/qrcode-terminal
```

Baileys 7.x es release-candidate; usamos 6.17.16 estable.

- [ ] **Step 2: Verificar la API del paquete instalado**

```bash
ls node_modules/baileys/lib/
cat node_modules/baileys/package.json | head -30
```

Identifica:
- El entry point (`main`/`module`)
- Las exports clave: `makeWASocket` (default export?), `useMultiFileAuthState`, `DisconnectReason`, `proto`.
- Si es CJS o ESM.

**Reporta lo que encuentres.** El resto del plan asume `makeWASocket` es export default y `useMultiFileAuthState`, `DisconnectReason`, `proto` son named exports. Adapta si difiere.

- [ ] **Step 3: Agregar sesión y QR al `.gitignore`**

Append a `.gitignore`:

```
# Baileys session
data/baileys-session/
*.qr.png
```

- [ ] **Step 4: Crear `src/adapters/whatsapp/types.ts`**

```ts
/**
 * Interfaz mínima del socket de Baileys que nuestro código consume.
 * Esto nos permite inyectar mocks en tests sin importar Baileys real.
 */
export interface WASocket {
  sendMessage(jid: string, content: { text: string }): Promise<unknown>;
  end?: (error?: Error) => void;
}

/**
 * Estado de la conexión, expuesto por el adapter para que el panel (Plan 5)
 * y la observabilidad lo consuman.
 */
export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'qr_required'
  | 'connected'
  | 'logged_out';

export interface AdapterStateSnapshot {
  status: ConnectionStatus;
  /** Data URL o ASCII del QR cuando status='qr_required'. */
  qr: string | null;
  lastError: string | null;
  /** ISO 8601 de última conexión exitosa. */
  lastConnectedAt: string | null;
}
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errores.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .gitignore src/adapters/whatsapp/types.ts
git commit -m "feat(whatsapp): instala baileys y define tipos del socket"
```

## Report

- Versión exacta de `baileys` instalada.
- Estructura de exports del paquete (relevante: `makeWASocket`, `useMultiFileAuthState`, `DisconnectReason`, `proto`).
- Commit SHA.

---

## Task 2: `mapWAMessageToRaw` — función pura

**Files:**
- Create: `src/adapters/whatsapp/mapMessage.ts`
- Create: `tests/adapters/whatsapp/mapMessage.test.ts`

- [ ] **Step 1: Escribir tests**

`tests/adapters/whatsapp/mapMessage.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { mapWAMessageToRaw } from '../../../src/adapters/whatsapp/mapMessage';

/**
 * Tests de la función pura mapWAMessageToRaw.
 *
 * El payload de Baileys es complejo; nosotros sólo extraemos los campos
 * necesarios. Para evitar acoplar tests a la forma EXACTA, usamos un downloader
 * stub que devuelve un Buffer fijo y construimos `proto.IWebMessageInfo`-like
 * objetos con la mínima estructura que el código usa.
 */

const baseKey = {
  remoteJid: '5215555555555@s.whatsapp.net',
  fromMe: false,
  id: 'WAID_1',
};

describe('mapWAMessageToRaw', () => {
  it('mensaje de texto plano', async () => {
    const wam = {
      key: baseKey,
      messageTimestamp: 1748000000,
      message: { conversation: 'Hola, tengo un sillón' },
    };
    const out = await mapWAMessageToRaw(wam as any, async () => Buffer.alloc(0));
    expect(out).not.toBeNull();
    expect(out!.kind).toBe('text');
    expect(out!.text).toBe('Hola, tengo un sillón');
    expect(out!.fromPhoneE164).toBe('+5215555555555');
    expect(out!.whatsappMsgId).toBe('WAID_1');
    expect(out!.chatKind).toBe('individual');
    expect(out!.fromMe).toBe(false);
    expect(out!.media).toBeNull();
  });

  it('mensaje de extendedTextMessage también se trata como texto', async () => {
    const wam = {
      key: baseKey,
      messageTimestamp: 1748000000,
      message: { extendedTextMessage: { text: 'con cita' } },
    };
    const out = await mapWAMessageToRaw(wam as any, async () => Buffer.alloc(0));
    expect(out!.kind).toBe('text');
    expect(out!.text).toBe('con cita');
  });

  it('grupo: chatKind=group y rechaza la fase posterior (pero el map sí lo devuelve)', async () => {
    const wam = {
      key: { ...baseKey, remoteJid: '120363000000000000@g.us' },
      messageTimestamp: 1748000000,
      message: { conversation: 'hola grupo' },
    };
    const out = await mapWAMessageToRaw(wam as any, async () => Buffer.alloc(0));
    expect(out!.chatKind).toBe('group');
    expect(out!.fromPhoneE164).toBe('+120363000000000000');
  });

  it('status broadcast', async () => {
    const wam = {
      key: { ...baseKey, remoteJid: 'status@broadcast' },
      messageTimestamp: 1748000000,
      message: { conversation: 'x' },
    };
    const out = await mapWAMessageToRaw(wam as any, async () => Buffer.alloc(0));
    expect(out!.chatKind).toBe('status');
  });

  it('imagen: llama al downloader y devuelve media buffer + mimetype', async () => {
    const wam = {
      key: baseKey,
      messageTimestamp: 1748000000,
      message: {
        imageMessage: {
          mimetype: 'image/jpeg',
          caption: 'mira mi sillón',
        },
      },
    };
    const downloader = vi.fn().mockResolvedValue(Buffer.from('FAKE_JPEG'));
    const out = await mapWAMessageToRaw(wam as any, downloader);
    expect(out!.kind).toBe('image');
    expect(out!.text).toBe('mira mi sillón');
    expect(out!.media).not.toBeNull();
    expect(out!.media!.buffer.toString()).toBe('FAKE_JPEG');
    expect(out!.media!.mimetype).toBe('image/jpeg');
    expect(downloader).toHaveBeenCalledTimes(1);
  });

  it('audio: kind=audio, media + mimetype, text=null', async () => {
    const wam = {
      key: baseKey,
      messageTimestamp: 1748000000,
      message: {
        audioMessage: { mimetype: 'audio/ogg; codecs=opus' },
      },
    };
    const out = await mapWAMessageToRaw(
      wam as any,
      async () => Buffer.from('OGG_OPUS'),
    );
    expect(out!.kind).toBe('audio');
    expect(out!.media!.mimetype).toContain('ogg');
    expect(out!.text).toBeNull();
  });

  it('sticker → kind=sticker, media=null', async () => {
    const wam = {
      key: baseKey,
      messageTimestamp: 1748000000,
      message: { stickerMessage: {} },
    };
    const out = await mapWAMessageToRaw(wam as any, async () => Buffer.alloc(0));
    expect(out!.kind).toBe('sticker');
    expect(out!.media).toBeNull();
  });

  it('mensaje vacío o sin contenido reconocible → null', async () => {
    const wam = { key: baseKey, messageTimestamp: 1748000000, message: null };
    const out = await mapWAMessageToRaw(wam as any, async () => Buffer.alloc(0));
    expect(out).toBeNull();
  });

  it('fromMe=true se preserva', async () => {
    const wam = {
      key: { ...baseKey, fromMe: true },
      messageTimestamp: 1748000000,
      message: { conversation: 'yo' },
    };
    const out = await mapWAMessageToRaw(wam as any, async () => Buffer.alloc(0));
    expect(out!.fromMe).toBe(true);
  });

  it('receivedAt usa messageTimestamp si está presente', async () => {
    const wam = {
      key: baseKey,
      messageTimestamp: 1748000000, // 2025-05-23 16:53:20 UTC
      message: { conversation: 'x' },
    };
    const out = await mapWAMessageToRaw(wam as any, async () => Buffer.alloc(0));
    expect(out!.receivedAt).toMatch(/^2025-05-23T/);
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/adapters/whatsapp/mapMessage.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implementar `src/adapters/whatsapp/mapMessage.ts`**

```ts
import type { RawInboundMessage } from '../../pipeline/types';

/**
 * Tipo mínimo de un WAMessage que usamos. Coincide con `proto.IWebMessageInfo`
 * de Baileys, pero solo en los campos que tocamos.
 */
export interface WAMessageLike {
  key: {
    remoteJid?: string | null;
    fromMe?: boolean | null;
    id?: string | null;
    participant?: string | null;
  };
  messageTimestamp?: number | Long | null;
  message?: {
    conversation?: string | null;
    extendedTextMessage?: { text?: string | null } | null;
    imageMessage?: { mimetype?: string | null; caption?: string | null } | null;
    audioMessage?: { mimetype?: string | null } | null;
    videoMessage?: { mimetype?: string | null; caption?: string | null } | null;
    stickerMessage?: unknown;
    locationMessage?: unknown;
    documentMessage?: { mimetype?: string | null; caption?: string | null } | null;
  } | null;
}

interface Long {
  toNumber(): number;
}

export type Downloader = (wam: WAMessageLike) => Promise<Buffer>;

/**
 * Convierte un mensaje crudo de Baileys a `RawInboundMessage`.
 * Devuelve null si no es procesable (sin contenido).
 *
 * `downloader` es la función para bajar el buffer de media; se inyecta para tests.
 */
export async function mapWAMessageToRaw(
  wam: WAMessageLike,
  downloader: Downloader,
): Promise<RawInboundMessage | null> {
  const message = wam.message;
  if (!message) return null;

  const remoteJid = wam.key.remoteJid ?? '';
  const chatKind = inferChatKind(remoteJid);
  const fromPhoneE164 = jidToE164(remoteJid, wam.key.participant ?? null);
  const whatsappMsgId = wam.key.id ?? `unknown_${Date.now()}`;
  const fromMe = wam.key.fromMe === true;
  const receivedAt = timestampToIso(wam.messageTimestamp);

  // Texto plano
  if (typeof message.conversation === 'string' && message.conversation.length > 0) {
    return base('text', message.conversation, null);
  }
  if (message.extendedTextMessage?.text) {
    return base('text', message.extendedTextMessage.text, null);
  }

  // Imagen (texto = caption opcional)
  if (message.imageMessage) {
    const buffer = await downloader(wam);
    return base(
      'image',
      message.imageMessage.caption ?? null,
      { buffer, mimetype: message.imageMessage.mimetype ?? 'image/jpeg' },
    );
  }

  // Audio
  if (message.audioMessage) {
    const buffer = await downloader(wam);
    return base(
      'audio',
      null,
      { buffer, mimetype: message.audioMessage.mimetype ?? 'audio/ogg' },
    );
  }

  // Video (lo tratamos como "other" pero conservamos caption como texto)
  if (message.videoMessage) {
    return base('other', message.videoMessage.caption ?? null, null);
  }
  if (message.documentMessage) {
    return base('other', message.documentMessage.caption ?? null, null);
  }

  // Sticker / location
  if (message.stickerMessage) return base('sticker', null, null);
  if (message.locationMessage) return base('location', null, null);

  return null;

  function base(
    kind: RawInboundMessage['kind'],
    text: string | null,
    media: RawInboundMessage['media'],
  ): RawInboundMessage {
    return {
      whatsappMsgId,
      fromPhoneE164,
      chatKind,
      fromMe,
      kind,
      text,
      media,
      raw: wam,
      receivedAt,
    };
  }
}

function inferChatKind(jid: string): RawInboundMessage['chatKind'] {
  if (!jid) return 'other';
  if (jid.endsWith('@g.us')) return 'group';
  if (jid === 'status@broadcast' || jid.endsWith('@broadcast')) return 'status';
  if (jid.endsWith('@s.whatsapp.net') || jid.endsWith('@c.us')) return 'individual';
  return 'other';
}

function jidToE164(jid: string, participant: string | null): string {
  // Para grupos, devolvemos el JID del grupo (sin convertir a E.164).
  // El pipeline va a descartarlo en prefilter de todos modos.
  // Para individuales y status, extraemos la parte numérica antes del @.
  const source = participant ?? jid;
  const at = source.indexOf('@');
  const num = at >= 0 ? source.slice(0, at) : source;
  return num.startsWith('+') ? num : `+${num}`;
}

function timestampToIso(ts: number | Long | null | undefined): string {
  if (!ts) return new Date().toISOString();
  const seconds = typeof ts === 'number' ? ts : ts.toNumber();
  return new Date(seconds * 1000).toISOString();
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/adapters/whatsapp/mapMessage.test.ts
```

Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/whatsapp/mapMessage.ts tests/adapters/whatsapp/mapMessage.test.ts
git commit -m "feat(whatsapp): mapWAMessageToRaw función pura con tests"
```

---

## Task 3: `WhatsAppSender`

**Files:**
- Create: `src/adapters/whatsapp/sender.ts`
- Create: `tests/adapters/whatsapp/sender.test.ts`

- [ ] **Step 1: Escribir tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { WhatsAppSender } from '../../../src/adapters/whatsapp/sender';
import type { WASocket } from '../../../src/adapters/whatsapp/types';

function makeFakeSocket(): WASocket & { sent: Array<{ jid: string; content: any }> } {
  const sent: Array<{ jid: string; content: any }> = [];
  return {
    sent,
    sendMessage: vi.fn(async (jid: string, content: { text: string }) => {
      sent.push({ jid, content });
    }),
  };
}

describe('WhatsAppSender', () => {
  it('convierte +52155... a JID correcto y llama sendMessage', async () => {
    const socket = makeFakeSocket();
    const sender = new WhatsAppSender(() => socket);
    await sender.sendText('+5215555555555', 'hola María');
    expect(socket.sent).toEqual([
      { jid: '5215555555555@s.whatsapp.net', content: { text: 'hola María' } },
    ]);
  });

  it('omite el "+" inicial del número', async () => {
    const socket = makeFakeSocket();
    const sender = new WhatsAppSender(() => socket);
    await sender.sendText('+521', 'x');
    expect(socket.sent[0].jid).toBe('521@s.whatsapp.net');
  });

  it('arroja si el socket aún no está disponible', async () => {
    const sender = new WhatsAppSender(() => null);
    await expect(sender.sendText('+1', 'hi')).rejects.toThrow(/socket/i);
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/adapters/whatsapp/sender.test.ts
```

- [ ] **Step 3: Implementar `src/adapters/whatsapp/sender.ts`**

```ts
import type { OutboundSender } from '../../services/outbound';
import type { WASocket } from './types';

/**
 * Sender que envía mensajes vía Baileys. Recibe una factory que devuelve el
 * socket actual (o null si no está disponible) — esto permite manejar
 * reconexiones sin recrear el sender.
 */
export class WhatsAppSender implements OutboundSender {
  constructor(private readonly getSocket: () => WASocket | null) {}

  async sendText(toPhoneE164: string, text: string): Promise<void> {
    const socket = this.getSocket();
    if (!socket) {
      throw new Error('WhatsAppSender: socket no disponible (¿desconectado?)');
    }
    const jid = e164ToJid(toPhoneE164);
    await socket.sendMessage(jid, { text });
  }
}

export function e164ToJid(e164: string): string {
  const num = e164.startsWith('+') ? e164.slice(1) : e164;
  return `${num}@s.whatsapp.net`;
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/adapters/whatsapp/sender.test.ts
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/whatsapp/sender.ts tests/adapters/whatsapp/sender.test.ts
git commit -m "feat(whatsapp): WhatsAppSender con conversión E.164→JID"
```

---

## Task 4: `WhatsAppNotifier`

**Files:**
- Create: `src/adapters/whatsapp/notifier.ts`
- Create: `tests/adapters/whatsapp/notifier.test.ts`

- [ ] **Step 1: Escribir tests**

```ts
import { describe, it, expect } from 'vitest';
import { WhatsAppNotifier } from '../../../src/adapters/whatsapp/notifier';
import { MemorySender } from '../../../src/services/outbound';

describe('WhatsAppNotifier', () => {
  it('notifyOwnerReady envía mensaje formateado al teléfono del dueño', async () => {
    const sender = new MemorySender();
    const notifier = new WhatsAppNotifier(sender, '+5210000000000');
    await notifier.notifyOwnerReady({
      jobId: 'j1',
      contactDisplayName: 'María González',
      contactPhone: '+5215555',
      summary: 'Retapizado de sillón 3 plazas en Polanco.',
      panelUrl: 'http://localhost:3000',
    });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].to).toBe('+5210000000000');
    expect(sender.sent[0].text).toContain('Nuevo intake');
    expect(sender.sent[0].text).toContain('María González');
    expect(sender.sent[0].text).toContain('Retapizado de sillón');
    expect(sender.sent[0].text).toContain('http://localhost:3000');
  });

  it('notifyOwnerReady usa el teléfono cuando displayName es null', async () => {
    const sender = new MemorySender();
    const notifier = new WhatsAppNotifier(sender, '+5210000000000');
    await notifier.notifyOwnerReady({
      jobId: 'j1',
      contactDisplayName: null,
      contactPhone: '+5215555',
      summary: 'x'.repeat(30),
      panelUrl: 'http://x',
    });
    expect(sender.sent[0].text).toContain('+5215555');
  });

  it('notifyDisconnect envía aviso con la razón', async () => {
    const sender = new MemorySender();
    const notifier = new WhatsAppNotifier(sender, '+5210000000000');
    await notifier.notifyDisconnect({ reason: 'session expired' });
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0].text).toMatch(/desconect/i);
    expect(sender.sent[0].text).toContain('session expired');
  });

  it('si el sender falla, el notifier no propaga (la app no debe caer por una alerta)', async () => {
    const failingSender = {
      sendText: async () => {
        throw new Error('socket down');
      },
    };
    const notifier = new WhatsAppNotifier(failingSender, '+521');
    await expect(
      notifier.notifyDisconnect({ reason: 'x' }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Verificar fallan**

```bash
npm test -- tests/adapters/whatsapp/notifier.test.ts
```

- [ ] **Step 3: Implementar `src/adapters/whatsapp/notifier.ts`**

```ts
import type {
  Notifier,
  OwnerReadyPayload,
  DisconnectPayload,
} from '../../services/notification';
import type { OutboundSender } from '../../services/outbound';
import { logger } from '../../lib/logger';

/**
 * Notifier que envía mensajes al WhatsApp del dueño usando un `OutboundSender`.
 * Atrapa errores del sender — una alerta fallida nunca debe tumbar el proceso.
 */
export class WhatsAppNotifier implements Notifier {
  constructor(
    private readonly sender: OutboundSender,
    private readonly ownerPhoneE164: string,
  ) {}

  async notifyOwnerReady(payload: OwnerReadyPayload): Promise<void> {
    const name = payload.contactDisplayName ?? payload.contactPhone;
    const text =
      `🪡 Nuevo intake listo\n\n` +
      `Cliente: ${name}\n` +
      `Resumen: ${payload.summary}\n\n` +
      `Ver: ${payload.panelUrl}/panel/jobs/${payload.jobId}`;
    await this.safeSend(text);
  }

  async notifyDisconnect(payload: DisconnectPayload): Promise<void> {
    const text =
      `⚠️ WhatsApp desconectado.\n` +
      `Motivo: ${payload.reason}\n` +
      `Revisa el panel para reconectar.`;
    await this.safeSend(text);
  }

  private async safeSend(text: string): Promise<void> {
    try {
      await this.sender.sendText(this.ownerPhoneE164, text);
    } catch (e) {
      logger.warn(
        { err: e instanceof Error ? e.message : String(e) },
        'whatsapp_notifier.send_failed',
      );
    }
  }
}
```

- [ ] **Step 4: Correr tests**

```bash
npm test -- tests/adapters/whatsapp/notifier.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/whatsapp/notifier.ts tests/adapters/whatsapp/notifier.test.ts
git commit -m "feat(whatsapp): WhatsAppNotifier con manejo seguro de errores"
```

---

## Task 5: `BaileysConnection` — gestiona socket, QR y reconexión

**Files:**
- Create: `src/adapters/whatsapp/connection.ts`

(Sin tests automatizados — depende de Baileys real. Se verifica con el smoke manual en T7.)

- [ ] **Step 1: Implementar `src/adapters/whatsapp/connection.ts`**

```ts
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket as BaileysSocket,
} from 'baileys';
import { Boom } from '@hapi/boom'; // viene como dep de baileys
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import qrcode from 'qrcode-terminal';
import { logger } from '../../lib/logger';
import type { AdapterStateSnapshot, ConnectionStatus, WASocket } from './types';

export interface ConnectionOptions {
  /** Carpeta donde Baileys guarda las llaves de la sesión. */
  sessionDir: string;
  /** Callback cuando llega un mensaje. */
  onMessage: (wam: any, socket: WASocket) => Promise<void>;
  /** Callback cuando el estado de conexión cambia. */
  onStatusChange: (status: ConnectionStatus, error?: string) => void;
  /** Callback cuando hay un QR para imprimir. */
  onQr: (qr: string) => void;
}

/**
 * Mantiene un socket de Baileys conectado. Reintenta al desconectarse,
 * excepto cuando la causa es logout (sesión inválida — requiere re-escanear QR).
 *
 * Esta clase es deliberadamente NO testeable de forma unitaria; su correctitud
 * se verifica con el smoke manual del entry point. Sin embargo, la lógica está
 * envuelta en una interfaz minimalista (`WASocket`) que permite que el resto
 * del sistema sí sea testeable.
 */
export class BaileysConnection {
  private socket: BaileysSocket | null = null;
  private status: ConnectionStatus = 'disconnected';
  private lastError: string | null = null;
  private lastConnectedAt: string | null = null;
  private lastQr: string | null = null;
  private reconnecting = false;

  constructor(private readonly opts: ConnectionOptions) {}

  /** Devuelve un socket-like estable que el `WhatsAppSender` consume. */
  asWASocket(): WASocket {
    return {
      sendMessage: async (jid, content) => {
        if (!this.socket) throw new Error('baileys: socket no conectado');
        return this.socket.sendMessage(jid, content);
      },
    };
  }

  state(): AdapterStateSnapshot {
    return {
      status: this.status,
      qr: this.lastQr,
      lastError: this.lastError,
      lastConnectedAt: this.lastConnectedAt,
    };
  }

  async start(): Promise<void> {
    await mkdir(resolve(this.opts.sessionDir), { recursive: true });
    await this.connect();
  }

  async stop(): Promise<void> {
    this.reconnecting = false;
    if (this.socket?.end) this.socket.end(undefined);
    this.socket = null;
    this.setStatus('disconnected');
  }

  private async connect(): Promise<void> {
    this.setStatus('connecting');
    const { state, saveCreds } = await useMultiFileAuthState(this.opts.sessionDir);

    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false, // lo imprimimos nosotros para tener control
      browser: ['Intake', 'Chrome', '1.0.0'],
      syncFullHistory: false,
    });

    this.socket = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        this.lastQr = qr;
        this.setStatus('qr_required');
        this.opts.onQr(qr);
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        this.lastQr = null;
        this.lastError = null;
        this.lastConnectedAt = new Date().toISOString();
        this.setStatus('connected');
        logger.info('whatsapp.connected');
      }
      if (connection === 'close') {
        const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const reason = lastDisconnect?.error?.message ?? 'unknown';
        this.lastError = reason;
        logger.warn({ code, reason }, 'whatsapp.disconnected');
        if (code === DisconnectReason.loggedOut) {
          this.setStatus('logged_out');
          // No reconectar: la sesión está invalidada.
        } else {
          // Reconectar.
          this.setStatus('disconnected');
          if (!this.reconnecting) {
            this.reconnecting = true;
            setTimeout(() => {
              this.reconnecting = false;
              void this.connect().catch((e) =>
                logger.error({ err: e.message }, 'whatsapp.reconnect_failed'),
              );
            }, 3000);
          }
        }
      }
    });

    sock.ev.on('messages.upsert', async (upsert) => {
      if (upsert.type !== 'notify') return;
      for (const wam of upsert.messages) {
        try {
          await this.opts.onMessage(wam, this.asWASocket());
        } catch (e) {
          logger.error(
            { err: e instanceof Error ? e.message : String(e) },
            'whatsapp.on_message_failed',
          );
        }
      }
    });
  }

  /** Helper para descargar media de un mensaje. */
  async downloadMedia(wam: any): Promise<Buffer> {
    if (!this.socket) throw new Error('baileys: socket no conectado');
    const baileys = await import('baileys');
    return baileys.downloadMediaMessage(wam, 'buffer', {}, {
      logger: undefined as any,
      reuploadRequest: this.socket.updateMediaMessage,
    }) as Promise<Buffer>;
  }

  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    this.opts.onStatusChange(s, this.lastError ?? undefined);
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errores. Si Baileys 6.x exporta tipos diferentes (`type WASocket` vs `type Sock`), ajusta el import. Si `@hapi/boom` no está disponible directamente, usa `any` para el cast.

Si typecheck falla por imports, **reporta los errores exactos** y aplica ajustes mínimos.

- [ ] **Step 3: Commit**

```bash
git add src/adapters/whatsapp/connection.ts
git commit -m "feat(whatsapp): BaileysConnection con QR persistente y autoreconnect"
```

---

## Task 6: `BaileysAdapter` — orquestación

**Files:**
- Create: `src/adapters/whatsapp/adapter.ts`

- [ ] **Step 1: Implementar `src/adapters/whatsapp/adapter.ts`**

```ts
import type { InboundCoordinator } from '../../pipeline/coordinator';
import { BaileysConnection } from './connection';
import { mapWAMessageToRaw } from './mapMessage';
import type { Notifier } from '../../services/notification';
import { logger } from '../../lib/logger';
import type { AdapterStateSnapshot, ConnectionStatus, WASocket } from './types';

export interface BaileysAdapterOptions {
  sessionDir: string;
  coordinator: InboundCoordinator;
  notifier: Notifier;
}

/**
 * Ata el `BaileysConnection` con el `InboundCoordinator`.
 *
 * - Cuando llega un mensaje, lo mapea y se lo pasa al coordinator.
 * - Cuando la conexión se cae, notifica al dueño (vía notifier).
 */
export class BaileysAdapter {
  private readonly conn: BaileysConnection;
  private hasNotifiedDisconnect = false;

  constructor(private readonly opts: BaileysAdapterOptions) {
    this.conn = new BaileysConnection({
      sessionDir: opts.sessionDir,
      onMessage: (wam) => this.handleWAMessage(wam),
      onStatusChange: (status, err) => this.handleStatusChange(status, err),
      onQr: (qr) => {
        logger.info({ qrLength: qr.length }, 'whatsapp.qr_required');
      },
    });
  }

  async start(): Promise<void> {
    await this.conn.start();
  }

  async stop(): Promise<void> {
    await this.conn.stop();
  }

  state(): AdapterStateSnapshot {
    return this.conn.state();
  }

  /** Socket-like que el sender consume. */
  asSocket(): WASocket {
    return this.conn.asWASocket();
  }

  private async handleWAMessage(wam: any): Promise<void> {
    const raw = await mapWAMessageToRaw(wam, (m) => this.conn.downloadMedia(m));
    if (!raw) return;
    await this.opts.coordinator.handleInbound(raw);
  }

  private async handleStatusChange(
    status: ConnectionStatus,
    err: string | undefined,
  ): Promise<void> {
    if (status === 'connected') {
      this.hasNotifiedDisconnect = false;
      return;
    }
    if (
      (status === 'disconnected' || status === 'logged_out') &&
      !this.hasNotifiedDisconnect
    ) {
      this.hasNotifiedDisconnect = true;
      // Esperar 2 minutos antes de alertar (el spec menciona >2min).
      setTimeout(
        () => {
          if (this.conn.state().status !== 'connected') {
            void this.opts.notifier
              .notifyDisconnect({ reason: err ?? status })
              .catch(() => {});
          }
        },
        2 * 60 * 1000,
      );
    }
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errores.

- [ ] **Step 3: Commit**

```bash
git add src/adapters/whatsapp/adapter.ts
git commit -m "feat(whatsapp): BaileysAdapter conecta connection con coordinator y notifier"
```

---

## Task 7: Bootstrap `src/index.ts`

**Files:**
- Create: `src/index.ts`
- Modify: `package.json` (agrega script `start`)

- [ ] **Step 1: Crear `src/index.ts`**

```ts
#!/usr/bin/env tsx
/**
 * Punto de entrada del proceso Intake.
 *
 * Flujo:
 * 1. Carga config + perfil.
 * 2. Inicializa Prisma, MediaStore, Transcriber (Whisper si hay API key).
 * 3. Crea WhatsAppSender (apunta al socket que el adapter expone).
 * 4. Crea WhatsAppNotifier (usa sender hacia owner.phoneE164).
 * 5. Instancia InboundCoordinator con todas las deps.
 * 6. Inicia BaileysAdapter — escanea QR la primera vez, persiste sesión.
 */
import { loadConfig, loadProfile } from './config/loader';
import { getPrisma, disconnectPrisma } from './storage/client';
import { FilesystemMediaStore } from './media/store';
import {
  NoopTranscriber,
  WhisperTranscriber,
  type Transcriber,
} from './media/transcriber';
import { InboundCoordinator } from './pipeline/coordinator';
import { WhatsAppSender } from './adapters/whatsapp/sender';
import { WhatsAppNotifier } from './adapters/whatsapp/notifier';
import { BaileysAdapter } from './adapters/whatsapp/adapter';
import { defaultAgentFactory } from './agent/sdk-factory';
import { logger } from './lib/logger';

async function main() {
  const config = await loadConfig('./config.json');
  const profile = await loadProfile(config.profile);
  const prisma = getPrisma();

  logger.info({ profile: config.profile }, 'bootstrap.config_loaded');

  const mediaStore = new FilesystemMediaStore(config.media.storeDir);

  const apiKey = process.env.OPENROUTER_API_KEY ?? '';
  const transcriber: Transcriber =
    config.media.transcribeAudio && apiKey
      ? new WhisperTranscriber(apiKey, config.media.whisperModel)
      : new NoopTranscriber();

  // El adapter aún no existe; declaramos primero para que el sender pueda
  // referenciarlo mediante una getter perezosa.
  let adapter: BaileysAdapter | null = null;
  const sender = new WhatsAppSender(() => adapter?.asSocket() ?? null);
  const notifier = new WhatsAppNotifier(sender, config.owner.phoneE164);

  const coordinator = new InboundCoordinator({
    prisma,
    config,
    profile,
    notifier,
    sender,
    transcriber,
    mediaStore,
    agentFactory: defaultAgentFactory,
    now: () => new Date(),
  });

  adapter = new BaileysAdapter({
    sessionDir: './data/baileys-session',
    coordinator,
    notifier,
  });

  // Manejo de shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'bootstrap.shutdown');
    await adapter?.stop();
    await disconnectPrisma();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  logger.info('bootstrap.starting_baileys');
  await adapter.start();

  // Mantener el proceso vivo.
  await new Promise(() => {});
}

main().catch((e) => {
  logger.error({ err: e instanceof Error ? e.stack : String(e) }, 'bootstrap.failed');
  process.exit(1);
});
```

- [ ] **Step 2: Agregar script al `package.json`**

```json
"start": "tsx src/index.ts"
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts package.json
git commit -m "feat: bootstrap del proceso conectando todos los planes 1-4"
```

---

## Task 8: Verificación final + smoke manual

- [ ] **Step 1: Correr toda la batería de tests**

```bash
npm test
```

Expected: todos los tests pasan (139 del Plan 3 + ~17 nuevos = ~156 total).

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: 0 errores.

- [ ] **Step 3: Documentar el smoke manual**

Crea `docs/superpowers/runbooks/2026-05-26-smoke-test-whatsapp.md`:

```markdown
# Smoke test manual — WhatsApp adapter

Este runbook verifica que el adapter Baileys funcione end-to-end con un número real.

## Pre-requisitos

- `.env` con `OPENROUTER_API_KEY` válido (opcional — sin él el agente no responde,
  pero la conexión y persistencia sí se verifican).
- `config.json` apuntando al perfil y con `owner.phoneE164` (tu número personal).
- Un teléfono extra (o segundo dispositivo) con WhatsApp para probar como "cliente".

## Pasos

1. **Arrancar el proceso**

   ```bash
   npm start
   ```

   En la primera ejecución, Baileys imprime un código QR en la terminal.
   Escanéalo desde **WhatsApp Web** del número que actuará como "bot".

2. **Esperar "whatsapp.connected"** en los logs.

3. **Enviar "Hola" al número del bot desde el teléfono cliente.**

   - El bot debería responder con el `welcome.txt` del perfil.
   - Espera 5 segundos.
   - El agente debería responder pidiendo más datos.

4. **Verificar que el job está en DB**

   ```bash
   npx prisma studio
   ```

   Abre la tabla `Job` — deberías ver una fila con `status='OPEN_INTAKE'`.

5. **Completar el intake conversando.**

   Cuando todos los `required` estén satisfechos, el bot pedirá confirmación
   y al confirmarse cambiará el job a `READY_FOR_REVIEW`.
   Tu número de dueño debería recibir un mensaje con el resumen.

6. **Probar reconexión**

   Cierra el proceso con Ctrl+C. Vuelve a `npm start`. Debería reconectarse sin
   pedir QR de nuevo (sesión persistida en `./data/baileys-session/`).

7. **Probar logout**

   Cierra sesión de WhatsApp Web manualmente desde el teléfono del bot
   (Ajustes → Dispositivos vinculados → cerrar sesión).
   El proceso pasará a estado `logged_out` y NO intentará reconectar.
   Para volver a usarlo, borra `./data/baileys-session/` y reinicia.

## Troubleshooting

- **El QR no aparece** → revisa que `printQRInTerminal: false` esté configurado en
  `connection.ts` y que el callback `onQr` esté llamando a `qrcode.generate(qr, {small:true})`.
- **Reconexión infinita** → mira el código de `DisconnectReason` en los logs;
  podría ser `restartRequired` o `connectionLost`. Si es `loggedOut`, borra la sesión.
- **No responde aunque está conectado** → revisa `bot_active` en la tabla `Contact`
  y `flagged_non_intake`. Verifica que el agente reciba un `OPENROUTER_API_KEY` válido.
```

- [ ] **Step 4: Hacer el smoke manual (REQUIERE TI)**

Esta parte la hace el humano del proyecto:
1. `npm start`
2. Escanear QR.
3. Probar el flujo descrito arriba.
4. Reportar cualquier falla a la conversación que coordinó este plan.

- [ ] **Step 5: Commit final**

```bash
git add docs/superpowers/runbooks/
git commit -m "docs: runbook de smoke test para WhatsApp adapter"
```

---

## Cobertura del spec en este plan

| Sección del spec | Tarea(s) que lo cubren |
|------------------|------------------------|
| §2 whatsapp-adapter (Baileys + QR + reconexión) | T5 (`BaileysConnection`) |
| §3 mapeo de eventos Baileys → mensaje normalizado | T2 (`mapWAMessageToRaw`) |
| §3 descarga de media | T2 (downloader inyectable) + T5 (`downloadMedia` real) |
| §6 outbound-sender real | T3 (`WhatsAppSender`) |
| §6 notificación al dueño vía WhatsApp | T4 (`WhatsAppNotifier`) + T6 (integrado en adapter) |
| §9 alerta de desconexión >2min | T6 (`handleStatusChange` con setTimeout 2min) |
| Bootstrap / entry point | T7 (`src/index.ts`) |

Lo que NO está en este plan:
- Panel web para mostrar el QR / estado / reconectar (Plan 5).
- Recuperación de mensajes huérfanos al reconectar (post-MVP).
- Comandos del dueño por WhatsApp (fase 2 roadmap).
