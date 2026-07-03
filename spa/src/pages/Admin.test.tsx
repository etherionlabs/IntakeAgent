import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, test, expect } from 'vitest';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    api: {
      getAdminTenants: vi.fn(),
      adminSuspend: vi.fn().mockResolvedValue({ ok: true }),
      adminReactivate: vi.fn().mockResolvedValue({ ok: true }),
      adminReconnect: vi.fn().mockResolvedValue({ ok: true }),
      adminApprove: vi.fn().mockResolvedValue({ ok: true, approvalStatus: 'approved' }),
      adminReject: vi.fn().mockResolvedValue({ ok: true, approvalStatus: 'rejected' }),
      adminSetLimit: vi.fn().mockResolvedValue({ ok: true, monthlyRunLimit: 500 }),
    },
  };
});

import { api } from '../api/client';
import Admin from './Admin';

const mockList = api.getAdminTenants as unknown as ReturnType<typeof vi.fn>;
const mockSuspend = api.adminSuspend as unknown as ReturnType<typeof vi.fn>;
const mockApprove = api.adminApprove as unknown as ReturnType<typeof vi.fn>;
const mockSetLimit = api.adminSetLimit as unknown as ReturnType<typeof vi.fn>;

const approved = (over: Record<string, unknown> = {}) => ({
  id: 't1', slug: 's1', name: 'Negocio 1', industry: 'tapiceria', status: 'active', createdAt: '2026-06-01T00:00:00Z',
  approvalStatus: 'approved', approvedAt: '2026-06-01T00:00:00Z', monthlyRunLimit: null, monthUsed: 3,
  subscription: 'active', currentPeriodEnd: null, ...over,
});

beforeEach(() => { mockList.mockReset(); mockSuspend.mockClear(); mockApprove.mockClear(); mockSetLimit.mockClear(); });

test('lista tenants y permite suspender', async () => {
  mockList
    .mockResolvedValueOnce({ tenants: [approved()] })
    .mockResolvedValueOnce({ tenants: [approved({ status: 'suspended' })] });
  render(<MemoryRouter><Admin /></MemoryRouter>);
  expect(await screen.findByText('Negocio 1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /suspender/i }));
  await waitFor(() => expect(mockSuspend).toHaveBeenCalledWith('t1'));
  expect(await screen.findByTestId('status-t1')).toHaveTextContent('suspended');
});

test('cola de aprobación: los pendientes aparecen arriba y Aprobar llama al endpoint', async () => {
  const pending = approved({ id: 't2', slug: 's2', name: 'Solicitud Nueva', approvalStatus: 'pending', approvedAt: null, subscription: null });
  mockList
    .mockResolvedValueOnce({ tenants: [pending, approved()] })
    .mockResolvedValueOnce({ tenants: [{ ...pending, approvalStatus: 'approved' }, approved()] });
  render(<MemoryRouter><Admin /></MemoryRouter>);
  const queue = await screen.findByTestId('approval-queue');
  expect(queue).toHaveTextContent('Pendientes de aprobación (1)');
  expect(queue).toHaveTextContent('Solicitud Nueva');
  fireEvent.click(screen.getAllByRole('button', { name: /^aprobar$/i })[0]);
  await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('t2'));
  expect(await screen.findByText(/no hay cuentas esperando/i)).toBeInTheDocument();
});

test('editar el límite mensual llama a adminSetLimit (vacío = default → null)', async () => {
  mockList.mockResolvedValue({ tenants: [approved({ monthlyRunLimit: 300 })] });
  render(<MemoryRouter><Admin /></MemoryRouter>);
  const input = await screen.findByLabelText('límite de s1');
  fireEvent.change(input, { target: { value: '500' } });
  fireEvent.click(screen.getByRole('button', { name: /guardar/i }));
  await waitFor(() => expect(mockSetLimit).toHaveBeenCalledWith('t1', 500));
});
