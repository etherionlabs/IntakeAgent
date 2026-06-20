import { buildServer } from '../../src/server';
import { testPrisma, cleanupDb, seedTestTenant, TEST_TENANT_ID } from '../../../tests/helpers/db';
import bcrypt from 'bcryptjs';

export const TEST_JWT_SECRET = 'test-jwt-secret';
export const TEST_USER = { username: 'admin', email: 'admin@test.local', password: 'pw1234567890', role: 'admin' };
export { testPrisma, cleanupDb, seedTestTenant, TEST_TENANT_ID };

export async function buildTestApp() {
  return buildServer({ jwtSecret: TEST_JWT_SECRET });
}

/** Limpia, siembra tenant + un PanelUser admin (con email), devuelve el id del user. */
export async function seedTenantAndUser(): Promise<string> {
  await cleanupDb();
  await seedTestTenant();
  const passwordHash = await bcrypt.hash(TEST_USER.password, 8);
  const user = await testPrisma.panelUser.create({
    data: { tenantId: TEST_TENANT_ID, username: TEST_USER.username, email: TEST_USER.email, passwordHash, role: TEST_USER.role },
  });
  return user.id;
}

/** Devuelve un Bearer token válido para los tests (firmado con el mismo secret). */
export async function authHeader(app: Awaited<ReturnType<typeof buildTestApp>>, userId: string) {
  const token = app.jwt.sign({ userId, tenantId: TEST_TENANT_ID, role: 'admin' });
  return { authorization: `Bearer ${token}` };
}

/**
 * Login real por cookie: devuelve los headers (cookie de sesión + CSRF) y el
 * valor del token CSRF para reenviarlo en mutaciones. Úsalo para probar el flujo
 * de cookie/CSRF de extremo a extremo.
 */
export async function loginCookie(
  app: Awaited<ReturnType<typeof buildTestApp>>,
  email = TEST_USER.email,
  password = TEST_USER.password,
) {
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
  const setCookies = res.cookies as Array<{ name: string; value: string }>;
  const session = setCookies.find((c) => c.name === 'intake_session')?.value ?? '';
  const csrf = setCookies.find((c) => c.name === 'intake_csrf')?.value ?? '';
  const cookieHeader = `intake_session=${session}; intake_csrf=${csrf}`;
  return {
    csrf,
    headers: { cookie: cookieHeader },
    mutatingHeaders: { cookie: cookieHeader, 'x-csrf-token': csrf },
  };
}
