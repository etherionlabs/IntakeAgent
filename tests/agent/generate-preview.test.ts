import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildGeneratePreviewTool } from '../../src/agent/tools';
import { ScriptedImageEditor } from '../../src/media/imageEditor';
import type { TurnContext } from '../../src/agent/types';

/** Fakes mínimos: sin DB. Solo se ejercita la lógica de la tool. */
let tmpRoot: string;
const EDITED = { buffer: Buffer.from('edited-bytes'), mimetype: 'image/png' };

const profile = {
  intakeSchema: { $businessName: 'Wrap Studio', $businessDomain: 'wrapping' },
  imageEditGuidance: 'edita fotorrealista',
} as any;

function fakeMediaStore(saved: { path?: string; buffer?: Buffer }) {
  return {
    absolutePathFor: (rel: string) => join(tmpRoot, rel),
    save: async (input: any) => {
      const rel = `${input.contactId}/${input.jobId}/${input.messageId}.png`;
      saved.path = rel;
      saved.buffer = input.buffer;
      return rel;
    },
  } as any;
}

function fakePrisma(mediaPath: string | null) {
  return {
    message: {
      findFirst: async () =>
        mediaPath ? { id: 'photo-1', tenantId: 't1', kind: 'image', mediaPath } : null,
    },
  } as any;
}

function baseCtx(): TurnContext {
  return {
    job: { id: 'job-1' } as any,
    contact: { id: 'contact-1' } as any,
    intake: {} as any,
    batchMessages: [],
    otherOpenJobs: [],
    now: '2026-05-25T10:00:00Z',
    availablePhotos: [{ messageId: 'photo-1', caption: null, description: 'un auto rojo' }],
    pendingAttachments: [],
  };
}

beforeAll(async () => {
  tmpRoot = await mkdtemp(join(tmpdir(), 'preview-test-'));
  // Foto original en disco (contact/job/message.jpg) que la tool va a leer.
  const dir = join(tmpRoot, 'contact-1', 'job-1');
  await writeFile(join(tmpRoot, 'orig.jpg'), Buffer.from('original-image'));
  void dir;
});

afterAll(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

describe('tool generate_preview', () => {
  it('edita la foto, la guarda y encola un attachment', async () => {
    const ctx = baseCtx();
    const saved: { path?: string; buffer?: Buffer } = {};
    const tool = buildGeneratePreviewTool(ctx, {
      prisma: fakePrisma('orig.jpg'),
      tenantId: 't1',
      profile,
      mediaStore: fakeMediaStore(saved),
      imageEditor: new ScriptedImageEditor([EDITED]),
    });

    const out = await tool.execute({
      photo_ref: 'photo-1',
      instruction: 'agregar franjas deportivas negras al cofre',
      caption: 'Así se vería 👇',
    });

    expect(out.ok).toBe(true);
    // Se guardó la imagen editada en el media-store.
    expect(saved.buffer?.toString()).toBe('edited-bytes');
    // Se encoló exactamente un attachment consistente con lo guardado.
    expect(ctx.pendingAttachments).toHaveLength(1);
    const att = ctx.pendingAttachments![0];
    expect(att.mediaPath).toBe(saved.path);
    expect(att.mimetype).toBe('image/png');
    expect(att.caption).toBe('Así se vería 👇');
    // El nombre del archivo usa el messageId reservado (consistencia DB ↔ disco).
    expect(saved.path).toContain(att.messageId);
  });

  it('falla si el photo_ref no está entre las fotos disponibles', async () => {
    const ctx = baseCtx();
    const tool = buildGeneratePreviewTool(ctx, {
      prisma: fakePrisma('orig.jpg'),
      tenantId: 't1',
      profile,
      mediaStore: fakeMediaStore({}),
      imageEditor: new ScriptedImageEditor([EDITED]),
    });
    const out = await tool.execute({ photo_ref: 'no-existe', instruction: 'cambiar color a azul' });
    expect(out.ok).toBe(false);
    expect(ctx.pendingAttachments).toHaveLength(0);
  });

  it('falla (sin encolar) si el editor no devuelve imagen', async () => {
    const ctx = baseCtx();
    const tool = buildGeneratePreviewTool(ctx, {
      prisma: fakePrisma('orig.jpg'),
      tenantId: 't1',
      profile,
      mediaStore: fakeMediaStore({}),
      imageEditor: new ScriptedImageEditor([null]),
    });
    const out = await tool.execute({ photo_ref: 'photo-1', instruction: 'cambiar color a azul' });
    expect(out.ok).toBe(false);
    expect(ctx.pendingAttachments).toHaveLength(0);
  });

  it('falla si la foto no tiene archivo (mediaPath null)', async () => {
    const ctx = baseCtx();
    const tool = buildGeneratePreviewTool(ctx, {
      prisma: fakePrisma(null),
      tenantId: 't1',
      profile,
      mediaStore: fakeMediaStore({}),
      imageEditor: new ScriptedImageEditor([EDITED]),
    });
    const out = await tool.execute({ photo_ref: 'photo-1', instruction: 'cambiar color a azul' });
    expect(out.ok).toBe(false);
  });
});
