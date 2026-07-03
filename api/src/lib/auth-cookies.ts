// Nombres y opciones de cookies de autenticación, centralizados para que
// auth.ts (emite/limpia) y server.ts (lee/valida CSRF) coincidan.

export const SESSION_COOKIE = 'intake_session';
export const CSRF_COOKIE = 'intake_csrf';
export const CSRF_HEADER = 'x-csrf-token';

// Duración de la sesión. El maxAge de la cookie se alinea al exp del JWT.
export const JWT_EXPIRES_IN = '7d';
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

// SPA (Netlify) y API viven en dominios distintos (cross-site) ⇒ SameSite=None +
// Secure. En tests/local sin HTTPS, `secure` se relaja vía NODE_ENV !== 'production'
// para que los inject() de Fastify reciban la cookie.
const isProd = process.env.NODE_ENV === 'production';

/** Cookie de sesión: HttpOnly (inaccesible a JS). */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'none' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/** Cookie CSRF: legible por JS (double-submit), NO HttpOnly. */
export function csrfCookieOptions() {
  return {
    httpOnly: false,
    secure: isProd,
    sameSite: 'none' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

/** Opciones para limpiar (logout): mismo path/atributos, sin maxAge. */
export function clearCookieOptions() {
  return { httpOnly: false, secure: isProd, sameSite: 'none' as const, path: '/' };
}
