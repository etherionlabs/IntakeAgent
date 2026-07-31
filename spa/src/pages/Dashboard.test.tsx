import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, test, expect } from 'vitest';
import Dashboard from './Dashboard';

vi.mock('../api/client', () => ({
  api: { getJobs: vi.fn(), getOverview: vi.fn() },
}));

import { api } from '../api/client';
const mockGetJobs = api.getJobs as unknown as ReturnType<typeof vi.fn>;
const mockGetOverview = api.getOverview as unknown as ReturnType<typeof vi.fn>;

const emptyOverview = {
  attention: { pendingQuotes: [], readyForReview: 0, waiting: [] },
  funnel: { windowDays: 30, jobs: 0, withOffer: 0, withAccepted: 0, won: 0, lost: 0, followUps: 0 },
};

beforeEach(() => {
  mockGetJobs.mockReset();
  mockGetOverview.mockReset();
  mockGetOverview.mockResolvedValue(emptyOverview);
});

const JOBS = [
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
];

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

test('agrupa los trabajos abiertos bajo su estado', async () => {
  mockGetJobs.mockResolvedValue({ jobs: JOBS });
  renderDashboard();

  const ana = await screen.findByText('Ana López');
  const intakeColumn = ana.closest('section') as HTMLElement;
  expect(within(intakeColumn).getByRole('heading')).toHaveTextContent('En intake');

  const link = ana.closest('a') as HTMLAnchorElement;
  expect(link).toHaveAttribute('href', '/jobs/job-1');
});

test('los cerrados quedan ocultos hasta pedirlos', async () => {
  mockGetJobs.mockResolvedValue({ jobs: JOBS });
  renderDashboard();

  await screen.findByText('Ana López');
  // El trabajo cerrado no estorba de entrada.
  expect(screen.queryByText('+34222')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Ver cerrados \(1\)/ }));
  const phone = await screen.findByText('+34222');
  const closedColumn = phone.closest('section') as HTMLElement;
  expect(within(closedColumn).getByRole('heading')).toHaveTextContent('Cerrados');
});

test('destaca los extras aceptados que hay que cotizar', async () => {
  mockGetJobs.mockResolvedValue({ jobs: JOBS });
  mockGetOverview.mockResolvedValue({
    ...emptyOverview,
    attention: {
      pendingQuotes: [
        {
          jobId: 'job-1',
          contactName: 'Ana López',
          status: 'READY_FOR_REVIEW',
          services: ['polarizado 20%', 'PPF en el frente'],
          updatedAt: '2026-06-14T10:00:00.000Z',
        },
      ],
      readyForReview: 1,
      waiting: [],
    },
  });
  renderDashboard();

  const quotes = await screen.findByText('Por cotizar');
  expect(quotes).toBeInTheDocument();
  expect(screen.getByText('polarizado 20%')).toBeInTheDocument();
  expect(screen.getByText('PPF en el frente')).toBeInTheDocument();
  // "Listos para revisar" también es una columna del tablero: acotamos al aviso.
  const attention = quotes.closest('.attention') as HTMLElement;
  expect(within(attention).getByText('Listos para revisar')).toBeInTheDocument();
});

test('avisa de clientes que escribieron y nadie contestó', async () => {
  mockGetJobs.mockResolvedValue({ jobs: JOBS });
  mockGetOverview.mockResolvedValue({
    ...emptyOverview,
    attention: {
      pendingQuotes: [],
      readyForReview: 0,
      waiting: [
        {
          jobId: 'job-9',
          contactName: 'Luis',
          reason: 'bot_paused',
          since: new Date(Date.now() - 3 * 3600_000).toISOString(),
        },
      ],
    },
  });
  renderDashboard();

  expect(await screen.findByText('Esperando respuesta')).toBeInTheDocument();
  expect(screen.getByText(/pausaste el bot/)).toBeInTheDocument();
  expect(screen.getByText(/hace 3 h/)).toBeInTheDocument();
});

test('sin pendientes muestra que todo está al día', async () => {
  mockGetJobs.mockResolvedValue({ jobs: JOBS });
  renderDashboard();
  expect(await screen.findByText('Todo al día')).toBeInTheDocument();
});

test('muestra el resumen de venta con la conversión', async () => {
  mockGetJobs.mockResolvedValue({ jobs: JOBS });
  mockGetOverview.mockResolvedValue({
    ...emptyOverview,
    funnel: { windowDays: 30, jobs: 20, withOffer: 10, withAccepted: 4, won: 3, lost: 1, followUps: 7 },
  });
  renderDashboard();

  expect(await screen.findByText('aceptaron un extra')).toBeInTheDocument();
  // 4 de 10 ofrecidos = 40%
  expect(screen.getByText('40% de los ofrecidos')).toBeInTheDocument();
  // 3 ganados de 4 con resultado = 75%
  expect(screen.getByText('75% de cierre')).toBeInTheDocument();
  expect(screen.getByText('seguimientos del bot')).toBeInTheDocument();
});
