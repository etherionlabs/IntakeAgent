// Política mínima de contraseñas, reutilizable en reset/change y (Fase 4) signup.
// Configurable por env para no cablear el umbral.
export const MIN_PASSWORD_LENGTH = Number(process.env.MIN_PASSWORD_LENGTH ?? 10);

// Blacklist corta de contraseñas comunes (no exhaustiva; defensa básica).
const COMMON = new Set([
  'password', 'contraseña', '1234567890', '12345678', 'qwertyuiop',
  'password1', 'admin1234', 'contrasena', 'iloveyou1',
]);

export interface PasswordCheck {
  ok: boolean;
  error?: string;
}

/** Valida una contraseña contra la política. No lanza: devuelve { ok, error }. */
export function checkPassword(password: string): PasswordCheck {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` };
  }
  if (COMMON.has(password.toLowerCase())) {
    return { ok: false, error: 'La contraseña es demasiado común.' };
  }
  return { ok: true };
}
