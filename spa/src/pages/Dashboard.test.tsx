import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, test, expect } from 'vitest';
import Dashboard from './Dashboard';

vi.mock('../api/client', () => ({
  api: { getJobs: vi.fn() },
}));

import { api } from '../api/client';
const mockGetJobs = api.getJobs as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGetJobs.mockReset();
});

test('renders jobs under their status group headings', async () => {
  mockGetJobs.mockResolvedValue({
    jobs: [
      {
        id: 'job-1',
        status: 'OPEN_INTAKE',
        summary: null,
        openedAt: '2026-06-14T10:00:00.000Z',
        contact: { id: 'c1', phoneE164: '+34111', displayName: 'Ana López' },
      },
      {
        id: 'job-2',
        status: 'CLOSED',
        summary: 'Sillón restaurado',
        openedAt: '2026-06-10T10:00:00.000Z',
        contact: { id: 'c2', phoneE164: '+34222', displayName: null },
      },
    ],
  });

  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );

  const ana = await screen.findByText('Ana López');
  const intakeColumn = ana.closest('section') as HTMLElement;
  expect(within(intakeColumn).getByRole('heading')).toHaveTextContent('En intake');

  const phone = screen.getByText('+34222');
  const closedColumn = phone.closest('section') as HTMLElement;
  expect(within(closedColumn).getByRole('heading')).toHaveTextContent('Cerrados');

  const link = ana.closest('a') as HTMLAnchorElement;
  expect(link).toHaveAttribute('href', '/jobs/job-1');
});
