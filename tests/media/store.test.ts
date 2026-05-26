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
    expect(path).toMatch(/^c1[\\/]j1[\\/]m1\.jpe?g$/);
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
