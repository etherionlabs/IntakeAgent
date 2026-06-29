import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, test, expect } from 'vitest';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: { signup: vi.fn() } };
});

import { api } from '../api/client';
import Signup from './Signup';

const mockSignup = api.signup as unknown as ReturnType<typeof vi.fn>;

function renderSignup() {
  return render(<MemoryRouter><Signup /></MemoryRouter>);
}

beforeEach(() => mockSignup.mockReset());

test('submit válido muestra "revisa tu correo"', async () => {
  mockSignup.mockResolvedValue({ tenantId: 't1', status: 'pending_verification' });
  renderSignup();
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.com' } });
  fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'pw1234567890' } });
  fireEvent.change(screen.getByLabelText(/nombre del negocio/i), { target: { value: 'Mi Negocio' } });
  fireEvent.click(screen.getByLabelText(/acepto los/i));
  fireEvent.click(screen.getByLabelText(/riesgo del canal/i));
  fireEvent.click(screen.getByRole('button', { name: /crear cuenta/i }));
  expect(await screen.findByText(/revisa tu correo/i)).toBeInTheDocument();
  expect(mockSignup).toHaveBeenCalledWith({ email: 'a@b.com', password: 'pw1234567890', businessName: 'Mi Negocio', industry: 'tapiceria', acceptedTerms: true, acceptedWhatsappRisk: true });
});
