import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, test, expect } from 'vitest';

vi.mock('../api/client', async () => {
  const actual = await vi.importActual<typeof import('../api/client')>('../api/client');
  return { ...actual, api: { verifyEmail: vi.fn() } };
});

import { api } from '../api/client';
import VerifyEmail from './VerifyEmail';

const mockVerify = api.verifyEmail as unknown as ReturnType<typeof vi.fn>;

function renderAt(url: string) {
  return render(<MemoryRouter initialEntries={[url]}><VerifyEmail /></MemoryRouter>);
}

beforeEach(() => mockVerify.mockReset());

test('token válido muestra éxito', async () => {
  mockVerify.mockResolvedValue({ status: 'verified' });
  renderAt('/verify-email?token=abc');
  expect(await screen.findByText(/correo verificado/i)).toBeInTheDocument();
  expect(mockVerify).toHaveBeenCalledWith('abc');
});

test('sin token muestra error', async () => {
  renderAt('/verify-email');
  expect(await screen.findByText(/inválido o expirado/i)).toBeInTheDocument();
});
