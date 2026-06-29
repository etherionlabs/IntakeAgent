import { PUBLIC_APP_URL } from '../env';

export interface EmailContent { subject: string; body: string; }

export function verificationEmail(token: string): EmailContent {
  const link = `${PUBLIC_APP_URL}/verify-email?token=${token}`;
  return {
    subject: 'Verifica tu correo — Intake',
    body: `Bienvenido a Intake. Confirma tu correo para activar tu cuenta:\n\n${link}\n\nEl enlace caduca en 24 horas.`,
  };
}

export function welcomeEmail(businessName: string): EmailContent {
  return {
    subject: '¡Tu cuenta de Intake está lista!',
    body: `Hola ${businessName}, tu cuenta quedó verificada. Entra al panel para terminar de configurar tu recepcionista de WhatsApp.`,
  };
}
