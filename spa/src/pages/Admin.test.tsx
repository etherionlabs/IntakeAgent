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
    },
  };
});

import { api } from '../api/client';
import Admin from './Admin';

const mockList = api.getAdminTenants as unknown as ReturnType<typeof vi.fn>;
const mockSuspend = api.adminSuspend as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => { mockList.mockReset(); mockSuspend.mockClear(); });

test('lista tenants y permite suspender', async () => {
  mockList
    .mockResolvedValueOnce({ tenants: [{ id: 't1', slug: 's1', name: 'Negocio 1', industry: 'tapiceria', status: 'active', createdAt: '', subscription: 'active', currentPeriodEnd: null }] })
    .mockResolvedValueOnce({ tenants: [{ id: 't1', slug: 's1', name: 'Negocio 1', industry: 'tapiceria', status: 'suspended', createdAt: '', subscription: 'active', currentPeriodEnd: null }] });
  render(<MemoryRouter><Admin /></MemoryRouter>);
  expect(await screen.findByText('Negocio 1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /suspender/i }));
  await waitFor(() => expect(mockSuspend).toHaveBeenCalledWith('t1'));
  expect(await screen.findByTestId('status-t1')).toHaveTextContent('suspended');
});
