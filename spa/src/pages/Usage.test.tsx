import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, test, expect } from 'vitest';
import Usage from './Usage';

vi.mock('../api/client', () => ({
  api: {
    getUsage: vi.fn(),
  },
}));

import { api } from '../api/client';
const mockGetUsage = api.getUsage as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGetUsage.mockReset();
  mockGetUsage.mockResolvedValue({
    plan: { name: 'Gratuito', monthlyLimit: 300, monthUsed: 42, monthRemaining: 258 },
    totals: { runs: 42 },
    recent: [{ id: 'r1', createdAt: '2026-06-14T10:00:00.000Z', error: null }],
  });
});

test('muestra el plan (respuestas del mes) y la actividad reciente, sin jerga técnica', async () => {
  render(
    <MemoryRouter>
      <Usage />
    </MemoryRouter>,
  );

  const plan = await screen.findByTestId('usage-plan');
  expect(plan).toHaveTextContent('Plan Gratuito');
  expect(plan).toHaveTextContent('42');
  expect(plan).toHaveTextContent('de 300');
  expect(await screen.findByText('Actividad reciente')).toBeInTheDocument();
  expect(screen.getByText(/respondido/i)).toBeInTheDocument();
});

test('muestra el plan gratuito con consumo y aviso de límite alcanzado', async () => {
  mockGetUsage.mockResolvedValue({
    mode: 'approval',
    plan: { name: 'Gratuito', monthlyLimit: 300, monthUsed: 300, monthRemaining: 0 },
    totals: { runs: 300, costUsd: 0, inputTokens: 0, outputTokens: 0 },
    recent: [],
  });
  render(
    <MemoryRouter>
      <Usage />
    </MemoryRouter>,
  );
  const plan = await screen.findByTestId('usage-plan');
  expect(plan).toHaveTextContent('Plan Gratuito');
  expect(plan).toHaveTextContent('300');
  expect(plan).toHaveTextContent(/límite alcanzado/i);
});
