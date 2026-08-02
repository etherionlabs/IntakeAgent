import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, beforeEach, test, expect } from 'vitest';
import PlatformDashboard from './PlatformDashboard';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    platformApi: {
      // Catálogo del panel: incluye los giros internos, que el público omite.
      getIndustries: vi.fn().mockResolvedValue({
        industries: [
          { value: 'generico', label: 'Otro / Servicios', internal: false },
          { value: 'mecanica', label: 'Mecánica automotriz', internal: false },
          { value: 'intake', label: 'Etherion Labs (interno)', internal: true },
        ],
      }),
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

test('el selector de giro ofrece los internos, marcados como tales', async () => {
  // El panel del superadmin leía el catálogo PÚBLICO, que omite los internos a
  // propósito: el giro con el que nos vendemos no aparecía en el único sitio
  // desde el que se puede crear ese tenant.
  render(<PlatformDashboard />);

  const opcion = await screen.findByRole('option', { name: /Etherion Labs \(interno\) · uso interno/ });
  expect((opcion as HTMLOptionElement).value).toBe('intake');
});

test('el slug se deriva del nombre, sin mayúsculas ni espacios', async () => {
  // «Palatine detail» se enviaba tal cual y el API lo rechazaba con un genérico
  // «tenant invalido» que no decía cuál de los cuatro campos fallaba.
  (platformApi.createTenant as any).mockResolvedValue({ tenant: TENANT });
  render(<PlatformDashboard />);
  await screen.findByRole('heading', { name: 'Demo' });

  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Palatine detail' } });
  expect((screen.getByLabelText(/^Slug/) as HTMLInputElement).value).toBe('palatine-detail');

  fireEvent.click(screen.getByRole('button', { name: 'Crear tenant' }));
  await waitFor(() => expect(platformApi.createTenant).toHaveBeenCalled());
  expect((platformApi.createTenant as any).mock.calls[0][0].slug).toBe('palatine-detail');
});

test('un slug escrito a mano se normaliza y deja de seguir al nombre', async () => {
  render(<PlatformDashboard />);
  await screen.findByRole('heading', { name: 'Demo' });

  fireEvent.change(screen.getByLabelText(/^Slug/), { target: { value: 'Etherion Labs' } });
  expect((screen.getByLabelText(/^Slug/) as HTMLInputElement).value).toBe('etherion-labs');

  fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Otra cosa' } });
  expect((screen.getByLabelText(/^Slug/) as HTMLInputElement).value).toBe('etherion-labs');
});
