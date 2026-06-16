import { readFile } from 'node:fs/promises';
import type { PrismaClient, Message } from '@prisma/client';
import type { MediaStore } from '../media/store';
import type { Describer, DescribeContext } from '../media/describer';
import { imageMimeFromPath } from '../media/describer';
import type { Profile } from '../config/schema';
import type { BatchMessage, HistoryEntry } from '../agent/types';

/**
 * Lógica compartida para generar la descripción textual de una imagen y
 * persistirla en `Message.mediaDescription`. La usan tanto el pipeline (al armar
 * el turno) como la tool `reanalyze_image`.
 */

/** Contexto base del negocio + conversación, reutilizable para todas las fotos del turno. */
export interface DescribeBaseContext {
  businessName: string;
  businessDomain: string;
  focusInstructions: string;
  conversationContext: string;
}

/** Construye el contexto base a partir del perfil y la conversación reciente. */
export function buildDescribeBaseContext(
  profile: Profile,
  recentHistory: HistoryEntry[] | undefined,
  batch: BatchMessage[],
): DescribeBaseContext {
  return {
    businessName: profile.intakeSchema.$businessName,
    businessDomain: profile.intakeSchema.$businessDomain,
    focusInstructions: profile.imageFocus ?? '',
    conversationContext: buildConversationContext(recentHistory ?? [], batch),
  };
}

/** Resume el historial reciente + texto del batch actual como contexto para el describer. */
export function buildConversationContext(
  recentHistory: HistoryEntry[],
  batch: BatchMessage[],
): string {
  const lines: string[] = [];
  for (const h of recentHistory) {
    const who = h.direction === 'inbound' ? 'Cliente' : 'Asistente';
    const content = h.body ?? `(${h.kind})`;
    if (content.trim().length > 0) lines.push(`${who}: ${content}`);
  }
  // Texto que viene en el MISMO batch (p. ej. "esto es para el sillón de la sala")
  // es contexto muy relevante para enfocar la descripción.
  for (const m of batch) {
    if (m.kind === 'text' && m.body && m.body.trim().length > 0) {
      lines.push(`Cliente: ${m.body}`);
    }
  }
  const joined = lines.join('\n');
  return joined.length > 1500 ? joined.slice(joined.length - 1500) : joined;
}

function fullContext(
  base: DescribeBaseContext,
  caption: string | null,
  extraFocus: string | null,
): DescribeContext {
  return {
    businessName: base.businessName,
    businessDomain: base.businessDomain,
    focusInstructions: base.focusInstructions,
    conversationContext: base.conversationContext,
    caption,
    extraFocus,
  };
}

async function readImageBuffer(
  mediaStore: MediaStore,
  mediaPath: string,
): Promise<Buffer | null> {
  try {
    return await readFile(mediaStore.absolutePathFor(mediaPath));
  } catch (e) {
    console.warn(
      `[imageDescription] no se pudo leer ${mediaPath}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return null;
  }
}

async function describeAndPersist(
  prisma: PrismaClient,
  tenantId: string,
  mediaStore: MediaStore,
  describer: Describer,
  message: Pick<Message, 'id' | 'mediaPath' | 'body'>,
  base: DescribeBaseContext,
  extraFocus: string | null,
): Promise<string | null> {
  if (!message.mediaPath) return null;
  const buffer = await readImageBuffer(mediaStore, message.mediaPath);
  if (!buffer) return null;

  const mimetype = imageMimeFromPath(message.mediaPath);
  const description = await describer.describe(
    buffer,
    mimetype,
    fullContext(base, message.body, extraFocus),
  );
  if (!description) return null;

  await prisma.message.update({
    where: { id: message.id, tenantId },
    data: { mediaDescription: description },
  });
  return description;
}

/**
 * Garantiza que el mensaje de imagen tenga descripción: si ya existe la
 * reutiliza (cacheada), si no la genera con contexto y la persiste.
 */
export async function ensureDescription(
  prisma: PrismaClient,
  tenantId: string,
  mediaStore: MediaStore,
  describer: Describer,
  message: Pick<Message, 'id' | 'mediaPath' | 'body' | 'mediaDescription'>,
  base: DescribeBaseContext,
): Promise<string | null> {
  if (message.mediaDescription && message.mediaDescription.trim().length > 0) {
    return message.mediaDescription;
  }
  return describeAndPersist(prisma, tenantId, mediaStore, describer, message, base, null);
}

/**
 * Fuerza la regeneración de la descripción con foco adicional (tool
 * `reanalyze_image`). Sobrescribe la descripción previa.
 */
export async function reanalyzeDescription(
  prisma: PrismaClient,
  tenantId: string,
  mediaStore: MediaStore,
  describer: Describer,
  message: Pick<Message, 'id' | 'mediaPath' | 'body'>,
  base: DescribeBaseContext,
  focus: string,
): Promise<string | null> {
  return describeAndPersist(prisma, tenantId, mediaStore, describer, message, base, focus);
}
