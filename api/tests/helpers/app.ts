import { buildServer } from '../../src/server';
import { testPrisma, cleanupDb, seedTestTenant, TEST_TENANT_ID } from '../../../tests/helpers/db';
import bcrypt from 'bcryptjs';

export const TEST_JWT_SECRET = 'test-jwt-secret';
export const TEST_USER = { username: 'admin', password: 'pw123456', role: 'admin' };
export { testPrisma, cleanupDb, seedTestTenant, TEST_TENANT_ID };

export async function buildTestApp() {
  return buildServer({ jwtSecret: TEST_JWT_SECRET });
}

/** Limpia, siembra tenant + un PanelUser admin, devuelve el id del user. */
export async function seedTenantAndUser(): Promise<string> {
  await cleanupDb();
  await seedTestTenant();
  const passwordHash = await bcrypt.hash(TEST_USER.password, 8);
  const user = await testPrisma.panelUser.create({
    data: { tenantId: TEST_TENANT_ID, username: TEST_USER.username, passwordHash, role: TEST_USER.role },
  });
  return user.id;
}

/** Devuelve un Bearer token válido para los tests (firmado con el mismo secret). */
export async function authHeader(app: Awaited<ReturnType<typeof buildTestApp>>, userId: string) {
  const token = app.jwt.sign({ userId, tenantId: TEST_TENANT_ID, role: 'admin' });
  return { authorization: `Bearer ${token}` };
}
