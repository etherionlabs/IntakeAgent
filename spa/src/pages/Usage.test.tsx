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
    totals: { runs: 42, costUsd: 1.2345, inputTokens: 1000, outputTokens: 500 },
    recent: [
      {
        id: 'r1',
        model: 'gpt-test',
        costUsd: 0.0012,
        inputTokens: 120,
        outputTokens: 60,
        createdAt: '2026-06-14T10:00:00.000Z',
        error: null,
      },
    ],
  });
});

test('renders totals from getUsage', async () => {
  render(
    <MemoryRouter>
      <Usage />
    </MemoryRouter>,
  );

  expect(await screen.findByText('42')).toBeInTheDocument();
  expect(await screen.findByText('$1.2345')).toBeInTheDocument();
  expect(await screen.findByText('gpt-test')).toBeInTheDocument();
});
