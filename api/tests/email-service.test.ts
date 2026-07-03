import { describe, it, expect, vi } from 'vitest';
import { createEmailSender, ResendEmailSender, LogEmailSender } from '../src/lib/email';

describe('EmailService', () => {
  it('factory default → LogEmailSender (sin proveedor configurado)', () => {
    expect(createEmailSender({} as any)).toBeInstanceOf(LogEmailSender);
  });

  it('factory con EMAIL_PROVIDER=resend exige key y from', () => {
    expect(() => createEmailSender({ EMAIL_PROVIDER: 'resend' } as any)).toThrow(/EMAIL_API_KEY/);
    expect(createEmailSender({ EMAIL_PROVIDER: 'resend', EMAIL_API_KEY: 'k', EMAIL_FROM: 'a@b.com' } as any))
      .toBeInstanceOf(ResendEmailSender);
  });

  it('ResendEmailSender llama la API de Resend con los campos correctos', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const sender = new ResendEmailSender('key-x', 'no-reply@intake.com', fetcher as any);
    await sender.send('cliente@x.com', 'Asunto', 'Cuerpo');
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.authorization).toBe('Bearer key-x');
    const payload = JSON.parse(init.body);
    expect(payload).toEqual({ from: 'no-reply@intake.com', to: ['cliente@x.com'], subject: 'Asunto', text: 'Cuerpo' });
  });

  it('un fallo de Resend lanza (el caller decide no propagar al flujo principal)', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('err', { status: 500 }));
    const sender = new ResendEmailSender('k', 'f@x.com', fetcher as any);
    await expect(sender.send('a@b.com', 's', 'b')).rejects.toThrow(/resend/);
  });
});
