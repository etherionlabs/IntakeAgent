// Abstracción de envío de email transaccional. La implementación se elige por env
// (EMAIL_PROVIDER); el resto del código depende solo de la interfaz. Claves solo
// en env, nunca en logs (regla de secretos Fase 1).

export interface EmailSender {
  send(to: string, subject: string, body: string): Promise<void>;
}

/** Stub que registra el envío sin secretos ni cuerpo. Default en dev/tests. */
export class LogEmailSender implements EmailSender {
  async send(to: string, subject: string, _body: string): Promise<void> {
    console.log(`[email] to=${to} subject=${JSON.stringify(subject)} (cuerpo omitido)`);
  }
}

/** Proveedor real: Resend (HTTP API, sin SDK). Solo correo transaccional. */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(to: string, subject: string, body: string): Promise<void> {
    const res = await this.fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [to], subject, text: body }),
    });
    if (!res.ok) throw new Error(`resend respondió ${res.status}`);
  }
}

/** Construye el sender según EMAIL_PROVIDER. Default: LogEmailSender. */
export function createEmailSender(env: NodeJS.ProcessEnv = process.env): EmailSender {
  if ((env.EMAIL_PROVIDER ?? '').toLowerCase() === 'resend') {
    const key = env.EMAIL_API_KEY;
    const from = env.EMAIL_FROM;
    if (!key || !from) throw new Error('EMAIL_PROVIDER=resend requiere EMAIL_API_KEY y EMAIL_FROM');
    return new ResendEmailSender(key, from);
  }
  return new LogEmailSender();
}

// Singleton perezoso; inyectable en tests.
let defaultSender: EmailSender | null = null;
export function getEmailSender(): EmailSender {
  if (!defaultSender) defaultSender = createEmailSender();
  return defaultSender;
}
export function setEmailSender(sender: EmailSender): void { defaultSender = sender; }
