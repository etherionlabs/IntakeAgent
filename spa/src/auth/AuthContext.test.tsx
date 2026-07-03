import { render, screen, waitFor } from '@testing-library/react';
import { vi, beforeEach, test, expect } from 'vitest';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: { me: vi.fn(), logout: vi.fn() } };
});
vi.mock('../lib/sentry', () => ({ setTenantTag: vi.fn(), clearTenantTag: vi.fn(), initSentry: vi.fn() }));

import { api } from '../api/client';
import { setTenantTag } from '../lib/sentry';
import { AuthProvider, useAuth } from './AuthContext';

const mockMe = api.me as unknown as ReturnType<typeof vi.fn>;
const mockTag = setTenantTag as unknown as ReturnType<typeof vi.fn>;

function Probe() { const { user, loading } = useAuth(); return <div>{loading ? 'loading' : user ? `user:${user.tenantId}` : 'anon'}</div>; }

beforeEach(() => { mockMe.mockReset(); mockTag.mockReset(); });

test('rehidratar con sesión válida setea el tag de tenant en Sentry', async () => {
  mockMe.mockResolvedValue({ user: { id: 'u1', tenantId: 'tenant-9', role: 'admin' } });
  render(<AuthProvider><Probe /></AuthProvider>);
  expect(await screen.findByText('user:tenant-9')).toBeInTheDocument();
  await waitFor(() => expect(mockTag).toHaveBeenCalledWith('tenant-9'));
});
