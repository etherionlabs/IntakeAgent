import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, test, expect, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import Layout from './Layout';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    api: {
      me: vi.fn().mockRejectedValue(new Error('no session')),
      logout: vi.fn().mockResolvedValue({ ok: true }),
      getBillingStatus: vi.fn().mockResolvedValue({ status: 'active', planName: 'Plan Test' }),
      getProfile: vi.fn().mockResolvedValue({ intakeSchema: { $businessName: 'Negocio Test' } }),
    },
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
  expect(screen.getByRole('link', { name: 'Inicio' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Contactos' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Uso' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'WhatsApp' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Configuración' })).toBeInTheDocument();
});

test('clicking logout calls api.logout', async () => {
  renderLayout();
  // En escritorio y en móvil hay un "Salir" cada uno (el segundo vive en el menú).
  fireEvent.click(screen.getAllByRole('button', { name: /salir/i })[0]);
  await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
});

test('el menú móvil arranca cerrado y se abre con el botón', () => {
  renderLayout();
  const toggle = screen.getByRole('button', { name: 'Menú' });
  const nav = document.getElementById('main-nav') as HTMLElement;

  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(nav.className).not.toContain('nav-open');

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(nav.className).toContain('nav-open');
});

test('el menú se cierra con Escape', () => {
  renderLayout();
  const toggle = screen.getByRole('button', { name: 'Menú' });
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');

  fireEvent.keyDown(window, { key: 'Escape' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('el menú abierto se cierra al tocar fuera', () => {
  const { container } = renderLayout();
  fireEvent.click(screen.getByRole('button', { name: 'Menú' }));
  const backdrop = container.querySelector('.nav-backdrop') as HTMLElement;
  expect(backdrop).toBeInTheDocument();

  fireEvent.click(backdrop);
  expect(screen.getByRole('button', { name: 'Menú' })).toHaveAttribute('aria-expanded', 'false');
});

test('el menú lleva su propio Salir (en móvil no hay otro)', async () => {
  renderLayout();
  fireEvent.click(screen.getByRole('button', { name: 'Menú' }));
  const nav = document.getElementById('main-nav') as HTMLElement;
  const logout = nav.querySelector('.nav-logout') as HTMLButtonElement;
  expect(logout).toBeInTheDocument();

  fireEvent.click(logout);
  await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
});
