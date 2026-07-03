import { PUBLIC_APP_URL } from '../env';

export interface EmailContent { subject: string; body: string; }

export function verificationEmail(token: string): EmailContent {
  const link = `${PUBLIC_APP_URL}/verify-email?token=${token}`;
  return {
    subject: 'Verifica tu correo — Intake',
    body: `Bienvenido a Intake. Confirma tu correo para activar tu cuenta:\n\n${link}\n\nEl enlace caduca en 24 horas.`,
  };
}

export function welcomeEmail(businessName: string, opts: { pendingApproval?: boolean } = {}): EmailContent {
  if (opts.pendingApproval) {
    return {
      subject: 'Correo verificado — tu cuenta está en revisión',
      body: `Hola ${businessName}, tu correo quedó verificado. Puedes entrar al panel y dejar configurado tu recepcionista; nuestro equipo revisará tu cuenta y te avisaremos por este medio cuando quede aprobada para conectar tu WhatsApp.`,
    };
  }
  return {
    subject: '¡Tu cuenta de Intake está lista!',
    body: `Hola ${businessName}, tu cuenta quedó verificada. Entra al panel para terminar de configurar tu recepcionista de WhatsApp.`,
  };
}

export function accountApprovedEmail(businessName: string): EmailContent {
  const link = `${PUBLIC_APP_URL}/onboarding`;
  return {
    subject: '¡Tu cuenta de Intake fue aprobada!',
    body: `Hola ${businessName}, tu cuenta ya está aprobada. Entra al panel para vincular tu WhatsApp y poner a trabajar a tu recepcionista:\n\n${link}`,
  };
}

export function accountRejectedEmail(businessName: string): EmailContent {
  return {
    subject: 'Sobre tu solicitud de cuenta en Intake',
    body: `Hola ${businessName}, por ahora no pudimos aprobar tu cuenta. Si crees que se trata de un error, responde a este correo y lo revisamos.`,
  };
}
