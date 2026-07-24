import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  NoopImageEditor,
  ScriptedImageEditor,
  OpenRouterImageEditor,
  type ImageEditContext,
} from '../../src/media/imageEditor';

const CTX: ImageEditContext = {
  businessName: 'Wrap Studio',
  businessDomain: 'wrapping y estética automotriz',
  editGuidance: 'Edita de forma fotorrealista conservando el auto.',
  instruction: 'agregar franjas deportivas negras al cofre',
};

// PNG 1x1 en base64 (data mínima para simular la salida del modelo).
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

describe('ImageEditor', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('NoopImageEditor devuelve null', async () => {
    const editor = new NoopImageEditor();
    expect(await editor.edit(Buffer.from('x'), 'image/jpeg', CTX)).toBeNull();
  });

  it('ScriptedImageEditor devuelve las imágenes en orden y luego null', async () => {
    const img = { buffer: Buffer.from('abc'), mimetype: 'image/png' };
    const editor = new ScriptedImageEditor([img, null]);
    expect(await editor.edit(Buffer.from('x'), 'image/jpeg', CTX)).toEqual(img);
    expect(await editor.edit(Buffer.from('x'), 'image/jpeg', CTX)).toBeNull();
    expect(await editor.edit(Buffer.from('x'), 'image/jpeg', CTX)).toBeNull();
  });

  it('OpenRouterImageEditor sin apiKey devuelve null (no llama a la red)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const editor = new OpenRouterImageEditor('', 'model-x');
    expect(await editor.edit(Buffer.from('x'), 'image/jpeg', CTX)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('OpenRouterImageEditor parsea la imagen data-URL de la respuesta', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                images: [{ image_url: { url: `data:image/png;base64,${PNG_1x1}` } }],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const editor = new OpenRouterImageEditor('key', 'model-x');
    const result = await editor.edit(Buffer.from('src'), 'image/jpeg', CTX);
    expect(result).not.toBeNull();
    expect(result?.mimetype).toBe('image/png');
    expect(result?.buffer.length).toBeGreaterThan(0);
  });

  it('OpenRouterImageEditor devuelve null si la respuesta no trae imagen', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'no puedo' } }] }), {
        status: 200,
      }),
    );
    const editor = new OpenRouterImageEditor('key', 'model-x');
    expect(await editor.edit(Buffer.from('src'), 'image/jpeg', CTX)).toBeNull();
  });

  it('OpenRouterImageEditor devuelve null ante error HTTP', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('rate limited', { status: 429 }),
    );
    const editor = new OpenRouterImageEditor('key', 'model-x');
    expect(await editor.edit(Buffer.from('src'), 'image/jpeg', CTX)).toBeNull();
  });
});
