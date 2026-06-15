import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { vi, beforeEach, test, expect } from 'vitest';
import JobDetail from './JobDetail';

vi.mock('../api/client', () => ({
  api: {
    getJob: vi.fn(),
    getProfile: vi.fn(),
    patchIntake: vi.fn(),
    jobAction: vi.fn(),
  },
}));

import { api } from '../api/client';
const mockGetJob = api.getJob as unknown as ReturnType<typeof vi.fn>;
const mockGetProfile = api.getProfile as unknown as ReturnType<typeof vi.fn>;
const mockPatchIntake = api.patchIntake as unknown as ReturnType<typeof vi.fn>;
const mockJobAction = api.jobAction as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGetJob.mockReset();
  mockGetProfile.mockReset();
  mockPatchIntake.mockReset();
  mockJobAction.mockReset();

  mockGetJob.mockResolvedValue({
    job: {
      id: 'job-1',
      status: 'OPEN_INTAKE',
      summary: null,
      contact: { id: 'c1', phoneE164: '+34111', displayName: 'Ana' },
    },
    intake: {
      client: { name: { value: 'Ana', declined: false } },
    },
    messages: [
      {
        id: 'm1',
        direction: 'inbound',
        kind: 'text',
        body: 'Hola',
        createdAt: '2026-06-14T10:00:00.000Z',
      },
    ],
  });

  mockGetProfile.mockResolvedValue({
    intakeSchema: {
      sections: [
        {
          key: 'client',
          label: 'Cliente',
          fields: [
            { key: 'name', label: 'Nombre', type: 'string', required: true },
          ],
        },
      ],
    },
  });

  mockPatchIntake.mockResolvedValue({ ok: true, intake: {} });
  mockJobAction.mockResolvedValue({ ok: true, status: 'CLOSED' });
});

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/jobs/job-1']}>
      <Routes>
        <Route path="/jobs/:id" element={<JobDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

test('renders the name field with its current value', async () => {
  renderDetail();
  const input = (await screen.findByLabelText(/Nombre/)) as HTMLInputElement;
  expect(input.value).toBe('Ana');
});

test('editing a field and blurring calls patchIntake with the right path', async () => {
  renderDetail();
  const input = (await screen.findByLabelText(/Nombre/)) as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'Ana María' } });
  fireEvent.blur(input);
  expect(mockPatchIntake).toHaveBeenCalledWith('job-1', {
    path: 'client.name',
    value: 'Ana María',
  });
});

test('clicking Cerrar calls jobAction with close', async () => {
  renderDetail();
  const closeBtn = await screen.findByRole('button', { name: 'Cerrar' });
  fireEvent.click(closeBtn);
  expect(mockJobAction).toHaveBeenCalledWith('job-1', 'close', undefined);
});
