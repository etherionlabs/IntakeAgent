import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, test, expect } from 'vitest';
import { ApiError } from '../api/client';
import { AuthProvider } from '../auth/AuthContext';
import Login from './Login';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return {
    ...actual,
    api: { login: vi.fn() },
  };
});

import { api } from '../api/client';
const mockLogin = api.login as unknown as ReturnType<typeof vi.fn>;

function renderLogin() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <Login />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockLogin.mockReset();
});

test('successful login stores the token', async () => {
  mockLogin.mockResolvedValue({ token: 'tok123', user: { id: '1', username: 'ana' } });
  renderLogin();

  fireEvent.change(screen.getByLabelText(/usuario/i), { target: { value: 'ana' } });
  fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('button', { name: /entrar/i }));

  await waitFor(() => {
    expect(localStorage.getItem('intake_token')).toBe('tok123');
  });
  expect(mockLogin).toHaveBeenCalledWith('ana', 'secret');
});

test('failed login shows the error message', async () => {
  mockLogin.mockRejectedValue(new ApiError(401, 'credenciales inválidas'));
  renderLogin();

  fireEvent.change(screen.getByLabelText(/usuario/i), { target: { value: 'ana' } });
  fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'bad' } });
  fireEvent.click(screen.getByRole('button', { name: /entrar/i }));

  expect(await screen.findByRole('alert')).toHaveTextContent('credenciales inválidas');
  expect(localStorage.getItem('intake_token')).toBeNull();
});
