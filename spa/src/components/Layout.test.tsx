import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, test, expect, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import Layout from './Layout';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    api: { me: vi.fn().mockRejectedValue(new Error('no session')), logout: vi.fn().mockResolvedValue({ ok: true }) },
  };
});

import { api } from '../api/client';
const mockLogout = api.logout as unknown as ReturnType<typeof vi.fn>;

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AuthProvider>
        <Layout />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockLogout.mockClear();
});

test('renders the nav links', () => {
  renderLayout();
  expect(screen.getByRole('link', { name: 'Jobs' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Contactos' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Uso' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'WhatsApp' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Configuración' })).toBeInTheDocument();
});

test('clicking logout calls api.logout', async () => {
  renderLayout();
  fireEvent.click(screen.getByRole('button', { name: /salir/i }));
  await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
});
