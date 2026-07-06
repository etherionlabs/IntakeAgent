import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeEach, test, expect } from 'vitest';
import PlatformDashboard from './PlatformDashboard';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    platformApi: {
      getTenants: vi.fn(),
      getTenantUsers: vi.fn(),
      createTenant: vi.fn(),
      createTenantUser: vi.fn(),
      updateTenant: vi.fn(),
      deleteTenant: vi.fn(),
      approveTenant: vi.fn(),
      rejectTenant: vi.fn(),
      setLimit: vi.fn(),
      suspendTenant: vi.fn(),
      reactivateTenant: vi.fn(),
      reconnectBot: vi.fn(),
      updateTenantUser: vi.fn(),
      deleteTenantUser: vi.fn(),
    },
  };
});
import { platformApi } from '../api/client';

const TENANT = { id: 't1', slug: 'demo', name: 'Demo', industry: 'tapiceria', profileDir: './profiles/tapiceria', status: 'provisioning', approvalStatus: 'pending', approvedAt: null, monthlyRunLimit: null, monthUsed: 0, subscription: null, createdAt: '2026-07-01' };

beforeEach(() => {
  (platformApi.getTenants as any).mockReset().mockResolvedValue({ tenants: [TENANT], defaultMonthlyLimit: 300 });
  (platformApi.getTenantUsers as any).mockReset().mockResolvedValue({ users: [] });
  (platformApi.approveTenant as any).mockReset().mockResolvedValue({ ok: true, approvalStatus: 'approved' });
  (platformApi.deleteTenant as any).mockReset().mockResolvedValue({ ok: true });
});

test('muestra el tenant pendiente y permite aprobar', async () => {
  render(<PlatformDashboard />);
  await screen.findByRole('heading', { name: 'Demo' });
  fireEvent.click(screen.getByRole('button', { name: /Aprobar/i }));
  await waitFor(() => expect(platformApi.approveTenant).toHaveBeenCalledWith('t1'));
});

test('eliminar exige escribir el slug', async () => {
  render(<PlatformDashboard />);
  await screen.findByRole('heading', { name: 'Demo' });
  fireEvent.click(screen.getByRole('button', { name: /Eliminar/i }));
  const input = await screen.findByPlaceholderText(/slug/i);
  fireEvent.change(input, { target: { value: 'demo' } });
  fireEvent.click(screen.getByRole('button', { name: /Confirmar/i }));
  await waitFor(() => expect(platformApi.deleteTenant).toHaveBeenCalledWith('t1', 'demo'));
});
