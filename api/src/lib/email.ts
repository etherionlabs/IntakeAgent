// Abstracción de envío de email. En Fase 1 solo hay un stub que loguea; el
// proveedor formal (Resend, decisión #7) se integra en Fase 6 implementando esta
// misma interfaz, sin tocar el resto del código.

export interface EmailSender {
  send(to: string, subject: string, body: string): Promise<void>;
}

/** Implementación de Fase 1: registra el envío sin secretos. NO envía nada real. */
export class LogEmailSender implements EmailSender {
  async send(to: string, subject: string, _body: string): Promise<void> {
    // No logueamos el body completo (puede llevar el enlace con token).
    console.log(`[email] to=${to} subject=${JSON.stringify(subject)} (cuerpo omitido)`);
  }
}

// Singleton por defecto; inyectable en tests.
let defaultSender: EmailSender = new LogEmailSender();
export function getEmailSender(): EmailSender { return defaultSender; }
export function setEmailSender(sender: EmailSender): void { defaultSender = sender; }
