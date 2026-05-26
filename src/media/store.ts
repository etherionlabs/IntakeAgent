import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';

export interface SaveMediaInput {
  buffer: Buffer;
  mimetype: string;
  contactId: string;
  jobId: string;
  messageId: string;
}

export interface MediaStore {
  save(input: SaveMediaInput): Promise<string>;
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
