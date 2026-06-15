import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, test, expect } from 'vitest';
import Contacts from './Contacts';

vi.mock('../api/client', () => ({
  api: {
    getContacts: vi.fn(),
    toggleContact: vi.fn(),
  },
}));

import { api } from '../api/client';
const mockGetContacts = api.getContacts as unknown as ReturnType<typeof vi.fn>;
const mockToggleContact = api.toggleContact as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockGetContacts.mockReset();
  mockToggleContact.mockReset();

  mockGetContacts.mockResolvedValue({
    contacts: [
      { id: 'c1', phoneE164: '+34111', displayName: 'Ana', botActive: true, flaggedNonIntake: false },
      { id: 'c2', phoneE164: '+34222', displayName: 'Beto', botActive: false, flaggedNonIntake: false },
      {
        id: 'c3',
        phoneE164: '+34333',
        displayName: 'Cleo',
        botActive: false,
        flaggedNonIntake: true,
        flaggedReason: 'spam',
      },
    ],
  });

  mockToggleContact.mockResolvedValue({
    ok: true,
    contact: { id: 'c1', phoneE164: '+34111', displayName: 'Ana', botActive: false, flaggedNonIntake: false },
  });
});

function renderContacts() {
  return render(
    <MemoryRouter>
      <Contacts />
    </MemoryRouter>,
  );
}

test('renders the status chips correctly', async () => {
  renderContacts();
  expect(await screen.findByText('Activo')).toBeInTheDocument();
  expect(await screen.findByText('Pausado')).toBeInTheDocument();
  expect(await screen.findByText('No-intake')).toBeInTheDocument();
});

test('toggling the active contact calls toggleContact(id, true)', async () => {
  renderContacts();
  // Ana is active → its button pauses it
  const pauseBtn = await screen.findByRole('button', { name: 'Pausar' });
  fireEvent.click(pauseBtn);
  expect(mockToggleContact).toHaveBeenCalledWith('c1', true);
});
